const bubble = document.getElementById("bubble");
const canvas = document.getElementById("live2d-canvas");
const modelDragRegion = document.getElementById("model-drag-region");
const inputArea = document.getElementById("input-area");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");
const ttsAudio = document.getElementById("tts-audio");

const state = {
  config: null,
  app: null,
  model: null,
  naturalModelSize: { width: 1, height: 1 },
  mouthParamId: null,
  audioContext: null,
  currentSource: null,
  currentAnalyserFrame: 0,
  currentAbortController: null,
  bubbleHideTimer: 0,
  chatHistory: [],
  speakQueue: [],
  speechWaiters: [],
  isSpeaking: false,
  isBusy: false,
  hoverModel: false,
  hoverInput: false,
  speechRecognition: null,
  isListening: false,
  mediaRecorder: null,
  mediaStream: null,
  recordingChunks: [],
};

function showBubble(text) {
  clearTimeout(state.bubbleHideTimer);
  bubble.textContent = text;
  bubble.style.display = "block";
}

function hideBubble(delay = 0) {
  clearTimeout(state.bubbleHideTimer);
  state.bubbleHideTimer = window.setTimeout(() => {
    bubble.style.display = "none";
    bubble.textContent = "";
  }, delay);
}

function finalizeBubbleAfterSpeech() {
  clearTimeout(state.bubbleHideTimer);
  state.bubbleHideTimer = window.setTimeout(() => {
    if (!state.isSpeaking && state.speakQueue.length === 0 && !state.isBusy) {
      hideBubble();
    }
  }, Number(state.config?.window?.bubbleAutoHideDelay || 2200));
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  sendBtn.disabled = isBusy;
  userInput.disabled = isBusy;
  micBtn.disabled = isBusy;
}

function normalizeBaseURL(url) {
  return String(url || "").replace(/\/+$/, "");
}

function updateMousePassthrough() {
  if (!state.config?.window?.clickThrough) {
    window.electronAPI.setIgnoreMouseEvents(false);
    return;
  }

  const ignore = !state.hoverModel && !state.hoverInput;
  window.electronAPI.setIgnoreMouseEvents(ignore);
}

function pointHitsModel(clientX, clientY) {
  if (!state.model) {
    return false;
  }

  const bounds = state.model.getBounds?.();
  if (!bounds) {
    return false;
  }

  const paddingX = Math.max(24, bounds.width * 0.04);
  const paddingY = Math.max(24, bounds.height * 0.04);

  return (
    clientX >= bounds.x - paddingX &&
    clientX <= bounds.x + bounds.width + paddingX &&
    clientY >= bounds.y - paddingY &&
    clientY <= bounds.y + bounds.height + paddingY
  );
}

function updateModelDragRegion() {
  if (!state.model) {
    modelDragRegion.style.width = "0px";
    modelDragRegion.style.height = "0px";
    return;
  }

  const bounds = state.model.getBounds?.();
  if (!bounds) {
    modelDragRegion.style.width = "0px";
    modelDragRegion.style.height = "0px";
    return;
  }

  const paddingX = Math.max(24, bounds.width * 0.04);
  const paddingY = Math.max(24, bounds.height * 0.04);
  modelDragRegion.style.left = `${Math.round(bounds.x - paddingX)}px`;
  modelDragRegion.style.top = `${Math.round(bounds.y - paddingY)}px`;
  modelDragRegion.style.width = `${Math.round(bounds.width + paddingX * 2)}px`;
  modelDragRegion.style.height = `${Math.round(bounds.height + paddingY * 2)}px`;
}

function addInputInteractivity() {
  inputArea.addEventListener("mouseenter", () => {
    state.hoverInput = true;
    updateMousePassthrough();
  });

  inputArea.addEventListener("mouseleave", () => {
    state.hoverInput = false;
    updateMousePassthrough();
  });

  inputArea.addEventListener("focusin", () => {
    state.hoverInput = true;
    updateMousePassthrough();
  });

  inputArea.addEventListener("focusout", () => {
    state.hoverInput = inputArea.matches(":hover");
    updateMousePassthrough();
  });
}

function addModelDragInteractivity() {
  canvas.addEventListener("pointermove", (event) => {
    state.hoverModel = pointHitsModel(event.clientX, event.clientY);
    canvas.style.cursor = state.hoverModel ? "move" : "default";
    updateMousePassthrough();
    updateModelDragRegion();
  });

  canvas.addEventListener("pointerleave", () => {
    state.hoverModel = false;
    canvas.style.cursor = "default";
    updateMousePassthrough();
  });
}

function setListening(isListening) {
  state.isListening = isListening;
  micBtn.classList.toggle("is-listening", isListening);
  micBtn.title = isListening ? "正在录音..." : "语音输入";
}

function arrayBufferToBase64(arrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function stopMediaStream() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }
}

async function setupLocalSpeechRecorder() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    micBtn.title = "当前环境不支持本地录音";
    return;
  }
}

function bindSpeechInput() {
  micBtn.addEventListener("click", async () => {
    if (state.isBusy) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showBubble("\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u672c\u5730\u5f55\u97f3\u8f6c\u5199\u3002");
      hideBubble(1800);
      return;
    }

    if (state.isListening) {
      await stopMediaStream();
      return;
    }

    try {
      await ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType =
        typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const mediaRecorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      state.mediaStream = stream;
      state.mediaRecorder = mediaRecorder;
      state.recordingChunks = [];

      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          state.recordingChunks.push(event.data);
        }
      });

      mediaRecorder.addEventListener("start", () => {
        setListening(true);
        showBubble("\u5f17\u6d1b\u6d1b\u5728\u542c...");
      });

      mediaRecorder.addEventListener("stop", async () => {
        setListening(false);

        const chunks = state.recordingChunks.slice();
        state.recordingChunks = [];

        try {
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
          const arrayBuffer = await blob.arrayBuffer();
          const result = await window.electronAPI.transcribeAudio({
            audioBase64: arrayBufferToBase64(arrayBuffer),
            mimeType: blob.type || "audio/webm",
            language: "zh",
          });

          const text = result?.text?.trim();
          if (text) {
            userInput.value = "";
            showBubble(text);
            void handleUserInput(text);
          } else if (!state.isBusy) {
            showBubble("\u6ca1\u6709\u8bc6\u522b\u5230\u6709\u6548\u8bed\u97f3\u3002");
            hideBubble(1500);
          }
        } catch (error) {
          console.error("Local ASR failed:", error);
          showBubble(`\u8bed\u97f3\u8bc6\u522b\u5931\u8d25\uff1a${error.message || error}`);
        } finally {
          if (state.mediaStream) {
            state.mediaStream.getTracks().forEach((track) => track.stop());
          }
          state.mediaStream = null;
          state.mediaRecorder = null;
        }
      });

      mediaRecorder.start();
    } catch (error) {
      console.error("Microphone start failed:", error);
      setListening(false);
      showBubble(`\u65e0\u6cd5\u5f00\u542f\u9ea6\u514b\u98ce\uff1a${error.message || error}`);
      hideBubble(2000);
    }
  });
}

function extractSentenceChunks(buffer) {
  const sentences = [];
  let rest = buffer;

  while (true) {
    const index = rest.search(/[\uFF0C\u3002\uFF01\uFF1F!?\u3001\u2026\n]/);
    if (index === -1) {
      break;
    }

    sentences.push(rest.slice(0, index + 1));
    rest = rest.slice(index + 1);
  }

  return { sentences, rest };
}

function getCoreModelParameterIds(coreModel) {
  if (!coreModel) {
    return [];
  }

  if (Array.isArray(coreModel._parameterIds)) {
    return coreModel._parameterIds;
  }

  if (Array.isArray(coreModel.parameters?.ids)) {
    return coreModel.parameters.ids;
  }

  if (Array.isArray(coreModel.parameterIds)) {
    return coreModel.parameterIds;
  }

  return [];
}

function resolveMouthParamId() {
  const coreModel = state.model?.internalModel?.coreModel;
  const candidates = state.config?.live2d?.mouthParamCandidates || [];
  const ids = getCoreModelParameterIds(coreModel);

  for (const candidate of candidates) {
    if (ids.includes(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || "ParamMouthOpenY";
}

function setMouthValue(value) {
  const coreModel = state.model?.internalModel?.coreModel;
  if (!coreModel || !state.mouthParamId) {
    return;
  }

  try {
    coreModel.setParameterValueById(state.mouthParamId, value);
  } catch {}
}

function stopLipSync() {
  if (state.currentAnalyserFrame) {
    cancelAnimationFrame(state.currentAnalyserFrame);
    state.currentAnalyserFrame = 0;
  }

  setMouthValue(0);
}

function startSyntheticLipSync(source) {
  stopLipSync();

  const tick = () => {
    if (!source || source.paused || source.ended) {
      setMouthValue(0);
      state.currentAnalyserFrame = 0;
      return;
    }

    const mouthValue = 0.2 + Math.abs(Math.sin(source.currentTime * 14)) * 0.75;
    setMouthValue(Math.min(mouthValue, 1));
    state.currentAnalyserFrame = requestAnimationFrame(tick);
  };

  tick();
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }

  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }

  return state.audioContext;
}

function decodeAudioData(audioContext, arrayBuffer) {
  return new Promise((resolve, reject) => {
    audioContext.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
  });
}

function flushSpeechWaiters() {
  if (state.isSpeaking || state.speakQueue.length > 0) {
    return;
  }

  while (state.speechWaiters.length > 0) {
    const resolve = state.speechWaiters.shift();
    resolve();
  }
}

function waitForSpeechQueue() {
  if (!state.isSpeaking && state.speakQueue.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    state.speechWaiters.push(resolve);
  });
}

function stopCurrentAudio() {
  if (state.currentSource) {
    try {
      if (typeof state.currentSource.pause === "function") {
        state.currentSource.pause();
        state.currentSource.currentTime = 0;
        state.currentSource.removeAttribute("src");
        state.currentSource.load?.();
      } else if (typeof state.currentSource.stop === "function") {
        state.currentSource.stop();
      }
    } catch {}
  }

  state.currentSource = null;
  stopLipSync();
}

async function playAudioBuffer(arrayBuffer) {
  try {
    await playAudioViaElement(arrayBuffer);
  } catch (error) {
    console.warn("Audio element playback failed, falling back to buffer source:", error);
    await playAudioViaBuffer(arrayBuffer);
  }
}

async function playAudioViaElement(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    const audioURL = URL.createObjectURL(blob);
    const source = ttsAudio;

    source.src = audioURL;
    source.preload = "auto";
    source.volume = 1;
    source.muted = false;
    source.playsInline = true;

    let started = false;
    let startTimeoutId = 0;

    source.onplaying = () => {
      started = true;
      clearTimeout(startTimeoutId);
    };

    source.onended = () => {
      if (state.currentSource === source) {
        state.currentSource = null;
      }
      stopLipSync();
      URL.revokeObjectURL(audioURL);
      resolve();
    };

    source.onerror = () => {
      clearTimeout(startTimeoutId);
      URL.revokeObjectURL(audioURL);
      reject(new Error("HTML audio element failed to play wav."));
    };

    state.currentSource = source;
    startSyntheticLipSync(source);
    source.load();

    startTimeoutId = window.setTimeout(() => {
      if (!started) {
        try {
          source.pause();
        } catch {}
        URL.revokeObjectURL(audioURL);
        reject(new Error("HTML audio element did not enter playing state in time."));
      }
    }, 2500);

    source.play().catch((error) => {
      clearTimeout(startTimeoutId);
      URL.revokeObjectURL(audioURL);
      reject(error);
    });
  });
}

async function playAudioViaBuffer(arrayBuffer) {
  const audioContext = await ensureAudioContext();
  const decoded = await decodeAudioData(audioContext, arrayBuffer);

  return new Promise((resolve, reject) => {
    const source = audioContext.createBufferSource();
    source.buffer = decoded;
    source.connect(audioContext.destination);

    const startedAt = performance.now();
    const fakeSource = {
      paused: false,
      ended: false,
      get currentTime() {
        return (performance.now() - startedAt) / 1000;
      },
    };

    source.onended = () => {
      fakeSource.ended = true;
      if (state.currentSource === source) {
        state.currentSource = null;
      }
      stopLipSync();
      resolve();
    };

    state.currentSource = source;
    startSyntheticLipSync(fakeSource);

    try {
      source.start(0);
    } catch (error) {
      reject(error);
    }
  });
}

async function requestTTSV2(text) {
  const ttsConfig = state.config.tts;
  const response = await fetch(`${normalizeBaseURL(ttsConfig.baseURL)}${ttsConfig.endpoint || "/tts"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      text_lang: ttsConfig.textLang,
      ref_audio_path: ttsConfig.refAudioPath,
      prompt_lang: ttsConfig.promptLang,
      prompt_text: ttsConfig.promptText,
      text_split_method: ttsConfig.textSplitMethod || "cut5",
      media_type: ttsConfig.mediaType || "wav",
      streaming_mode: Boolean(ttsConfig.streamingMode),
      parallel_infer: Boolean(ttsConfig.parallelInfer),
      split_bucket: Boolean(ttsConfig.splitBucket),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.arrayBuffer();
}

async function requestTTSLegacy(text) {
  const ttsConfig = state.config.tts;
  const params = new URLSearchParams({
    refer_wav_path: ttsConfig.refAudioPath,
    prompt_text: ttsConfig.promptText,
    prompt_language: ttsConfig.promptLang,
    text,
    text_language: ttsConfig.textLang,
  });

  const response = await fetch(`${normalizeBaseURL(ttsConfig.baseURL)}/?${params.toString()}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.arrayBuffer();
}

async function requestTTSViaAPI(text) {
  const ttsConfig = state.config.tts;
  const baseURL = normalizeBaseURL(ttsConfig.apiBaseURL);
  const response = await fetch(`${baseURL}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ttsConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: ttsConfig.apiModel || "tts-1",
      input: text,
      voice: ttsConfig.apiVoice || "alloy",
      response_format: ttsConfig.apiFormat || "wav",
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.arrayBuffer();
}

async function requestTTSAudio(text) {
  const provider = state.config.tts.provider || "sovits";

  if (provider === "api") {
    return requestTTSViaAPI(text);
  }

  const mode = state.config.tts.apiMode || "auto";

  if (mode === "legacy") {
    return requestTTSLegacy(text);
  }

  if (mode === "v2") {
    return requestTTSV2(text);
  }

  try {
    return await requestTTSV2(text);
  } catch (primaryError) {
    console.warn("TTS v2 request failed, falling back to legacy API:", primaryError);
    return requestTTSLegacy(text);
  }
}

async function speakText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  await ensureAudioContext();
  const arrayBuffer = await requestTTSAudio(trimmed);
  await playAudioBuffer(arrayBuffer);
}

function enqueueSpeech(text) {
  const cleaned = text.replace(/^[\s\u3002\uFF0C\u3001\uFF01\uFF1F!?,.]+/, "").trim();
  if (!cleaned) {
    return;
  }

  state.speakQueue.push(cleaned);
  void processSpeechQueue();
}

async function processSpeechQueue() {
  if (state.isSpeaking) {
    return;
  }

  state.isSpeaking = true;

  while (state.speakQueue.length > 0) {
    const sentence = state.speakQueue.shift();

    try {
      await speakText(sentence);
    } catch (error) {
      console.error("Speech synthesis failed:", error);
      state.speakQueue = [];
      showBubble(`\u8bed\u97f3\u64ad\u653e\u5931\u8d25\uff1a${error.message || error}`);
      break;
    }
  }

  state.isSpeaking = false;
  flushSpeechWaiters();
  finalizeBubbleAfterSpeech();
}

function buildMessages(userMessage) {
  const systemMessage = {
    role: "system",
    content: state.config.llm.systemPrompt,
  };

  const historyTurns = Math.max(0, Number(state.config.llm.maxHistoryTurns || 0));
  const historySlice = historyTurns > 0 ? state.chatHistory.slice(-historyTurns * 2) : [];

  return [systemMessage, ...historySlice, { role: "user", content: userMessage }];
}

async function* streamLLM(userMessage, signal) {
  const llmConfig = state.config.llm;
  const response = await fetch(`${normalizeBaseURL(llmConfig.baseURL)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      stream: true,
      messages: buildMessages(userMessage),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending = "";

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });

    let lineBreakIndex = pending.indexOf("\n");
    while (lineBreakIndex !== -1) {
      const rawLine = pending.slice(0, lineBreakIndex).trim();
      pending = pending.slice(lineBreakIndex + 1);

      if (rawLine.startsWith("data:")) {
        const data = rawLine.slice(5).trim();
        if (data === "[DONE]") {
          return;
        }

        if (data) {
          try {
            const payload = JSON.parse(data);
            const token = payload.choices?.[0]?.delta?.content;
            if (token) {
              yield token;
            }
          } catch (error) {
            console.warn("Failed to parse LLM stream chunk:", error, data);
          }
        }
      }

      lineBreakIndex = pending.indexOf("\n");
    }

    if (done) {
      break;
    }
  }
}

function placeModel() {
  if (!state.model) {
    return;
  }

  const modelConfig = state.config.live2d;
  const screenWidth = state.app.screen.width;
  const screenHeight = state.app.screen.height;
  let scale = Number(modelConfig.scale || 1);

  if (modelConfig.autoFit) {
    const fitScale = Math.min(
      (screenWidth * 0.84) / state.naturalModelSize.width,
      (screenHeight * 0.9) / state.naturalModelSize.height
    );
    scale *= fitScale;
  }

  state.model.scale.set(scale);
  state.model.anchor.set(0.5, 1);
  state.model.x = screenWidth / 2 + Number(modelConfig.x || 0);
  state.model.y = screenHeight + Number(modelConfig.y || 0);
  updateModelDragRegion();
}

function tryStartIdleMotion() {
  const group = state.config.live2d.idleMotionGroup || "Idle";

  try {
    if (typeof state.model.motion === "function") {
      state.model.motion(group);
      return;
    }
  } catch {}

  try {
    state.model.internalModel.motionManager.startRandomMotion(group);
  } catch {}
}

async function loadModel() {
  const modelUrl =
    state.config.live2d.resolvedModelURL ||
    new URL(state.config.live2d.modelPath, window.location.href).href;

  if (!window.PIXI?.live2d?.Live2DModel) {
    throw new Error("pixi-live2d-display failed to load.");
  }

  state.model = await window.PIXI.live2d.Live2DModel.from(modelUrl, {
    autoInteract: false,
  });
  state.model.autoInteract = false;
  state.model.eventMode = "none";
  state.model.interactive = false;
  state.model.cursor = "move";
  state.model.interactiveChildren = false;
  state.model.buttonMode = false;

  try {
    state.model.unregisterInteraction?.();
  } catch {}

  try {
    state.model.off?.("pointertap");
    state.model.off?.("pointermove");
    state.model.off?.("pointerdown");
    state.model.off?.("pointerover");
    state.model.off?.("pointerout");
  } catch {}

  state.app.stage.addChild(state.model);
  state.naturalModelSize = {
    width: Math.max(1, state.model.width),
    height: Math.max(1, state.model.height),
  };

  placeModel();
  updateModelDragRegion();
  state.mouthParamId = resolveMouthParamId();

  tryStartIdleMotion();
}

async function handleUserInput(userText) {
  if (state.isBusy) {
    return;
  }

  const trimmed = userText.trim();
  if (!trimmed) {
    return;
  }

  if (!state.config.llm.apiKey || state.config.llm.apiKey === "YOUR_API_KEY_HERE") {
    showBubble("\u8bf7\u5148\u5728 config.json \u91cc\u586b\u5165\u4f60\u7684 API Key\u3002");
    hideBubble(2600);
    return;
  }

  const ttsProvider = state.config.tts.provider || "sovits";

  if (ttsProvider === "api") {
    if (!state.config.tts.apiKey) {
      showBubble("\u8bf7\u5148\u5728 config.json \u91cc\u586b\u5165\u7b2c\u4e09\u65b9 TTS \u7684 API Key\u3002");
      hideBubble(2600);
      return;
    }
  } else if (!state.config.tts.refAudioPath) {
    showBubble("\u8bf7\u5148\u5728 config.json \u91cc\u8bbe\u7f6e GPT-SoVITS \u7684\u53c2\u8003\u97f3\u9891\u3002");
    hideBubble(2600);
    return;
  }

  stopCurrentAudio();
  state.speakQueue = [];
  state.currentAbortController?.abort();
  state.currentAbortController = new AbortController();

  setBusy(true);
  showBubble("\u5728\u60f3\u5566...");

  let fullResponse = "";

  try {
    await ensureAudioContext();

    for await (const token of streamLLM(trimmed, state.currentAbortController.signal)) {
      fullResponse += token;
      showBubble(fullResponse);
    }

    if (fullResponse.trim()) {
      enqueueSpeech(fullResponse);
    }

    await waitForSpeechQueue();

    if (fullResponse.trim()) {
      state.chatHistory.push(
        { role: "user", content: trimmed },
        { role: "assistant", content: fullResponse.trim() }
      );
    }

    if (!state.isSpeaking && state.speakQueue.length === 0) {
      finalizeBubbleAfterSpeech();
    }
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    console.error("Conversation failed:", error);
    showBubble(`\u51fa\u9519\u4e86\uff1a${error.message || error}`);
  } finally {
    setBusy(false);
    flushSpeechWaiters();
  }
}

function bindInputEvents() {
  sendBtn.addEventListener("click", () => {
    const value = userInput.value.trim();
    if (!value) {
      return;
    }

    userInput.value = "";
    void handleUserInput(value);
  });

  userInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendBtn.click();
    }
  });
}

async function bootstrap() {
  try {
    showBubble("\u6b63\u5728\u52a0\u8f7d\u6a21\u578b...");

    state.config = await window.electronAPI.getConfig();
    state.app = new window.PIXI.Application({
      view: canvas,
      resizeTo: window,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
    });

    addInputInteractivity();
    addModelDragInteractivity();
    setupLocalSpeechRecorder();
    bindInputEvents();
    bindSpeechInput();
    await loadModel();

    window.addEventListener("resize", placeModel);
    updateMousePassthrough();

    showBubble("\u51c6\u5907\u597d\u4e86\uff0c\u6765\u804a\u5929\u5427\u3002");
    hideBubble(1800);
  } catch (error) {
    console.error("Bootstrap failed:", error);
    showBubble(`\u521d\u59cb\u5316\u5931\u8d25\uff1a${error.message || error}`);
  }
}

void bootstrap();

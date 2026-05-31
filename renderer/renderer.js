import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const bubble = document.getElementById("bubble");
const canvas = document.getElementById("live2d-canvas");
const avatarImage = document.getElementById("avatar-image");
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

const vrmState = {
  renderer: null,
  scene: null,
  camera: null,
  vrm: null,
  clock: null,
  canvas: null,
  renderLoopId: 0,
  lipSyncId: 0,
  mouseX: 0,
  mouseY: 0,
  mouseOnCanvas: false,
  basePosition: new THREE.Vector3(),
  baseRotation: new THREE.Euler(),
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

function showError(msg) {
  console.error("[App Error]", msg);
  clearTimeout(state.bubbleHideTimer);
  bubble.textContent = msg;
  bubble.style.display = "block";
  bubble.style.background = "rgba(255, 220, 220, 0.92)";
  bubble.style.border = "1px solid rgba(200, 80, 80, 0.5)";
  // 错误消息保持 12 秒，足够阅读
  state.bubbleHideTimer = window.setTimeout(() => {
    bubble.style.display = "none";
    bubble.textContent = "";
    bubble.style.background = "";
    bubble.style.border = "";
  }, 12000);
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
  const modelType = state.config?.modelType || "live2d";

  if (modelType === "image") {
    if (avatarImage.style.display === "none") return false;
    const rect = avatarImage.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  if (modelType === "vrm") {
    if (!vrmState.vrm || !vrmState.camera || !vrmState.canvas) {
      return false;
    }

    const rect = vrmState.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), vrmState.camera);

    const meshes = [];
    vrmState.vrm.scene.traverse((child) => {
      if (child.isMesh) {
        meshes.push(child);
      }
    });

    const intersects = raycaster.intersectObjects(meshes, false);
    return intersects.length > 0;
  }

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
  const modelType = state.config?.modelType || "live2d";

  if (modelType === "vrm") {
    modelDragRegion.style.left = "0px";
    modelDragRegion.style.top = "0px";
    modelDragRegion.style.width = "100%";
    modelDragRegion.style.height = "100%";
    return;
  }

  if (modelType === "image" && avatarImage.style.display !== "none") {
    const rect = avatarImage.getBoundingClientRect();
    modelDragRegion.style.left = rect.left + "px";
    modelDragRegion.style.top = rect.top + "px";
    modelDragRegion.style.width = rect.width + "px";
    modelDragRegion.style.height = rect.height + "px";
    return;
  }

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
  const vrmCanvas = document.getElementById("vrm-canvas");
  const pointerTargets = [canvas, vrmCanvas, avatarImage];

  for (const target of pointerTargets) {
    target.addEventListener("pointermove", (event) => {
      state.hoverModel = pointHitsModel(event.clientX, event.clientY);
      target.style.cursor = state.hoverModel ? "move" : "default";
      updateMousePassthrough();
      updateModelDragRegion();

      // VRM 视线跟踪
      if (target.id === "vrm-canvas") {
        const rect = target.getBoundingClientRect();
        vrmState.mouseX = (event.clientX - rect.left) / rect.width;
        vrmState.mouseY = (event.clientY - rect.top) / rect.height;
        vrmState.mouseOnCanvas = true;
      }
    });

    target.addEventListener("pointerleave", () => {
      state.hoverModel = false;
      target.style.cursor = "default";
      updateMousePassthrough();
      if (target.id === "vrm-canvas") {
        vrmState.mouseOnCanvas = false;
      }
    });
  }
} // end addModelDragInteractivity

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

// ===== Web Speech API 语音识别（Chrome 内置，无需 GPT-SoVITS）=====

function setupWebSpeechInput() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return;

  let recognition = null;

  micBtn.addEventListener("click", () => {
    if (state.isBusy) return;

    if (state.isListening) {
      if (recognition) recognition.stop();
      return;
    }

    try {
      recognition = new Ctor();
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = true;

      state.isListening = true;
      micBtn.classList.add("is-listening");
      showBubble("我在听...");

      if ((state.config?.modelType || "live2d") === "image") {
        avatarImage.classList.remove("avatar-idle");
        avatarImage.classList.add("avatar-listening");
      }

      let finalText = "";

      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        showBubble(finalText + interim || "我在听...");
      };

      recognition.onerror = (event) => {
        console.error("ASR error:", event.error);
        cleanup();
        if (event.error === "no-speech") {
          showBubble("没有听到声音，再试一次？");
          hideBubble(2000);
        } else if (event.error !== "aborted") {
          showError("语音识别失败：" + event.error);
        }
      };

      recognition.onend = () => {
        cleanup();
        const text = finalText.trim();
        if (text) {
          userInput.value = "";
          showBubble(text);
          void handleUserInput(text);
        }
      };

      recognition.start();
    } catch (err) {
      cleanup();
      showError("无法启动语音识别：" + (err.message || err));
    }
  });

  function cleanup() {
    state.isListening = false;
    micBtn.classList.remove("is-listening");
    avatarImage.classList.remove("avatar-listening");
    if ((state.config?.modelType || "live2d") === "image") {
      avatarImage.classList.add("avatar-idle");
    }
  }
}

// ===== 旧版 ASR（GPT-SoVITS FunASR，回退用）=====

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
        showBubble("我在听...");

        // 图片模式：倾听动画
        if ((state.config?.modelType || "live2d") === "image") {
          avatarImage.classList.remove("avatar-idle");
          avatarImage.classList.add("avatar-listening");
        }
      });

      mediaRecorder.addEventListener("stop", async () => {
        setListening(false);

        // 图片模式：恢复待机
        avatarImage.classList.remove("avatar-listening");
        if ((state.config?.modelType || "live2d") === "image") {
          avatarImage.classList.add("avatar-idle");
        }

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
          showError("语音识别失败：" + (error.message || error));
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
      showError("无法开启麦克风：" + (error.message || error));
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
  if (vrmState.lipSyncId) {
    cancelAnimationFrame(vrmState.lipSyncId);
    vrmState.lipSyncId = 0;
  }

  // 图片模式：清理说话 class
  avatarImage.classList.remove("avatar-talking");
  avatarImage.classList.add("avatar-idle");

  if (vrmState.vrm?.expressionManager) {
    vrmState.vrm.expressionManager.setValue("aa", 0);
    vrmState.vrm.expressionManager.setValue("ih", 0);
    vrmState.vrm.expressionManager.setValue("oh", 0);
  }

  if (state.currentAnalyserFrame) {
    cancelAnimationFrame(state.currentAnalyserFrame);
    state.currentAnalyserFrame = 0;
  }

  setMouthValue(0);
}

function startSyntheticLipSync(source) {
  const modelType = state.config?.modelType || "live2d";

  if (modelType === "vrm") {
    startVRMLipSync(source);
    return;
  }

  if (modelType === "image") {
    avatarImage.classList.remove("avatar-idle");
    avatarImage.classList.add("avatar-talking");
    const restore = () => {
      avatarImage.classList.remove("avatar-talking");
      avatarImage.classList.add("avatar-idle");
    };
    // 兼容真实 audio element 和 fakeSource 对象
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", restore, { once: true });
    } else {
      // fakeSource（playAudioViaBuffer 回退）— 用 onended 回调
      const origOnEnded = source.onended;
      source.onended = () => {
        if (origOnEnded) origOnEnded();
        restore();
      };
    }
    return;
  }

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
    const format = state.config?.tts?.apiFormat || "wav";
    const mimeType = format === "mp3" ? "audio/mpeg" : "audio/wav";
    const blob = new Blob([arrayBuffer], { type: mimeType });
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
  const apiType = ttsConfig.apiType || "openai";

  if (apiType === "edge") {
    // Microsoft Edge TTS — 免费，无需 API key
    const voice = ttsConfig.apiVoice || "zh-CN-XiaoxiaoNeural";
    const rate = ttsConfig.speed || 0;
    const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"><voice name="${voice}"><prosody rate="${rate}%" pitch="0%">${text}</prosody></voice></speak>`;

    const response = await fetch(
      "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "Mozilla/5.0",
        },
        body: ssml,
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.arrayBuffer();
  }

  if (apiType === "dashscope") {
    // DashScope CosyVoice 原生格式
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const reqBody = {
      model: ttsConfig.apiModel || "cosyvoice-v1",
      input: {
        text: text,
        voice: ttsConfig.apiVoice || "longxiaochun",
        format: ttsConfig.apiFormat || "wav",
        sample_rate: 24000,
      },
    };
    console.log("[TTS] DashScope request:", JSON.stringify({ model: reqBody.model, voice: reqBody.input.voice, textLen: text.length }));
    try {
      const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ttsConfig.apiKey}`,
        },
      body: JSON.stringify(reqBody),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[TTS] DashScope error:", response.status, errBody);
      throw new Error("DashScope " + response.status + ": " + errBody.slice(0, 200));
    }

    const result = await response.json();
    console.log("[TTS] DashScope response keys:", Object.keys(result));
    // DashScope 返回 { output: { audio: { url: "..." } } } 或 { output: { audio: { data: "base64..." } } }
    const audio = result?.output?.audio;
    if (audio?.url) {
      const audioResp = await fetch(audio.url);
      if (!audioResp.ok) throw new Error("Failed to download TTS audio");
      return audioResp.arrayBuffer();
    }
    if (audio?.data) {
      const binaryStr = atob(audio.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes.buffer;
    }
    throw new Error("DashScope TTS: no audio data in response");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // OpenAI 兼容格式
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
      const errMsg = error.message || String(error);
      showError("语音播放失败：" + errMsg);
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

// ===== VRM 3D Model Functions =====

async function loadVRMModel() {
  const vrmCanvas = document.getElementById("vrm-canvas");
  const live2dCanvas = document.getElementById("live2d-canvas");
  vrmCanvas.style.display = "block";
  live2dCanvas.style.display = "none";

  const vrmConfig = state.config.vrm;

  const renderer = new THREE.WebGLRenderer({
    canvas: vrmCanvas,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: "default",
    preserveDrawingBuffer: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  vrmState.renderer = renderer;
  vrmState.canvas = vrmCanvas;

  const scene = new THREE.Scene();
  vrmState.scene = scene;

  const camera = new THREE.PerspectiveCamera(
    vrmConfig.cameraFov || 25,
    window.innerWidth / window.innerHeight,
    0.1,
    50
  );
  vrmState.camera = camera;
  // 相机距离和 FOV 后面根据模型大小自动调整

  // 天空/地面半球光（柔和自然光）
  const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x8899aa, 0.4);
  scene.add(hemiLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
  mainLight.position.set(0.5, 1, 1);
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
  fillLight.position.set(-1, 0.2, 0.5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffeedd, 0.4);
  rimLight.position.set(0, 0, -1);
  scene.add(rimLight);

  vrmState.clock = new THREE.Clock();

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const modelUrl =
    vrmConfig.resolvedModelURL ||
    new URL(vrmConfig.modelPath, window.location.href).href;

  console.log("[VRM] Loading:", modelUrl);

  const gltf = await loader.loadAsync(modelUrl);
  const vrm = gltf.userData.vrm;
  vrmState.vrm = vrm;

  scene.add(vrm.scene);

  // 替换 ShaderMaterial，丢弃描边材质减少绘制调用
  let replacedCount = 0;
  let totalVerts = 0;
  vrm.scene.traverse((child) => {
    if (child.isMesh && child.material) {
      const vertCount = child.geometry.attributes.position
        ? child.geometry.attributes.position.count
        : 0;
      totalVerts += vertCount;

      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      // 只保留第一个材质（通常是基础材质，丢弃描边轮廓材质）
      const mat = mats[0];

      if (mat.isShaderMaterial) {
        const newMat = new THREE.MeshPhongMaterial();
        if (mat.uniforms?.map?.value) {
          newMat.map = mat.uniforms.map.value;
        }
        if (mat.uniforms?.u_diffuseTexture?.value) {
          newMat.map = mat.uniforms.u_diffuseTexture.value;
        }
        const diffuseColor = mat.uniforms?.u_diffuseColor?.value;
        if (diffuseColor && typeof diffuseColor.r !== 'undefined') {
          newMat.color.setRGB(diffuseColor.r, diffuseColor.g, diffuseColor.b);
        }
        newMat.transparent = mat.transparent;
        newMat.depthWrite = mat.transparent ? false : true;
        newMat.depthTest = true;
        newMat.renderOrder = mat.transparent ? 1 : 0;
        newMat.side = mat.side || THREE.DoubleSide;
        newMat.shininess = 30;
        newMat.specular = new THREE.Color(0x333333);
        newMat.needsUpdate = true;
        child.material = newMat;
        replacedCount++;
      } else {
        mat.depthWrite = mat.transparent ? false : true;
        mat.depthTest = true;
        mat.renderOrder = mat.transparent ? 1 : 0;
        mat.needsUpdate = true;
      }

      child.renderOrder = 0;
    }
  });
  console.log("[VRM] Replaced", replacedCount, "materials, total verts:", totalVerts);

  if (totalVerts > 200000) {
    console.warn("[VRM] WARNING: Model has", totalVerts, "total vertices — may crash GPU!");
    showBubble("模型面数较高（" + Math.round(totalVerts/1000) + "K 顶点），可能影响性能。");
    setTimeout(() => hideBubble(5000), 1000);
  }

  // 自动适配模型大小
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const modelHeight = size.y;
  console.log("[VRM] Height:", modelHeight, "centerY:", center.y);

  // 自适应缩放：让模型高度约为窗口的合适比例
  const targetHeight = 1.5;
  const autoScale = targetHeight / Math.max(modelHeight, 0.01);
  const finalScale = (vrmConfig.scale || 1) * autoScale;
  console.log("[VRM] Scale:", finalScale, "original height:", modelHeight);

  vrm.scene.scale.set(finalScale, finalScale, finalScale);

  // 脚底对齐原点，模型居中
  const feetY = -(center.y - size.y / 2) * finalScale;
  const modelCenterY = targetHeight * (vrmConfig.scale || 1) / 2;
  const baseY = feetY + (vrmConfig.y || 0);
  const baseX = vrmConfig.x || 0;
  const baseZ = vrmConfig.z || 0;
  vrm.scene.position.set(baseX, baseY, baseZ);

  // 保存基准位姿（动画偏移基于此）
  vrmState.basePosition.set(baseX, baseY, baseZ);
  vrmState.baseRotation.set(0, 0, 0);

  // 自动调整相机距离（确保宽高都完整可见 + 15% 边距）
  const cameraFov = vrmConfig.cameraFov || 25;
  const fovRad = (cameraFov / 2) * Math.PI / 180;
  const manualDist = vrmConfig.cameraDistance;
  const aspect = window.innerWidth / window.innerHeight;
  const modelW = size.x * finalScale;
  const modelH = size.y * finalScale;
  const distForH = (modelH / 2) / Math.tan(fovRad);
  const distForW = (modelW / 2) / Math.tan(fovRad) / aspect;
  const autoDist = Math.max(distForH, distForW) * 1.15;
  const finalDist = manualDist || autoDist;

  const camY = modelCenterY;
  camera.position.set(0, camY, finalDist);
  camera.lookAt(0, camY, 0);

  if (vrm.lookAt) {
    vrm.lookAt.target = camera;
  }

  startVRMRenderLoop();
  console.log("[VRM] Done.");
}

function startVRMRenderLoop() {
  if (vrmState.renderLoopId) {
    cancelAnimationFrame(vrmState.renderLoopId);
  }

  const startTime = performance.now();
  let prevExprName = "neutral";
  let exprTransitionStart = 0;
  let exprTarget = "";

  const tick = () => {
    if (!vrmState.vrm) return;

    const delta = Math.min(vrmState.clock.getDelta(), 0.1);
    const elapsed = (performance.now() - startTime) / 1000;
    const vrm = vrmState.vrm;
    const bp = vrmState.basePosition;
    const br = vrmState.baseRotation;

    vrm.update(delta);

    // === 待机动画（基于基准位姿偏移） ===
    const breathe =
      Math.sin(elapsed * 1.3) * 0.025 +
      Math.sin(elapsed * 2.5 + 1.7) * 0.012;

    vrm.scene.position.set(
      bp.x,
      bp.y + breathe,
      bp.z
    );

    vrm.scene.rotation.set(
      br.x + Math.sin(elapsed * 0.35 + 5.2) * 0.03,
      br.y + Math.sin(elapsed * 0.7) * 0.04 + Math.sin(elapsed * 1.6 + 2.1) * 0.02,
      br.z + Math.sin(elapsed * 0.45 + 1.3) * 0.025
    );

    // === 视线跟随鼠标 ===
    if (vrmState.mouseOnCanvas && vrm.lookAt) {
      const mx = (vrmState.mouseX - 0.5) * 0.5;
      const my = -(vrmState.mouseY - 0.5) * 0.4;
      vrm.lookAt.lookAtTarget.set(mx, my, 1.5);
    }

    // === 平滑表情过渡 ===
    if (vrm.expressionManager) {
      const em = vrm.expressionManager;
      const exprCycle = ["happy", "neutral", "relaxed", "surprised", "neutral"];

      const cycleIdx = Math.floor(elapsed / 6) % exprCycle.length;
      const newExpr = exprCycle[cycleIdx];

      if (newExpr !== prevExprName) {
        prevExprName = newExpr;
        exprTransitionStart = elapsed;
        exprTarget = newExpr;
      }

      if (exprTarget) {
        const t = Math.min((elapsed - exprTransitionStart) / 2, 1);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        for (const name of exprCycle) {
          em.setValue(name, 0);
        }
        em.setValue(exprTarget, 0.2 * ease);
      }
    }

    vrmState.renderer.render(vrmState.scene, vrmState.camera);
    vrmState.renderLoopId = requestAnimationFrame(tick);
  };

  tick();
}

function stopVRMRender() {
  if (vrmState.renderLoopId) {
    cancelAnimationFrame(vrmState.renderLoopId);
    vrmState.renderLoopId = 0;
  }

  if (vrmState.lipSyncId) {
    cancelAnimationFrame(vrmState.lipSyncId);
    vrmState.lipSyncId = 0;
  }

  if (vrmState.renderer) {
    vrmState.renderer.dispose();
    vrmState.renderer = null;
  }

  vrmState.scene = null;
  vrmState.camera = null;
  vrmState.vrm = null;
  vrmState.clock = null;
}

function startVRMLipSync(source) {
  stopLipSync();

  const startTime = performance.now();

  const tick = () => {
    if (!source || source.paused || source.ended || !vrmState.vrm?.expressionManager) {
      if (vrmState.vrm?.expressionManager) {
        vrmState.vrm.expressionManager.setValue("aa", 0);
        vrmState.vrm.expressionManager.setValue("ih", 0);
        vrmState.vrm.expressionManager.setValue("oh", 0);
      }
      vrmState.lipSyncId = 0;
      return;
    }

    const elapsed = (performance.now() - startTime) / 1000;
    const em = vrmState.vrm.expressionManager;

    const t = source.currentTime;
    const amp =
      0.15 +
      Math.abs(Math.sin(t * 12)) * 0.5 +
      Math.abs(Math.sin(t * 18 + 1.1)) * 0.2 +
      Math.abs(Math.sin(t * 6 + 2.3)) * 0.1;

    em.setValue("aa", Math.min(amp, 1));
    em.setValue("ih", Math.min(amp * 0.25, 1));
    em.setValue("oh", Math.min(amp * 0.2, 1));

    vrmState.lipSyncId = requestAnimationFrame(tick);
  };

  tick();
}

// ===== Model Loading Dispatch =====

function loadImageAvatar() {
  const imgConfig = state.config.image || {};
  const canvasEl = document.getElementById("live2d-canvas");
  const vrmEl = document.getElementById("vrm-canvas");
  canvasEl.style.display = "none";
  vrmEl.style.display = "none";

  const src = imgConfig.src
    ? (imgConfig.src.startsWith("http") || imgConfig.src.startsWith("/")
        ? imgConfig.src
        : new URL(imgConfig.src, window.location.href).href)
    : "";

  avatarImage.onerror = () => {
    showError("图片加载失败：" + (imgConfig.src || "未设置"));
    setTimeout(() => hideBubble(4000), 500);
  };

  avatarImage.onload = () => {
    avatarImage.style.display = "block";
    if (imgConfig.idleAnimation !== false) {
      avatarImage.classList.add("avatar-idle");
    }
    const pct = Math.round((imgConfig.scale || 0.8) * 90);
    avatarImage.style.maxWidth = pct + "%";
    avatarImage.style.maxHeight = pct + "%";
  };

  avatarImage.src = src;
}

async function loadModel() {
  const modelType = state.config.modelType || "live2d";

  if (modelType === "vrm") {
    await loadVRMModel();
    return;
  }

  if (modelType === "image") {
    loadImageAvatar();
    return;
  }

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
    showError("出错了：" + (error.message || error));
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
    const modelType = state.config.modelType || "live2d";

    if (modelType === "live2d") {
      state.app = new window.PIXI.Application({
        view: canvas,
        resizeTo: window,
        transparent: true,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
      });
    }

    addInputInteractivity();
    addModelDragInteractivity();
    bindInputEvents();

    // 优先使用 Web Speech API（Chrome 内置），否则回退到本地 ASR
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
      setupWebSpeechInput();
    } else {
      setupLocalSpeechRecorder();
      bindSpeechInput();
    }
    await loadModel();

    window.addEventListener("resize", () => {
      if (modelType === "vrm") {
        if (vrmState.renderer) {
          const w = window.innerWidth;
          const h = window.innerHeight;
          vrmState.renderer.setSize(w, h);
          if (vrmState.camera) {
            vrmState.camera.aspect = w / h;
            vrmState.camera.updateProjectionMatrix();
          }
        }
      } else if (modelType !== "image") {
        placeModel();
      }
    });

    updateMousePassthrough();

    showBubble("\u51c6\u5907\u597d\u4e86\uff0c\u6765\u804a\u5929\u5427\u3002");
    hideBubble(1800);
  } catch (error) {
    console.error("Bootstrap failed:", error);
    showError("初始化失败：" + (error.message || error));
  }
}

void bootstrap();

const fs = require("fs");
const path = require("path");
const os = require("os");
const { promisify } = require("util");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const { WebSocket } = require("ws");
const { app, BrowserWindow, session, Menu, Tray, ipcMain, nativeImage, protocol, net, globalShortcut, screen } = require("electron");

// GPU / WebGL 兼容性配置 — 强制软件渲染绕过 D3D11 驱动崩溃
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("use-gl", "angle");
app.commandLine.appendSwitch("use-angle", "swiftshader");

const APP_ROOT = __dirname;
const CONFIG_PATH = path.join(APP_ROOT, "config.json");
const ASSETS_ROOT = path.join(APP_ROOT, "assets");
const TEMP_ROOT = path.join(APP_ROOT, ".runtime-temp");
const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 600;
const SOVITS_ROOT = "F:\\You\\GPT-SoVITS\\GPT-SoVITS-v2pro-20250604";
const SOVITS_PYTHON = path.join(SOVITS_ROOT, "runtime", "python.exe");
const SOVITS_FFMPEG = path.join(SOVITS_ROOT, "runtime", "ffmpeg.exe");
const ASR_HELPER = path.join(APP_ROOT, "scripts", "local_asr.py");
const execFileAsync = promisify(execFile);

let mainWindow = null;
let tray = null;
let isQuitting = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "vtuber",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function getTrayIcon() {
  const modelThumb = path.join(
    APP_ROOT,
    "assets",
    "live2d",
    "ggc-10qpt01",
    "10qpt01__l2d_355.u_thumbnail.png"
  );

  if (fs.existsSync(modelThumb)) {
    try {
      const imageBuffer = fs.readFileSync(modelThumb);
      const image = nativeImage.createFromBuffer(imageBuffer);
      if (!image.isEmpty()) {
        return image.resize({ width: 16, height: 16 });
      }
    } catch (error) {
      console.warn("Failed to create tray icon from model thumbnail:", error);
    }
  }

  const transparentPixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK4AAAAAASUVORK5CYII=";
  return nativeImage
    .createFromBuffer(Buffer.from(transparentPixel, "base64"))
    .resize({ width: 16, height: 16 });
}

function registerAssetProtocol() {
  protocol.handle("vtuber", (request) => {
    const requestURL = new URL(request.url);
    const relativePath = path.posix.join(requestURL.hostname || "", requestURL.pathname || "");
    const normalizedRelativePath = decodeURIComponent(relativePath).replace(/^\/+/, "");
    const targetPath = path.normalize(path.join(ASSETS_ROOT, normalizedRelativePath));

    if (!targetPath.startsWith(ASSETS_ROOT)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(targetPath)) {
      return new Response("Not Found", { status: 404 });
    }

    return net.fetch(pathToFileURL(targetPath).toString());
  });
}

function resolveModelURL(config) {
  const configuredPath = config?.live2d?.modelPath;
  if (!configuredPath) {
    return null;
  }

  const absolutePath = path.resolve(APP_ROOT, "renderer", configuredPath);
  if (!absolutePath.startsWith(ASSETS_ROOT)) {
    return null;
  }

  const relativePath = path.relative(ASSETS_ROOT, absolutePath).replace(/\\/g, "/");
  return `vtuber://${relativePath}`;
}

function resolveVRMModelURL(config) {
  const configuredPath = config?.vrm?.modelPath;
  if (!configuredPath) {
    return null;
  }

  const absolutePath = path.resolve(APP_ROOT, "renderer", configuredPath);
  if (!absolutePath.startsWith(ASSETS_ROOT)) {
    return null;
  }

  const relativePath = path.relative(ASSETS_ROOT, absolutePath).replace(/\\/g, "/");
  return `vtuber://${relativePath}`;
}

function clampWindowPosition(x, y) {
  if (!mainWindow) {
    return { x, y };
  }

  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const workArea = display.workArea;

  const minVisibleWidth = Math.min(160, bounds.width);
  const minVisibleHeight = Math.min(120, bounds.height);

  const minX = workArea.x - bounds.width + minVisibleWidth;
  const maxX = workArea.x + workArea.width - minVisibleWidth;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - minVisibleHeight;

  return {
    x: Math.min(Math.max(Math.round(x), minX), maxX),
    y: Math.min(Math.max(Math.round(y), minY), maxY),
  };
}

async function ensureTempRoot() {
  await fs.promises.mkdir(TEMP_ROOT, { recursive: true });
}

function base64ToBuffer(base64) {
  return Buffer.from(base64, "base64");
}

function extensionFromMimeType(mimeType) {
  if (mimeType?.includes("webm")) return ".webm";
  if (mimeType?.includes("wav")) return ".wav";
  if (mimeType?.includes("ogg")) return ".ogg";
  if (mimeType?.includes("mpeg")) return ".mp3";
  return ".bin";
}

async function convertAudioToWav(inputPath, outputPath) {
  await execFileAsync(
    SOVITS_FFMPEG,
    ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath],
    { cwd: SOVITS_ROOT, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }
  );
}

async function transcribeWithLocalAsr(audioPath, language = "zh") {
  const { stdout } = await execFileAsync(
    SOVITS_PYTHON,
    [ASR_HELPER, SOVITS_ROOT, audioPath, language],
    { cwd: SOVITS_ROOT, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }
  );

  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const resultLine = [...lines].reverse().find((line) => line.startsWith("ASR_RESULT:"));
  if (!resultLine) {
    throw new Error("Local ASR did not return a transcription result.");
  }

  return resultLine.slice("ASR_RESULT:".length).trim();
}

function toggleWindowVisibility() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip("Desktop AI VTuber");
  tray.on("click", toggleWindowVisibility);
  tray.on("double-click", toggleWindowVisibility);

  const menu = Menu.buildFromTemplate([
    {
      label: "\u663e\u793a/\u9690\u85cf",
      click: toggleWindowVisibility,
    },
    {
      label: "\u9000\u51fa",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 320,
    minHeight: 480,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    icon: getTrayIcon(),
    webPreferences: {
      preload: path.join(APP_ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const topLevel = process.platform === "darwin" ? "floating" : "screen-saver";
  mainWindow.setAlwaysOnTop(true, topLevel);
  mainWindow.loadFile(path.join(APP_ROOT, "renderer", "index.html"));

  mainWindow.webContents.openDevTools({ mode: "detach" });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

ipcMain.on("set-ignore-mouse-events", (_event, payload) => {
  if (!mainWindow) {
    return;
  }

  const ignore = Boolean(payload?.ignore);
  mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on("resize-window", (_event, payload) => {
  if (!mainWindow) {
    return;
  }

  const width = Number(payload?.width);
  const height = Number(payload?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return;
  }

  mainWindow.setSize(Math.max(320, Math.round(width)), Math.max(480, Math.round(height)));
});

ipcMain.on("set-window-position", (_event, payload) => {
  if (!mainWindow) {
    return;
  }

  const x = Number(payload?.x);
  const y = Number(payload?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }

  const next = clampWindowPosition(x, y);
  mainWindow.setPosition(next.x, next.y);
});

ipcMain.handle("get-config", () => {
  const config = readConfig();
  return {
    ...config,
    live2d: {
      ...config.live2d,
      resolvedModelURL: resolveModelURL(config),
    },
    vrm: {
      ...config.vrm,
      resolvedModelURL: resolveVRMModelURL(config),
    },
    appRoot: APP_ROOT,
  };
});

ipcMain.handle("get-window-bounds", () => {
  if (!mainWindow) {
    return null;
  }

  return mainWindow.getBounds();
});

ipcMain.handle("transcribe-audio", async (_event, payload) => {
  const audioBase64 = payload?.audioBase64;
  const mimeType = payload?.mimeType || "audio/webm";
  const language = payload?.language || "zh";

  if (!audioBase64) {
    throw new Error("Missing audio data.");
  }

  await ensureTempRoot();

  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = path.join(TEMP_ROOT, `mic-${nonce}${extensionFromMimeType(mimeType)}`);
  const wavPath = path.join(TEMP_ROOT, `mic-${nonce}.wav`);

  try {
    await fs.promises.writeFile(inputPath, base64ToBuffer(audioBase64));
    await convertAudioToWav(inputPath, wavPath);
    const text = await transcribeWithLocalAsr(wavPath, language);
    return { text };
  } finally {
    await Promise.allSettled([
      fs.promises.rm(inputPath, { force: true }),
      fs.promises.rm(wavPath, { force: true }),
    ]);
  }
});

// ===== DashScope Paraformer 实时 ASR WebSocket（main 进程）=====
// 在 main 进程管理 WebSocket，因为浏览器原生 WebSocket 不支持自定义 header
// DashScope API 要求 Authorization: Bearer <key> 在握手阶段传入

const asrConnections = new Map();

ipcMain.handle("asr-start", async (event) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const apiKey = config.llm?.apiKey;
    if (!apiKey) return { ok: false, error: "未配置 API Key" };

    const connId = String(Date.now());
    const win = BrowserWindow.fromWebContents(event.sender);

    return new Promise((resolve) => {
      const ws = new WebSocket("wss://dashscope.aliyuncs.com/api-ws/v1/inference", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      let resolved = false;
      const done = (result) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve(result);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          header: { action: "run-task", task_id: connId, streaming: "duplex" },
          payload: {
            task_group: "audio", task: "asr", function: "recognition",
            model: "paraformer-realtime-v2",
            parameters: { format: "opus", sample_rate: 16000, language_hints: ["zh"], punctuation_prediction_enabled: true },
            input: {},
          },
        }));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (!resolved) {
            if (msg.header?.event === "task-started") {
              asrConnections.set(connId, { ws, win });
              done({ ok: true, connId });
            } else if (msg.header?.event === "task-failed") {
              const errMsg = msg.header?.error_message || "Task failed";
              ws.close();
              done({ ok: false, error: errMsg });
            }
          }
          win.webContents.send("asr-event", { connId, data: msg });
        } catch {}
      });

      ws.on("error", (err) => {
        if (!resolved) done({ ok: false, error: err.message || "WebSocket error" });
        win.webContents.send("asr-event", { connId, error: err.message });
      });

      ws.on("close", () => {
        if (!resolved) done({ ok: false, error: "Connection closed" });
        asrConnections.delete(connId);
        win.webContents.send("asr-event", { connId, closed: true });
      });

      const timeout = setTimeout(() => {
        if (!resolved) {
          try { ws.close(); } catch {}
          done({ ok: false, error: "Connection timeout" });
        }
      }, 10000);
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on("asr-audio", (_event, { connId, audioData }) => {
  const conn = asrConnections.get(connId);
  if (conn?.ws?.readyState === WebSocket.OPEN) {
    conn.ws.send(Buffer.from(audioData));
  }
});

ipcMain.on("asr-finish", (_event, { connId }) => {
  const conn = asrConnections.get(connId);
  if (conn?.ws?.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify({ header: { action: "finish-task", task_id: connId } }));
  }
});

ipcMain.on("asr-close", (_event, { connId }) => {
  const conn = asrConnections.get(connId);
  if (conn) {
    try { conn.ws.close(); } catch {}
    asrConnections.delete(connId);
  }
});

app.whenReady().then(() => {
  registerAssetProtocol();
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Alt+V", toggleWindowVisibility);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }

    if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

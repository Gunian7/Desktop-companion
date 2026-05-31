const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  getWindowBounds: () => ipcRenderer.invoke("get-window-bounds"),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse-events", { ignore }),
  setWindowPosition: (x, y) => ipcRenderer.send("set-window-position", { x, y }),
  resizeWindow: (width, height) => ipcRenderer.send("resize-window", { width, height }),
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
  // DashScope Paraformer 实时 ASR（main 进程 WebSocket）
  startAsr: () => ipcRenderer.invoke("asr-start"),
  onAsrEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("asr-event", handler);
    return () => ipcRenderer.removeListener("asr-event", handler);
  },
  sendAsrAudio: (connId, audioData) => ipcRenderer.send("asr-audio", { connId, audioData }),
  finishAsr: (connId) => ipcRenderer.send("asr-finish", { connId }),
  closeAsr: (connId) => ipcRenderer.send("asr-close", { connId }),
});

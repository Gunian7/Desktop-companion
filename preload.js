const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  getWindowBounds: () => ipcRenderer.invoke("get-window-bounds"),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse-events", { ignore }),
  setWindowPosition: (x, y) => ipcRenderer.send("set-window-position", { x, y }),
  resizeWindow: (width, height) => ipcRenderer.send("resize-window", { width, height }),
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
  asrConnect: (token) => ipcRenderer.invoke("asr-connect", token),
  asrSendText: (text) => ipcRenderer.send("asr-send-text", text),
  asrSendAudio: (buffer) => ipcRenderer.send("asr-send-audio", buffer),
  asrClose: () => ipcRenderer.send("asr-close"),
  onAsrMessage: (callback) => ipcRenderer.on("asr-message", (_e, data) => callback(data)),
  onAsrClosed: (callback) => ipcRenderer.on("asr-closed", () => callback()),
});

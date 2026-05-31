const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  getWindowBounds: () => ipcRenderer.invoke("get-window-bounds"),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send("set-ignore-mouse-events", { ignore }),
  setWindowPosition: (x, y) => ipcRenderer.send("set-window-position", { x, y }),
  resizeWindow: (width, height) => ipcRenderer.send("resize-window", { width, height }),
  transcribeAudio: (payload) => ipcRenderer.invoke("transcribe-audio", payload),
  getAsrToken: () => ipcRenderer.invoke("asr-get-token"),
});

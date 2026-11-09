// Ana süreç ile ekran (renderer) arasında güvenli köprü
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onConfig: (cb) => ipcRenderer.on('config', (_e, v) => cb(v)),
  onWindows: (cb) => ipcRenderer.on('windows', (_e, v) => cb(v)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, v) => cb(v)),
});

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  saveNote: (text, name) => ipcRenderer.invoke('save-note', text, name),
  openNote: () => ipcRenderer.invoke('open-note'),
  exportPdf: (images, name) => ipcRenderer.invoke('export-pdf', images, name),
  exportPng: (dataUrl, name) => ipcRenderer.invoke('export-png', dataUrl, name),
  autosave: (text) => ipcRenderer.invoke('autosave', text),
  loadAutosave: () => ipcRenderer.invoke('load-autosave')
});

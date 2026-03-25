"use strict";
const electron = require("electron");
const api = {
  startGlobalClickCapture: () => electron.ipcRenderer.invoke("clicks:start"),
  stopGlobalClickCapture: () => electron.ipcRenderer.invoke("clicks:stop"),
  getGlobalClickEvents: () => electron.ipcRenderer.invoke("clicks:get"),
  getGlobalClickStatus: () => electron.ipcRenderer.invoke("clicks:status"),
  getDesktopSources: async () => {
    return await electron.ipcRenderer.invoke("desktop:sources");
  },
  saveRecording: async (suggestedName, data) => {
    return await electron.ipcRenderer.invoke("recording:save", {
      suggestedName,
      data
    });
  },
  listDrafts: () => electron.ipcRenderer.invoke("drafts:list"),
  loadDraft: (id) => electron.ipcRenderer.invoke("drafts:load", { id }),
  saveDraft: (draft) => electron.ipcRenderer.invoke("drafts:save", draft),
  pickVideoFile: () => electron.ipcRenderer.invoke("system:pickVideoFile"),
  revealInFolder: (path) => electron.ipcRenderer.invoke("system:revealInFolder", { path }),
  openScreenRecordingPreferences: () => electron.ipcRenderer.invoke("system:openScreenRecordingPreferences"),
  openAccessibilityPreferences: () => electron.ipcRenderer.invoke("system:openAccessibilityPreferences"),
  openInputMonitoringPreferences: () => electron.ipcRenderer.invoke("system:openInputMonitoringPreferences"),
  runNativeExport: (payload) => electron.ipcRenderer.invoke("export:runNative", payload),
  cancelNativeExport: (jobId) => electron.ipcRenderer.invoke("export:cancelNative", { jobId }),
  onGlobalClick: (cb) => {
    const handler = (_event, payload) => cb(payload);
    electron.ipcRenderer.on("clicks:event", handler);
    return () => electron.ipcRenderer.removeListener("clicks:event", handler);
  },
  onNativeExportProgress: (cb) => {
    const handler = (_event, payload) => cb(payload);
    electron.ipcRenderer.on("export:progress", handler);
    return () => electron.ipcRenderer.removeListener("export:progress", handler);
  }
};
electron.contextBridge.exposeInMainWorld("clickStudio", api);

import { contextBridge, ipcRenderer, desktopCapturer } from "electron";
const api = {
  startGlobalClickCapture: () => ipcRenderer.invoke("clicks:start"),
  stopGlobalClickCapture: () => ipcRenderer.invoke("clicks:stop"),
  getGlobalClickEvents: () => ipcRenderer.invoke("clicks:get"),
  getGlobalClickStatus: () => ipcRenderer.invoke("clicks:status"),
  getDesktopSourceId: async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
    const screenSource = sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
    if (!screenSource) throw new Error("No desktop capture sources available");
    return screenSource.id;
  },
  getDesktopSources: async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL()
    }));
  },
  saveRecording: async (suggestedName, data) => {
    return await ipcRenderer.invoke("recording:save", {
      suggestedName,
      data
    });
  },
  openScreenRecordingPreferences: () => ipcRenderer.invoke("system:openScreenRecordingPreferences"),
  openAccessibilityPreferences: () => ipcRenderer.invoke("system:openAccessibilityPreferences"),
  openInputMonitoringPreferences: () => ipcRenderer.invoke("system:openInputMonitoringPreferences"),
  onGlobalClick: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("clicks:event", handler);
    return () => ipcRenderer.removeListener("clicks:event", handler);
  }
};
contextBridge.exposeInMainWorld("clickStudio", api);

import { contextBridge, ipcRenderer, desktopCapturer } from "electron";

export type GlobalClickEvent = {
  t: number;
  xNorm: number;
  yNorm: number;
};

export type StartClickCaptureResult =
  | { ok: true }
  | { ok: false; error: { message: string } };

export type DesktopSource = {
  id: string;
  name: string;
  thumbnailDataUrl: string;
};

export type SaveRecordingResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: true; error?: { message: string } };

const api = {
  startGlobalClickCapture: () =>
    ipcRenderer.invoke("clicks:start") as Promise<StartClickCaptureResult>,
  stopGlobalClickCapture: () =>
    ipcRenderer.invoke("clicks:stop") as Promise<GlobalClickEvent[]>,
  getGlobalClickEvents: () =>
    ipcRenderer.invoke("clicks:get") as Promise<GlobalClickEvent[]>,
  getGlobalClickStatus: () =>
    ipcRenderer.invoke("clicks:status") as Promise<{ running: boolean; lastError: string | null }>,
  getDesktopSourceId: async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
    // Prefer full screen capture when available.
    const screenSource = sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
    if (!screenSource) throw new Error("No desktop capture sources available");
    return screenSource.id;
  },
  getDesktopSources: async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });

    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    })) as DesktopSource[];
  },
  saveRecording: async (suggestedName: string, data: Uint8Array) => {
    return (await ipcRenderer.invoke("recording:save", {
      suggestedName,
      data,
    })) as SaveRecordingResult;
  },
  openScreenRecordingPreferences: () =>
    ipcRenderer.invoke("system:openScreenRecordingPreferences") as Promise<boolean>,
  openAccessibilityPreferences: () =>
    ipcRenderer.invoke("system:openAccessibilityPreferences") as Promise<boolean>,
  openInputMonitoringPreferences: () =>
    ipcRenderer.invoke("system:openInputMonitoringPreferences") as Promise<boolean>,
  onGlobalClick: (cb: (e: GlobalClickEvent) => void) => {
    const handler = (_event: unknown, payload: GlobalClickEvent) => cb(payload);
    ipcRenderer.on("clicks:event", handler);
    return () => ipcRenderer.removeListener("clicks:event", handler);
  },
};

contextBridge.exposeInMainWorld("clickStudio", api);

export type ClickStudioApi = typeof api;


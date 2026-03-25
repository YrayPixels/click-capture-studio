import { contextBridge, ipcRenderer } from "electron";

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

export type DraftSummary = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
};

export type DraftFile = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  data: unknown;
};

export type PickVideoFileResult =
  | { canceled: true }
  | { canceled: false; path: string };

export type NativeExportPayload = {
  inputPath: string;
  segments: Array<{ srcStart: number; srcEnd: number }>;
  format: "mp4" | "webm";
  quality: "720p" | "1080p" | "2160p";
  backgroundIndex?: number;
  paddingPct?: number;
  defaultZoomMode?: "off" | "low" | "medium" | "high";
  defaultZoomDuration?: number;
  showMenu?: boolean;
  clicks?: Array<{
    tOut: number;
    xNorm: number;
    yNorm: number;
    enabled?: boolean;
    zoomModeOverride?: "off" | "low" | "medium" | "high";
    zoomDurationOverride?: number;
  }>;
  cameraOverlay?: {
    enabled: boolean;
    path: string | null;
    sizePct: number;
    shape?: "rect" | "circle";
  };
};

export type NativeExportResult =
  | { ok: true; path: string; jobId: string }
  | { ok: false; error: { message: string }; jobId?: string; cancelled?: boolean };

export type NativeExportProgress = {
  jobId: string;
  progress: number;
  status: "starting" | "encoding" | "done" | "error" | "cancelled";
  message?: string;
};

const api = {
  startGlobalClickCapture: () =>
    ipcRenderer.invoke("clicks:start") as Promise<StartClickCaptureResult>,
  stopGlobalClickCapture: () =>
    ipcRenderer.invoke("clicks:stop") as Promise<GlobalClickEvent[]>,
  getGlobalClickEvents: () =>
    ipcRenderer.invoke("clicks:get") as Promise<GlobalClickEvent[]>,
  getGlobalClickStatus: () =>
    ipcRenderer.invoke("clicks:status") as Promise<{ running: boolean; lastError: string | null }>,
  getDesktopSources: async () => {
    return (await ipcRenderer.invoke("desktop:sources")) as DesktopSource[];
  },
  saveRecording: async (suggestedName: string, data: Uint8Array) => {
    return (await ipcRenderer.invoke("recording:save", {
      suggestedName,
      data,
    })) as SaveRecordingResult;
  },
  listDrafts: () => ipcRenderer.invoke("drafts:list") as Promise<DraftSummary[]>,
  loadDraft: (id: string) => ipcRenderer.invoke("drafts:load", { id }) as Promise<DraftFile>,
  saveDraft: (draft: DraftFile) =>
    ipcRenderer.invoke("drafts:save", draft) as Promise<{ ok: true; id: string }>,
  pickVideoFile: () =>
    ipcRenderer.invoke("system:pickVideoFile") as Promise<PickVideoFileResult>,
  revealInFolder: (path: string) =>
    ipcRenderer.invoke("system:revealInFolder", { path }) as Promise<
      { ok: true } | { ok: false; error?: { message: string } }
    >,
  openScreenRecordingPreferences: () =>
    ipcRenderer.invoke("system:openScreenRecordingPreferences") as Promise<boolean>,
  openAccessibilityPreferences: () =>
    ipcRenderer.invoke("system:openAccessibilityPreferences") as Promise<boolean>,
  openInputMonitoringPreferences: () =>
    ipcRenderer.invoke("system:openInputMonitoringPreferences") as Promise<boolean>,
  runNativeExport: (payload: NativeExportPayload) =>
    ipcRenderer.invoke("export:runNative", payload) as Promise<NativeExportResult>,
  cancelNativeExport: (jobId: string) =>
    ipcRenderer.invoke("export:cancelNative", { jobId }) as Promise<{ ok: boolean }>,
  onGlobalClick: (cb: (e: GlobalClickEvent) => void) => {
    const handler = (_event: unknown, payload: GlobalClickEvent) => cb(payload);
    ipcRenderer.on("clicks:event", handler);
    return () => ipcRenderer.removeListener("clicks:event", handler);
  },
  onNativeExportProgress: (cb: (e: NativeExportProgress) => void) => {
    const handler = (_event: unknown, payload: NativeExportProgress) => cb(payload);
    ipcRenderer.on("export:progress", handler);
    return () => ipcRenderer.removeListener("export:progress", handler);
  },
};

contextBridge.exposeInMainWorld("clickStudio", api);

export type ClickStudioApi = typeof api;


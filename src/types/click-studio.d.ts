export {};

declare global {
  type GlobalClickEvent = {
    t: number;
    xNorm: number;
    yNorm: number;
  };

  type StartClickCaptureResult =
    | { ok: true }
    | { ok: false; error: { message: string } };

  type DesktopSource = {
    id: string;
    name: string;
    thumbnailDataUrl: string;
  };

  type SaveRecordingResult =
    | { ok: true; path: string }
    | { ok: false; canceled?: true; error?: { message: string } };

  type DraftSummary = {
    id: string;
    title: string;
    updatedAt: string;
    createdAt?: string;
  };

  type DraftFile = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    data: unknown;
  };

  type PickVideoFileResult =
    | { canceled: true }
    | { canceled: false; path: string };

  type NativeExportPayload = {
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

  type NativeExportResult =
    | { ok: true; path: string; jobId: string }
    | { ok: false; error: { message: string }; jobId?: string; cancelled?: boolean };

  type NativeExportProgress = {
    jobId: string;
    progress: number;
    status: "starting" | "encoding" | "done" | "error" | "cancelled";
    message?: string;
  };

  interface Window {
    clickStudio?: {
      startGlobalClickCapture: () => Promise<StartClickCaptureResult>;
      stopGlobalClickCapture: () => Promise<GlobalClickEvent[]>;
      getGlobalClickEvents: () => Promise<GlobalClickEvent[]>;
      getGlobalClickStatus: () => Promise<{ running: boolean; lastError: string | null }>;
      getDesktopSources: () => Promise<DesktopSource[]>;
      saveRecording: (suggestedName: string, data: Uint8Array) => Promise<SaveRecordingResult>;
      listDrafts: () => Promise<DraftSummary[]>;
      loadDraft: (id: string) => Promise<DraftFile>;
      saveDraft: (draft: DraftFile) => Promise<{ ok: true; id: string }>;
      pickVideoFile: () => Promise<PickVideoFileResult>;
      revealInFolder: (
        path: string
      ) => Promise<{ ok: true } | { ok: false; error?: { message: string } }>;
      openScreenRecordingPreferences: () => Promise<boolean>;
      openAccessibilityPreferences: () => Promise<boolean>;
      openInputMonitoringPreferences: () => Promise<boolean>;
      onGlobalClick: (cb: (e: GlobalClickEvent) => void) => () => void;
      runNativeExport: (payload: NativeExportPayload) => Promise<NativeExportResult>;
      cancelNativeExport: (jobId: string) => Promise<{ ok: boolean }>;
      onNativeExportProgress: (cb: (e: NativeExportProgress) => void) => () => void;
    };
  }
}


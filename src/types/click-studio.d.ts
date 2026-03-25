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
      openScreenRecordingPreferences: () => Promise<boolean>;
      openAccessibilityPreferences: () => Promise<boolean>;
      openInputMonitoringPreferences: () => Promise<boolean>;
      onGlobalClick: (cb: (e: GlobalClickEvent) => void) => () => void;
    };
  }
}


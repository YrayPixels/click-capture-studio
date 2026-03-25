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

  interface Window {
    clickStudio?: {
      startGlobalClickCapture: () => Promise<StartClickCaptureResult>;
      stopGlobalClickCapture: () => Promise<GlobalClickEvent[]>;
      getGlobalClickEvents: () => Promise<GlobalClickEvent[]>;
      getGlobalClickStatus: () => Promise<{ running: boolean; lastError: string | null }>;
      getDesktopSources: () => Promise<DesktopSource[]>;
      saveRecording: (suggestedName: string, data: Uint8Array) => Promise<SaveRecordingResult>;
      openScreenRecordingPreferences: () => Promise<boolean>;
      openAccessibilityPreferences: () => Promise<boolean>;
      openInputMonitoringPreferences: () => Promise<boolean>;
      onGlobalClick: (cb: (e: GlobalClickEvent) => void) => () => void;
    };
  }
}


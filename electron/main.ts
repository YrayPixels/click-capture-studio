import { app, BrowserWindow, screen, ipcMain, session, desktopCapturer, shell, dialog } from "electron";
import path from "path";
import { performance } from "node:perf_hooks";
import { uIOhook } from "uiohook-napi";
import fs from "node:fs/promises";

type ClickEvent = {
  t: number;
  xNorm: number;
  yNorm: number;
};

let mainWindow: BrowserWindow | null = null;

let clickEvents: ClickEvent[] = [];
let clickStartPerfNow: number | null = null;
let clickCaptureRunning = false;
let clickListenerRegistered = false;
let lastClickCaptureError: { message: string } | null = null;

// Enable screen-capture APIs in Electron renderer (especially on http://localhost dev origins).
app.commandLine.appendSwitch("enable-usermedia-screen-capturing");
app.commandLine.appendSwitch("allow-http-screen-capture");
app.commandLine.appendSwitch(
  "unsafely-treat-insecure-origin-as-secure",
  "http://localhost:8080,http://localhost:8081,http://localhost:8082"
);

function setClickCaptureRunning(next: boolean) {
  clickCaptureRunning = next;
}

function normalizeClick(x: number, y: number): { xNorm: number; yNorm: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  const b = display.bounds;
  const w = b.width || 1;
  const h = b.height || 1;
  const xNorm = Math.min(1, Math.max(0, (x - b.x) / w));
  const yNorm = Math.min(1, Math.max(0, (y - b.y) / h));
  return { xNorm, yNorm };
}

function startGlobalClickCapture() {
  clickEvents = [];
  clickStartPerfNow = performance.now();
  lastClickCaptureError = null;

  if (!clickCaptureRunning) {
    if (!clickListenerRegistered) {
      uIOhook.on("mousedown", (e) => {
        if (clickStartPerfNow == null) return;
        const t = (performance.now() - clickStartPerfNow) / 1000;
        if (t < 0) return;
        const { xNorm, yNorm } = normalizeClick(e.x, e.y);
        const evt = { t, xNorm, yNorm };
        clickEvents.push(evt);
        // Stream events to renderer so we can show a live click counter.
        mainWindow?.webContents.send("clicks:event", evt);
      });
      clickListenerRegistered = true;
    }
    try {
      uIOhook.start();
      setClickCaptureRunning(true);
      return { ok: true as const };
    } catch (e) {
      const msg =
        (e as { message?: string } | null)?.message ||
        "Failed to start global click capture. macOS may require Accessibility/Input Monitoring permission.";
      console.error("[clicks] failed to start uIOhook", e);
      lastClickCaptureError = { message: msg };
      setClickCaptureRunning(false);
      return { ok: false as const, error: { message: msg } };
    }
  }
  return { ok: true as const };
}

function stopGlobalClickCapture() {
  clickStartPerfNow = null;
  if (clickCaptureRunning) {
    // uIOhook doesn't expose a per-listener remove for anonymous fns,
    // so we just stop() and reset all listeners.
    uIOhook.stop();
    uIOhook.removeAllListeners("mousedown");
    // We removed the listener, so allow re-registering on next start.
    clickListenerRegistered = false;
    setClickCaptureRunning(false);
  }
  return clickEvents;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite outputs preload as `preload.mjs` in dev.
      preload: path.join(__dirname, "../preload/preload.mjs"),
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  // Broader permission handling than just request prompts. Electron can deny access
  // at multiple stages (check/request/device), and dev origins can be treated as insecure.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, _details) => {
    if (permission === "media") return true;
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    // Allow media permission prompts in dev (camera/mic/screen).
    if (permission === "media") return callback(true);
    callback(false);
  });

  session.defaultSession.setDevicePermissionHandler((_details) => {
    // Allow camera/microphone device usage in dev.
    return true;
  });

  // Electron requires an explicit handler to pick which screen/window to share.
  // Without this, getDisplayMedia() can fail in the Electron renderer while it works in Chrome.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const screenSource = sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
      if (!screenSource) return callback({});
      callback({ video: screenSource });
    } catch (e) {
      console.error("[recording] setDisplayMediaRequestHandler failed", e);
      callback({});
    }
  });

  ipcMain.handle("clicks:status", () => {
    return {
      running: clickCaptureRunning,
      lastError: lastClickCaptureError?.message ?? null,
    };
  });

  ipcMain.handle("system:openScreenRecordingPreferences", async () => {
    if (process.platform !== "darwin") return false;
    // Opens System Settings > Privacy & Security > Screen Recording (macOS)
    // Works on most modern macOS versions; if it fails, user can still navigate manually.
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      );
      return true;
    } catch (e) {
      console.error("[recording] failed to open Screen Recording preferences", e);
      return false;
    }
  });

  ipcMain.handle("system:openAccessibilityPreferences", async () => {
    if (process.platform !== "darwin") return false;
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      );
      return true;
    } catch (e) {
      console.error("[clicks] failed to open Accessibility preferences", e);
      return false;
    }
  });

  ipcMain.handle("system:openInputMonitoringPreferences", async () => {
    if (process.platform !== "darwin") return false;
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
      );
      return true;
    } catch (e) {
      console.error("[clicks] failed to open Input Monitoring preferences", e);
      return false;
    }
  });

  ipcMain.handle("clicks:start", () => {
    return startGlobalClickCapture();
  });

  ipcMain.handle("clicks:stop", () => {
    const events = stopGlobalClickCapture();
    return events;
  });

  ipcMain.handle("clicks:get", () => {
    return clickEvents;
  });

  ipcMain.handle(
    "recording:save",
    async (_event, payload: { suggestedName: string; data: Uint8Array }) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: payload.suggestedName,
        filters: [{ name: "WebM Video", extensions: ["webm"] }],
      });
      if (canceled || !filePath) return { ok: false as const, canceled: true as const };

      await fs.writeFile(filePath, payload.data);
      return { ok: true as const, path: filePath };
    }
  );

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


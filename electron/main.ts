import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  session,
  desktopCapturer,
  shell,
  protocol,
  dialog,
} from "electron";
import path from "path";
import { performance } from "node:perf_hooks";
import { uIOhook } from "uiohook-napi";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";

// Make `clickstudio://` behave like a standard secure scheme so <video> can load it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "clickstudio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

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

type DraftPayload = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  data: unknown;
};

function getDraftsDir() {
  const docs = app.getPath("documents");
  return path.join(docs, "click-studio", "drafts");
}

function getRecordingsDir() {
  const docs = app.getPath("documents");
  return path.join(docs, "click-studio", "recordings");
}

function getVideosDir() {
  const docs = app.getPath("documents");
  return path.join(docs, "click-studio", "videos");
}

async function ensureDraftsDir() {
  const dir = getDraftsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function ensureRecordingsDir() {
  const dir = getRecordingsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function ensureVideosDir() {
  const dir = getVideosDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

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
  const preloadPath = path.join(__dirname, "../preload/preload.cjs");
  try {
    await fs.access(preloadPath);
  } catch (e) {
    console.error("[preload] preload file not found at", preloadPath, e);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite outputs preload as `preload.cjs` (CommonJS).
      preload: preloadPath,
    },
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath2, error) => {
    console.error("[preload] error", { preloadPath: preloadPath2, error });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  // Allow the renderer to load local media files via a safe custom protocol.
  protocol.registerStreamProtocol("clickstudio", async (request, callback) => {
    try {
      const u = new URL(request.url);
      // `clickstudio:///Users/...` => pathname "/Users/..."
      // `clickstudio://Users/...`  => hostname "Users", pathname "/..." (missing leading segment)
      const rawPath = decodeURIComponent(u.pathname);
      const host = decodeURIComponent(u.hostname || "");
      const reconstructedHostPath =
        host && rawPath.startsWith("/") ? `/${host}${rawPath}` : null;
      const primaryPath = reconstructedHostPath ?? rawPath;

      const resolveCandidatePath = async () => {
        const candidates: string[] = [];

        // Most requests come in as absolute paths (e.g. /Users/...).
        candidates.push(primaryPath);

        // Some older drafts saved just a filename, which becomes `clickstudio:///recording-....webm`
        // and arrives here as `/recording-....webm`. Resolve those into our known Documents dirs.
        const looksLikeBareFilename =
          primaryPath.startsWith("/") &&
          !primaryPath.startsWith("/Users/") &&
          primaryPath.split("/").length === 2;
        if (looksLikeBareFilename) {
          const base = primaryPath.replace(/^\/+/, "");
          candidates.push(path.join(getVideosDir(), base));
          candidates.push(path.join(getRecordingsDir(), base));
        }

        for (const c of candidates) {
          try {
            const st = await fs.stat(c);
            return { path: c, size: st.size };
          } catch {
            // try next
          }
        }
        throw new Error(`clickstudio file not found: ${primaryPath}`);
      };

      const { path: filePath, size } = await resolveCandidatePath();

      const headers: Record<string, string> = {
        // Most of our captures are webm.
        "Content-Type": filePath.toLowerCase().endsWith(".webm") ? "video/webm" : "application/octet-stream",
        "Accept-Ranges": "bytes",
      };

      const rangeHeader =
        (request.headers?.Range as string | undefined) ??
        (request.headers?.range as string | undefined);

      if (rangeHeader) {
        // Example: "bytes=0-1023"
        const m = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim());
        if (!m) {
          callback({ statusCode: 416, headers });
          return;
        }

        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : size - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
          callback({ statusCode: 416, headers });
          return;
        }

        const safeEnd = Math.min(end, size - 1);
        const chunkSize = safeEnd - start + 1;

        headers["Content-Range"] = `bytes ${start}-${safeEnd}/${size}`;
        headers["Content-Length"] = String(chunkSize);

        callback({
          statusCode: 206,
          headers,
          data: createReadStream(filePath, { start, end: safeEnd }),
        });
        return;
      }

      headers["Content-Length"] = String(size);
      callback({
        statusCode: 200,
        headers,
        data: createReadStream(filePath),
      });
    } catch (e) {
      console.error("[protocol] clickstudio failed", e);
      callback({ statusCode: 404 });
    }
  });

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

  ipcMain.handle("desktop:sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    }));
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

  ipcMain.handle("system:pickVideoFile", async () => {
    const res = await dialog.showOpenDialog({
      title: "Select a video file",
      properties: ["openFile"],
      filters: [
        { name: "Video", extensions: ["webm", "mp4", "mov"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (res.canceled) return { canceled: true as const };
    const filePath = res.filePaths?.[0];
    if (!filePath) return { canceled: true as const };
    return { canceled: false as const, path: filePath };
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
      try {
        const dir = await ensureVideosDir();
        const safeName = payload.suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = path.join(dir, safeName);
        await fs.writeFile(filePath, payload.data);
        console.info("[recording] saved", { filePath, bytes: payload.data?.byteLength ?? 0 });
        return { ok: true as const, path: filePath };
      } catch (e) {
        const msg = (e as { message?: string } | null)?.message || "Failed to save recording";
        console.error("[recording] save failed", e);
        return { ok: false as const, error: { message: msg } };
      }
    }
  );

  ipcMain.handle("drafts:list", async () => {
    const dir = await ensureDraftsDir();
    const entries = await fs.readdir(dir).catch(() => []);
    const drafts: Array<{ id: string; title: string; updatedAt: string; createdAt?: string }> = [];

    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      try {
        const raw = await fs.readFile(file, "utf8");
        const parsed = JSON.parse(raw) as Partial<DraftPayload>;
        const id = String(parsed.id ?? name.replace(/\.json$/i, ""));
        const title = String(parsed.title ?? "Untitled draft");
        const updatedAt = String(parsed.updatedAt ?? parsed.createdAt ?? new Date(0).toISOString());
        const createdAt = parsed.createdAt ? String(parsed.createdAt) : undefined;
        drafts.push({ id, title, updatedAt, createdAt });
      } catch {
        // ignore unreadable draft
      }
    }

    drafts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return drafts;
  });

  ipcMain.handle("drafts:load", async (_event, payload: { id: string }) => {
    const dir = await ensureDraftsDir();
    const safeId = payload.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const file = path.join(dir, `${safeId}.json`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as DraftPayload;
    return parsed;
  });

  ipcMain.handle("drafts:save", async (_event, payload: DraftPayload) => {
    const dir = await ensureDraftsDir();
    const safeId = payload.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const file = path.join(dir, `${safeId}.json`);

    const next: DraftPayload = {
      id: safeId,
      title: String(payload.title ?? "Untitled draft"),
      createdAt: String(payload.createdAt ?? new Date().toISOString()),
      updatedAt: String(payload.updatedAt ?? new Date().toISOString()),
      data: payload.data ?? null,
    };

    await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
    return { ok: true as const, id: safeId };
  });

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


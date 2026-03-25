# Click Studio

Click Studio is an Electron desktop app for **screen recording with click markers** and a **built-in editor** for fast, click-focused edits.

## Features

- **Record**: Screen, camera, or both
- **Audio**: System audio + microphone (mixed to a single track when needed)
- **Click tracking**: Captures global clicks in Electron (with a browser fallback)
- **Drafts**: Saves drafts locally so you can resume editing from Home

## Tech stack

- Electron + `electron-vite`
- Vite + React + TypeScript
- Tailwind + shadcn/ui

## Getting started

### Prerequisites

- Node.js + npm
- macOS users: you may need to grant **Accessibility** and/or **Input Monitoring** permissions for global click tracking.

### Install

```sh
npm install
```

### Run (Electron app)

```sh
npm run electron:dev
```

### Run (web-only UI)

This starts Vite without Electron (useful for UI work, but Electron-only features like desktop capture picking and global click capture won’t work).

```sh
npm run dev
```

## Build

### Build app bundles

```sh
npm run electron:build
```

### Build macOS distributable

```sh
npm run dist:mac
```

## Troubleshooting

### Global click tracking is disabled (macOS)

If you see an error about global click tracking being disabled, enable permissions for Click Studio:

- **System Settings → Privacy & Security → Accessibility**
- **System Settings → Privacy & Security → Input Monitoring**

Then fully quit and restart the app.

### Recording works in browser but not in Electron

In Electron, screen capture relies on an in-app picker that provides a `chromeMediaSourceId`. If no source is selected, recording will fail.

## Scripts

- `npm run dev`: Vite dev server (web-only)
- `npm run build`: Vite build (web assets)
- `npm run electron:dev`: Electron dev (recommended)
- `npm run electron:build`: Build Electron main/preload + renderer
- `npm run electron:preview`: Preview built Electron app
- `npm run dist:mac`: Build + package for macOS via electron-builder

# AMP — Abdu Music Player

AMP is a local-first music player made with browser-native HTML, CSS, and JavaScript. It has no build step, framework, package manager, remote media API, or audio upload service.

## Run locally

Serve this folder from a local web server (ES modules and Service Workers do not work reliably from `file://`):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. HTTPS or localhost is required for Service Worker registration and PWA installation. The app can also be hosted as static files on GitHub Pages; all asset paths are relative so a repository subpath is supported.

## Use AMP

- Choose **Add music** or drag audio files into the app. Supported extensions are MP3, M4A/MP4, AAC, WAV, OGG, and FLAC, subject to the browser’s actual decoder support.
- Imported audio and library data stay in this browser’s IndexedDB. AMP does not upload audio.
- Use the persistent player for playback, seek, volume, speed, repeat, shuffle, and queue. Press `/` to focus search; Space toggles playback; Left/Right seek; Up/Down change volume; M mutes; N/P change tracks. Shortcuts are ignored while editing a form.
- Create playlists from the Playlists page. Track metadata, favorites, listening history, and lyrics are stored locally.
- In Settings, export a `.ampbackup` before moving browsers or clearing site data. Restoring a backup merges its tracks and playlists; a matching track ID is replaced.

## Architecture

- [app.js](./app.js) bootstraps the interface and coordinates page interactions.
- [src/storage.js](./src/storage.js) owns IndexedDB schema upgrades, repositories, playlist operations, and validated backup/restore.
- [src/audio-engine.js](./src/audio-engine.js) wraps the media element, playback events, and object URL cleanup.
- [src/queue.js](./src/queue.js) implements queue navigation and repeat/shuffle state.
- [src/file-importer.js](./src/file-importer.js) validates formats and stores tracks without using filenames as keys.
- [src/equalizer.js](./src/equalizer.js) provides optional Web Audio filters and a canvas spectrum visualizer.
- [sw.js](./sw.js) caches application resources only. User audio remains in IndexedDB and is never placed in Cache API.

The IndexedDB database keeps its AMP 1.0 `songs` object store and migrates each recoverable entry into separate `tracks` and `audioFiles` stores. It does not delete the legacy store. New tracks use unique IDs, so same-named files can coexist.

## Offline, install, and browser limitations

After one successful load while online, the Service Worker caches the app shell and JavaScript modules. The library remains in IndexedDB and is available offline after reload. Cache cleanup only removes older AMP app-shell caches; it does not touch IndexedDB.

Installation prompts differ by browser. Chromium browsers may expose an in-app install prompt; Safari/iOS generally requires **Share → Add to Home Screen**. Service Workers and installation require HTTPS, except localhost. Browser storage can be quota-limited or evicted by the browser; keep an external backup of important files.

Audio decoding depends on the device and browser; file extensions do not guarantee codec support. Some mobile browsers suspend audio when the app is backgrounded or the device locks, and Media Session controls are not universally available. Equalizer processing depends on Web Audio support and may be restricted until a user gesture. AMP cannot guarantee background playback on every mobile platform.

## Browser tests

With the same local server running, open `http://localhost:8000/tests/test-runner.html`. The page runs checks for legacy IndexedDB migration, duplicate imports, queue behavior, safe deletion, favorites, backup/restore, invalid input, and object URL cleanup using the browser’s native APIs.

The browser test page does not certify real-device installation, background playback, or offline behavior on every platform. Verify those separately on the browsers and devices you intend to support.

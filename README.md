# Soundplayer

**A small floating music player for macOS: a panel that stays above your other windows, with a folder-based library you can organise by dragging, and self-updates.**

Electron · React · TypeScript

<!-- Add a screenshot at docs/screenshot.png and uncomment:
![Soundplayer: the floating panel with the library list open](docs/screenshot.png)
-->

Most music apps want a full window and their own database. I wanted something that sits in a corner of the screen while I work, plays songs from a plain folder, and lets me sort that folder without opening Finder. Soundplayer is that panel.

## Features

- **Floating panel:** a small frameless window that stays above other windows, follows you to every desktop and over full-screen apps, and remembers where you left it on screen.
- **Playback:** play/pause, previous/next, seek, volume, and repeat-one. Volume and repeat are remembered between launches. "Previous" more than 3 seconds into a song restarts it, like a hardware player.
- **Library in a plain folder:** songs live in `~/Desktop/mp3`, created on first launch. The list browses it with breadcrumbs and an up button.
- **Organise without Finder:**
  - create folders,
  - rename songs and folders (the file extension is kept),
  - drag a song or folder onto another folder, the up button or a breadcrumb to move it,
  - delete to the Trash, never permanently.
- **Adding music:** drop files from Finder on the panel or on a folder row, or pick them with the + button. They are copied into the library and the originals stay where they were.
- **Playing a folder:** double-click a song to play its folder from that song on. On launch the queue is the top level of the library.
- **Changes follow the queue:** renaming or moving the playing song, or the folder it's in, doesn't interrupt it. The list refreshes when you come back to the window, so changes made in Finder show up too.
- **Compact mode:** hide the list and the panel shrinks to just the controls.
- **Finder integration:** Soundplayer appears in *Open With* for audio files and plays files dropped on its Dock icon (from where they are, without copying).
- **Self-updating:** on launch, Soundplayer checks GitHub Releases and offers to install a newer version.

Supported formats: MP3, M4A, AAC, WAV, FLAC, OGG and Opus.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward 5 seconds |
| Enter | Confirm a rename |
| Esc | Cancel a rename |

## Engineering highlights

- **A custom `track://` protocol with range requests.** [`trackProtocol.ts`](src/main/trackProtocol.ts) streams files from disk and answers `Range` requests with `206 Partial Content`, which `<audio>` needs to seek. The protocol serves audio files only, so the page can't use it to read arbitrary files.
- **The library is fenced in the main process.** Every path the page sends is resolved and checked against the library folder before anything is touched ([`library.ts`](src/main/library.ts)). The library folder itself can't be renamed, moved or deleted, a folder can't be moved into itself, and name clashes are reported instead of overwriting.
- **The queue follows files on disk.** After a rename or move, queued paths are remapped, including songs inside a moved folder. If the playing file changed, it's reopened at the same position and in the same play/pause state.
- **Race-free "Open With".** macOS can send `open-file` before the window, or even the app, is ready. The main process buffers the files, and the page collects them when it starts.
- **A self-updater without a framework.** [`updater.ts`](src/main/updater.ts) compares semver against the latest GitHub release and extracts the zip with `ditto`, which preserves Electron's framework symlinks. A detached shell process swaps the app bundle only after the app has quit, then relaunches it. The updater detects macOS App Translocation and folders without write access, and falls back to the release page with a clear message.

## Architecture

```
src/
  main/       Electron main process: window, library file operations, track protocol, updater
  preload/    the typed API exposed to the page as window.api
  renderer/   React UI: player controls and the library list
  shared/     types and constants shared by both sides
scripts/      release script and an Electron install fix
```

**Stack:** Electron 33, React 18, TypeScript (strict), electron-vite, electron-builder. There are no runtime dependencies beyond React.

## Install

1. Download `Soundplayer-<version>-arm64.dmg` (or `Soundplayer-<version>-arm64-mac.zip`) from the [latest release](https://github.com/g-krzysztof/soundplayer/releases/latest).
2. Move `Soundplayer.app` to **Applications**.
3. The app is not signed with an Apple certificate, so remove the download quarantine once:
   ```sh
   xattr -cr /Applications/Soundplayer.app
   ```
   Without this step macOS reports that **"Soundplayer" is damaged and can't be opened**, and right-click → Open doesn't help. The file isn't damaged. The browser marks downloads as quarantined, and macOS then refuses an unsigned app. You only need to do this once per Mac. Updates installed from inside the app aren't quarantined.

Builds target Apple Silicon (arm64) Macs. The interface is in Polish.

## Updates

On every launch Soundplayer checks the latest release in this repository. If a newer version exists, it asks whether to install it. If you agree, Soundplayer:

1. downloads the zip,
2. quits,
3. replaces `Soundplayer.app`,
4. relaunches.

For this to work, the app must live in a folder you can write to, usually **Applications**, not in Downloads or inside the mounted dmg. The repository must also be public. If installation fails, the app offers to open the release page so you can download the new version manually.

## Development

Requires macOS, Node.js 22+ (for electron-builder 26) and npm.

```sh
npm install        # installs dependencies (a postinstall script fixes Electron's unpacking on Node 26)
npm run dev        # run with hot reload
npm run typecheck  # TypeScript, both main and renderer
npm run dist:mac   # build Soundplayer.app into dist/mac-arm64 (no installer)
```

The app doesn't check for updates in development mode.

### Releasing

One-time setup: install the [GitHub CLI](https://cli.github.com) and run `gh auth login`.

For each release:

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.2.0`), commit and push.
2. Run:
   ```sh
   npm run release:mac
   ```
   [`scripts/release.sh`](scripts/release.sh) builds the zip and dmg and publishes them as GitHub release `v<version>`.
3. Installed copies offer the update on their next launch.

The repository the app updates from is set in `REPO` in [`src/main/updater.ts`](src/main/updater.ts).

## License

[MIT](LICENSE)

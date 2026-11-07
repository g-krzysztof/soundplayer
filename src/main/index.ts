import { app, dialog, ipcMain, screen, shell, BrowserWindow, type WebContents } from 'electron'
import { basename, extname, join } from 'path'
import { AUDIO_EXTENSIONS, type Track } from '../shared/types'
import { registerLibrary } from './library'
import { registerTrackProtocol, registerTrackScheme } from './trackProtocol'
import { checkForUpdates } from './updater'
import { loadState, savePlaylist, trackPosition, visiblePosition } from './windowState'

registerTrackScheme()

const WIDTH = 360
const COMPACT_HEIGHT = 112
const PLAYLIST_HEIGHT = 260
const MIN_PLAYLIST_HEIGHT = 120

let playlistHeight = PLAYLIST_HEIGHT
let playlistOpen = true
// The playlist height when the current drag on the resize handle started.
let resizeStart = PLAYLIST_HEIGHT

// Tall enough for a few rows, short enough that the window stays on its display.
function clampPlaylistHeight(window: BrowserWindow, height: number): number {
  const { workArea } = screen.getDisplayMatching(window.getBounds())
  return Math.round(Math.min(Math.max(height, MIN_PLAYLIST_HEIGHT), workArea.height - COMPACT_HEIGHT))
}

const windowHeight = (): number => COMPACT_HEIGHT + (playlistOpen ? playlistHeight : 0)

function toTrack(filePath: string): Track {
  return { path: filePath, title: basename(filePath, extname(filePath)) }
}

const isAudio = (filePath: string): boolean => AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())

// Files opened from Finder (double-click on an associated file, Open With, or a drop
// on the Dock icon). macOS can send them before the window exists, even before `ready`,
// so they wait here until the page asks for them on start.
let pendingTracks: Track[] = []
let pageContents: WebContents | null = null
let mainWindow: BrowserWindow | null = null

app.on('open-file', (event, filePath) => {
  if (!isAudio(filePath)) return
  event.preventDefault()
  const track = toTrack(filePath)
  if (pageContents && !pageContents.isDestroyed()) {
    pageContents.send('tracks:opened', [track])
    mainWindow?.show()
    return
  }
  pendingTracks.push(track)
  // The app keeps running on macOS with every window closed.
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow()
})

function createWindow(): void {
  // A small frameless panel that floats over other windows instead of a regular app window.
  const state = loadState()
  playlistHeight = state.playlistHeight ?? PLAYLIST_HEIGHT
  playlistOpen = state.playlistOpen ?? true
  const window = new BrowserWindow({
    width: WIDTH,
    height: windowHeight(),
    ...visiblePosition(state),
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    transparent: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    hasShadow: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = window
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  trackPosition(window)

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerTrackProtocol()

  ipcMain.handle('tracks:takeOpened', (event): Track[] => {
    pageContents = event.sender
    const tracks = pendingTracks
    pendingTracks = []
    return tracks
  })

  ipcMain.handle('tracks:choose', async (event): Promise<Track[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXTENSIONS].map((ext) => ext.slice(1)) }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths.filter(isAudio).map(toTrack)
  })

  registerLibrary()

  ipcMain.on('window:setPlaylistOpen', (event, open: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || open === playlistOpen) return
    playlistOpen = open
    savePlaylist({ playlistOpen })
    window.setSize(WIDTH, windowHeight(), true)
  })
  ipcMain.on('window:resizeStart', () => {
    resizeStart = playlistHeight
  })
  // `dy` is how far the pointer has moved since the drag started, so rounding never accumulates.
  ipcMain.on('window:resizePlaylist', (event, dy: number) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !playlistOpen) return
    const height = clampPlaylistHeight(window, resizeStart + dy)
    if (height === playlistHeight) return
    playlistHeight = height
    savePlaylist({ playlistHeight })
    window.setSize(WIDTH, windowHeight())
  })
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())

  createWindow()
  checkForUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// A player with no window has nothing left to do, so closing it quits on every platform.
app.on('window-all-closed', () => app.quit())

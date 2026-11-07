import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Listing, Moved, Track } from '../shared/types'

const api = {
  takeOpenedTracks: (): Promise<Track[]> => ipcRenderer.invoke('tracks:takeOpened'),
  onTracksOpened: (callback: (tracks: Track[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tracks: Track[]): void => callback(tracks)
    ipcRenderer.on('tracks:opened', listener)
    return () => ipcRenderer.removeListener('tracks:opened', listener)
  },
  chooseTracks: (): Promise<Track[]> => ipcRenderer.invoke('tracks:choose'),
  // Files dropped on the window; File.path is gone in Electron 32+, webUtils replaces it.
  pathsForFiles: (files: File[]): string[] => files.map((file) => webUtils.getPathForFile(file)),
  library: {
    list: (dir?: string): Promise<Listing> => ipcRenderer.invoke('library:list', dir),
    createFolder: (parent: string): Promise<string> => ipcRenderer.invoke('library:createFolder', parent),
    rename: (from: string, name: string): Promise<Moved> => ipcRenderer.invoke('library:rename', from, name),
    move: (from: string, toDir: string): Promise<Moved> => ipcRenderer.invoke('library:move', from, toDir),
    trash: (path: string): Promise<void> => ipcRenderer.invoke('library:trash', path),
    import: (paths: string[], toDir: string): Promise<void> => ipcRenderer.invoke('library:import', paths, toDir)
  },
  setPlaylistOpen: (open: boolean): void => ipcRenderer.send('window:setPlaylistOpen', open),
  resizeStart: (): void => ipcRenderer.send('window:resizeStart'),
  resizePlaylist: (dy: number): void => ipcRenderer.send('window:resizePlaylist', dy),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  close: (): void => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

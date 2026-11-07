import { app, screen, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface Position {
  x: number
  y: number
}

interface WindowState extends Partial<Position> {
  playlistHeight?: number
  playlistOpen?: boolean
}

const statePath = (): string => join(app.getPath('userData'), 'window.json')

function readState(): WindowState {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as WindowState
  } catch {
    return {}
  }
}

let state: WindowState = {}
let timer: NodeJS.Timeout | undefined

// Writes are debounced so dragging the window or the resize handle doesn't hit the disk on every frame.
function saveState(patch: WindowState): void {
  state = { ...state, ...patch }
  clearTimeout(timer)
  timer = setTimeout(() => writeFileSync(statePath(), JSON.stringify(state)), 300)
}

export function loadState(): WindowState {
  state = readState()
  return state
}

// The last spot the player was dragged to, if it is still on a connected display.
export function visiblePosition({ x, y }: WindowState): Position | undefined {
  if (x === undefined || y === undefined) return undefined
  const visible = screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height)
  return visible ? { x, y } : undefined
}

export function trackPosition(window: BrowserWindow): void {
  window.on('moved', () => {
    if (window.isDestroyed()) return
    const [x, y] = window.getPosition()
    saveState({ x, y })
  })
}

export function savePlaylist(patch: Pick<WindowState, 'playlistHeight' | 'playlistOpen'>): void {
  saveState(patch)
}

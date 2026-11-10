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
  // Player position per monitor setup (e.g. laptop alone vs. laptop + external display).
  positions?: Record<string, Position>
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

// Monitor setup identified by the set of connected displays only. Resolution, Dock and menu bar
// changes alter bounds/workArea, so including them would make the key unstable.
function displayLayout(): string {
  return screen.getAllDisplays().map(({ id }) => id).sort((a, b) => a - b).join(',')
}

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

// The given spot, if it is still on a connected display.
function visiblePosition({ x, y }: Partial<Position>): Position | undefined {
  if (x === undefined || y === undefined) return undefined
  const visible = screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height)
  return visible ? { x, y } : undefined
}

// Where the player was last placed in the current monitor setup, falling back to the last known spot.
export function positionForCurrentLayout(windowState: WindowState): Position | undefined {
  const position = windowState.positions?.[displayLayout()]
  return (position && visiblePosition(position)) ?? visiblePosition(windowState)
}

// macOS fires several display events and relocates windows itself while monitors are switched.
// Moves during that settle period are not the user's, so they are not saved.
const SETTLE_MS = 1000

export function trackPosition(window: BrowserWindow): void {
  let activeLayout = displayLayout()
  let settling: NodeJS.Timeout | undefined

  window.on('moved', () => {
    if (window.isDestroyed() || settling || displayLayout() !== activeLayout) return
    const [x, y] = window.getPosition()
    saveState({ x, y, positions: { ...state.positions, [activeLayout]: { x, y } } })
  })

  const restoreLayoutPosition = (): void => {
    settling = undefined
    if (window.isDestroyed()) return
    const layout = displayLayout()
    const changed = layout !== activeLayout
    activeLayout = layout
    const saved = state.positions?.[layout]
    const position = saved && visiblePosition(saved)
    if (position) {
      const [x, y] = window.getPosition()
      if (x !== position.x || y !== position.y) window.setPosition(position.x, position.y)
    } else if (changed) {
      // First time in this setup: remember wherever macOS put the player.
      const [x, y] = window.getPosition()
      saveState({ positions: { ...state.positions, [layout]: { x, y } } })
    }
  }

  const onDisplayChange = (): void => {
    clearTimeout(settling)
    settling = setTimeout(restoreLayoutPosition, SETTLE_MS)
  }

  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
  window.on('closed', () => {
    clearTimeout(settling)
    screen.off('display-added', onDisplayChange)
    screen.off('display-removed', onDisplayChange)
    screen.off('display-metrics-changed', onDisplayChange)
  })
}

export function savePlaylist(patch: Pick<WindowState, 'playlistHeight' | 'playlistOpen'>): void {
  saveState(patch)
}

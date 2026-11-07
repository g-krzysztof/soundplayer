import { app, screen, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface Position {
  x: number
  y: number
}

const statePath = (): string => join(app.getPath('userData'), 'window.json')

// The last spot the player was dragged to, if it is still on a connected display.
export function loadPosition(): Position | undefined {
  try {
    const { x, y } = JSON.parse(readFileSync(statePath(), 'utf8')) as Position
    const visible = screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height)
    return visible ? { x, y } : undefined
  } catch {
    return undefined
  }
}

export function trackPosition(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | undefined
  window.on('moved', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (window.isDestroyed()) return
      const [x, y] = window.getPosition()
      writeFileSync(statePath(), JSON.stringify({ x, y }))
    }, 300)
  })
}

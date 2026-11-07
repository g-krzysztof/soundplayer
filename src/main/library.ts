import { app, ipcMain, shell } from 'electron'
import { constants } from 'fs'
import { copyFile, mkdir, readdir, rename, stat } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import { AUDIO_EXTENSIONS, type Entry, type Listing, type Moved } from '../shared/types'

// The library is a plain folder on the Desktop; the list in the app browses it.
const root = (): string => join(app.getPath('desktop'), 'mp3')

const isAudio = (filePath: string): boolean => AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())

// Every path from the renderer is checked: nothing outside the library may be touched,
// and the library folder itself can't be renamed, moved or deleted.
function inLibrary(filePath: string, allowRoot = false): string {
  const resolved = resolve(filePath)
  const rel = relative(root(), resolved)
  const inside = rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
  if (!inside || (!allowRoot && rel === '')) throw new Error('Ścieżka poza folderem mp3')
  return resolved
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false
  )
}

// "name", then "name 2", "name 3"… — for new folders and copied files.
async function freePath(dir: string, name: string, ext = ''): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = join(dir, `${n === 1 ? name : `${name} ${n}`}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
}

function checkName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\:]/.test(trimmed)) throw new Error('Niepoprawna nazwa')
  return trimmed
}

const byName = (a: Entry, b: Entry): number => a.name.localeCompare(b.name, 'pl', { numeric: true })

async function list(dir?: string): Promise<Listing> {
  await mkdir(root(), { recursive: true })
  let path = dir ? inLibrary(dir, true) : root()
  // The folder may have been removed in Finder meanwhile.
  if (!(await stat(path).then((s) => s.isDirectory(), () => false))) path = root()

  const folders: Entry[] = []
  const tracks: Entry[] = []
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue
    const itemPath = join(path, item.name)
    if (item.isDirectory()) folders.push({ name: item.name, path: itemPath })
    else if (item.isFile() && isAudio(item.name)) tracks.push({ name: basename(item.name, extname(item.name)), path: itemPath })
  }

  const crumbs: Entry[] = [{ name: basename(root()), path: root() }]
  for (const part of relative(root(), path).split(sep).filter(Boolean)) {
    crumbs.push({ name: part, path: join(crumbs[crumbs.length - 1].path, part) })
  }

  return {
    path,
    crumbs,
    folders: folders.sort(byName),
    tracks: tracks.sort(byName).map(({ name, path }) => ({ title: name, path }))
  }
}

async function createFolder(parent: string): Promise<string> {
  const path = await freePath(inLibrary(parent, true), 'Nowy folder')
  await mkdir(path)
  return path
}

async function renameItem(from: string, name: string): Promise<Moved> {
  const source = inLibrary(from)
  let target = checkName(name)
  // Files are renamed without their extension, which stays as it was.
  if ((await stat(source)).isFile()) {
    const ext = extname(source)
    if (target.toLowerCase().endsWith(ext.toLowerCase())) target = target.slice(0, -ext.length)
    target = checkName(target) + ext
  }
  const to = join(dirname(source), target)
  if (to === source) return { from: source, to }
  // Case-only renames point at the same file on macOS, so they're not a clash.
  if (to.toLowerCase() !== source.toLowerCase() && (await exists(to))) throw new Error('Element o tej nazwie już istnieje')
  await rename(source, to)
  return { from: source, to }
}

async function move(from: string, toDir: string): Promise<Moved> {
  const source = inLibrary(from)
  const dir = inLibrary(toDir, true)
  if (dirname(source) === dir) return { from: source, to: source }
  if (dir === source || dir.startsWith(source + sep)) throw new Error('Nie można przenieść folderu do niego samego')
  const to = join(dir, basename(source))
  if (await exists(to)) throw new Error('Element o tej nazwie już istnieje w folderze docelowym')
  await rename(source, to)
  return { from: source, to }
}

// Files dropped from outside or picked with the dialog are copied in; originals stay put.
async function importFiles(paths: string[], toDir: string): Promise<void> {
  const dir = inLibrary(toDir, true)
  for (const path of paths) {
    if (!isAudio(path) || !(await stat(path).then((s) => s.isFile(), () => false))) continue
    const ext = extname(path)
    await copyFile(path, await freePath(dir, basename(path, ext), ext), constants.COPYFILE_EXCL)
  }
}

export function registerLibrary(): void {
  ipcMain.handle('library:list', (_event, dir?: string) => list(dir))
  ipcMain.handle('library:createFolder', (_event, parent: string) => createFolder(parent))
  ipcMain.handle('library:rename', (_event, from: string, name: string) => renameItem(from, name))
  ipcMain.handle('library:move', (_event, from: string, toDir: string) => move(from, toDir))
  // To the Trash rather than gone for good, so a misclick can be undone in Finder.
  ipcMain.handle('library:trash', (_event, path: string) => shell.trashItem(inLibrary(path)))
  ipcMain.handle('library:import', (_event, paths: string[], toDir: string) => importFiles(paths, toDir))
}

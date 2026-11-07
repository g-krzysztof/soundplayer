import { app, dialog, shell } from 'electron'
import { spawn, execFile } from 'child_process'
import { access, constants, mkdtemp, readdir, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { promisify } from 'util'

// Releases are published here by `npm run release:mac` (scripts/release.sh).
const REPO = 'g-krzysztof/soundplayer'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

interface Release {
  tag_name: string
  assets: { name: string; browser_download_url: string }[]
}

function isNewer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

// On start, asks GitHub for the latest release and offers to install it. A failed check
// (offline, rate limit) is silent; the next start tries again.
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  let release: Release
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    if (!response.ok) return
    release = await response.json()
  } catch {
    return
  }
  const version = release.tag_name.replace(/^v/, '')
  if (!isNewer(version, app.getVersion())) return
  const zip = release.assets.find((asset) => asset.name.endsWith('-mac.zip'))
  if (!zip) return

  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `Dostępna jest nowa wersja Soundplayera (${version})`,
    detail: `Masz wersję ${app.getVersion()}. Aplikacja pobierze aktualizację i uruchomi się ponownie.`,
    buttons: ['Aktualizuj', 'Później'],
    defaultId: 0,
    cancelId: 1
  })
  if (response !== 0) return

  try {
    await install(zip.browser_download_url)
  } catch (error) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: 'Nie udało się zainstalować aktualizacji',
      detail: `${error instanceof Error ? error.message : error}\n\nMożesz pobrać ją ręcznie ze strony wydania.`,
      buttons: ['Otwórz stronę wydania', 'Zamknij'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 0) shell.openExternal(RELEASES_URL)
  }
}

async function install(zipUrl: string): Promise<void> {
  // process.execPath is <bundle>/Contents/MacOS/Soundplayer.
  const bundle = resolve(process.execPath, '../../..')
  if (bundle.includes('/AppTranslocation/')) {
    throw new Error('Aplikacja działa z tymczasowej lokalizacji macOS. Przenieś Soundplayer.app do folderu Programy.')
  }
  await access(dirname(bundle), constants.W_OK)

  const response = await fetch(zipUrl)
  if (!response.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${response.status})`)
  const workDir = await mkdtemp(join(app.getPath('temp'), 'soundplayer-update-'))
  const zipPath = join(workDir, 'update.zip')
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))
  // ditto keeps the symlinks inside Electron's frameworks, which unzip tools may not.
  await promisify(execFile)('ditto', ['-x', '-k', zipPath, workDir])
  const appName = (await readdir(workDir)).find((name) => name.endsWith('.app'))
  if (!appName) throw new Error('Archiwum aktualizacji nie zawiera aplikacji')

  // The running bundle is swapped only after this process exits, then the new one is opened.
  const script = 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; rm -rf "$2" && mv "$3" "$2" && open "$2"'
  spawn('/bin/sh', ['-c', script, 'sh', String(process.pid), bundle, join(workDir, appName)], {
    detached: true,
    stdio: 'ignore'
  }).unref()
  app.quit()
}

// Electron's own postinstall unzips with extract-zip, which on Node 26 exits
// silently halfway through and leaves node_modules/electron/dist without the
// app binary or path.txt. This re-extracts the zip Electron already put in the
// download cache, using macOS's ditto so framework symlinks survive.
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const electronDir = join(import.meta.dirname, '..', 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')
const binary = 'Electron.app/Contents/MacOS/Electron'

if (process.platform !== 'darwin' || existsSync(pathTxt)) process.exit(0)

const { version } = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], { cwd: electronDir }).toString())
const zipName = `electron-v${version}-darwin-${process.arch}.zip`
const cacheDir = join(homedir(), 'Library', 'Caches', 'electron')

const zipPath = existsSync(cacheDir)
  ? readdirSync(cacheDir)
      .map((hash) => join(cacheDir, hash, zipName))
      .find((candidate) => existsSync(candidate))
  : undefined

if (!zipPath) {
  console.error(`fix-electron: ${zipName} not in ${cacheDir} — run "node install.js" in node_modules/electron first`)
  process.exit(1)
}

const distDir = join(electronDir, 'dist')
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir)
execFileSync('ditto', ['-x', '-k', zipPath, distDir])
writeFileSync(pathTxt, binary)
console.log(`fix-electron: extracted ${zipName}`)

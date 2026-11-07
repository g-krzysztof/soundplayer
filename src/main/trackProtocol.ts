import { protocol } from 'electron'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'
import { AUDIO_EXTENSIONS, TRACK_SCHEME } from '../shared/types'

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
}

// Must run before app 'ready' — Chromium only accepts scheme privileges then.
export function registerTrackScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: TRACK_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

// track://local/?p=<absolute path>
// <audio> seeks with Range requests; without 206 answers the seek bar can't jump.
export function registerTrackProtocol(): void {
  protocol.handle(TRACK_SCHEME, async (request) => {
    const filePath = new URL(request.url).searchParams.get('p')
    const ext = filePath ? extname(filePath).toLowerCase() : ''

    // Only ever serve audio — the renderer must not be able to read arbitrary files.
    if (!filePath || !AUDIO_EXTENSIONS.has(ext)) return new Response(null, { status: 400 })

    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      return new Response(null, { status: 404 })
    }

    const headers: Record<string, string> = { 'content-type': MIME[ext], 'accept-ranges': 'bytes' }
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    if (!range) {
      headers['content-length'] = String(size)
      return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, { headers })
    }

    const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0)
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    }
    headers['content-range'] = `bytes ${start}-${end}/${size}`
    headers['content-length'] = String(end - start + 1)
    return new Response(Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream, {
      status: 206,
      headers
    })
  })
}

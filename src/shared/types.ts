export const TRACK_SCHEME = 'track'

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus'])

export interface Track {
  path: string
  // File name without the extension.
  title: string
}

export interface Entry {
  name: string
  path: string
}

// One folder of the library, as shown in the list.
export interface Listing {
  path: string
  // From the library root down to this folder.
  crumbs: Entry[]
  folders: Entry[]
  tracks: Track[]
}

export interface Moved {
  from: string
  to: string
}

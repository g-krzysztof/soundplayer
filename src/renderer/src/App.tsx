import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import { TRACK_SCHEME, type Entry, type Listing, type Moved, type Track } from '../../shared/types'

function trackUrl(track: Track): string {
  return `${TRACK_SCHEME}://local/?${new URLSearchParams({ p: track.path })}`
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const VOLUME_KEY = 'volume'
const REPEAT_ONE_KEY = 'repeatOne'
const SHOW_REMAINING_KEY = 'showRemaining'
const PLAYLIST_OPEN_KEY = 'playlistOpen'

// Drags that start in the list carry the item's path under this type; Finder drags carry Files.
const ITEM_DRAG = 'application/x-soundplayer-item'

// Electron prefixes errors thrown in the main process with the IPC channel name.
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  window.alert(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}

// A queued track (or one inside a folder) follows its file when it's renamed or moved.
function remapPath(path: string, { from, to }: Moved): string | null {
  if (path === from) return to
  if (path.startsWith(from + '/')) return to + path.slice(from.length)
  return null
}

const titleOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  )
}

export default function App(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [current, setCurrent] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME_KEY) ?? 0.8))
  const [repeatOne, setRepeatOne] = useState(() => localStorage.getItem(REPEAT_ONE_KEY) === 'true')
  const [showRemaining, setShowRemaining] = useState(() => localStorage.getItem(SHOW_REMAINING_KEY) === 'true')
  const [playlistOpen, setPlaylistOpen] = useState(() => localStorage.getItem(PLAYLIST_OPEN_KEY) !== 'false')
  const [dragOver, setDragOver] = useState(false)
  const [listing, setListing] = useState<Listing | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // Position to resume at when the playing file is renamed or moved and has to be reopened.
  const resumeRef = useRef<{ time: number; playing: boolean } | null>(null)

  const track = tracks[current] as Track | undefined

  // New files go to the end of the list; if nothing is playing, the first of them starts.
  const addTracks = useCallback((added: Track[], play: boolean) => {
    if (added.length === 0) return
    setTracks((list) => {
      if (play) setCurrent(list.length)
      return [...list, ...added]
    })
  }, [])

  const openFolder = useCallback(async (dir?: string): Promise<Listing | null> => {
    try {
      const next = await window.api.library.list(dir)
      setListing(next)
      return next
    } catch (error) {
      showError(error)
      return null
    }
  }, [])

  const refresh = useCallback(() => openFolder(listing?.path), [openFolder, listing?.path])

  // On start the queue is the top of the library, unless the app was opened with files.
  useEffect(() => {
    Promise.all([openFolder(), window.api.takeOpenedTracks()]).then(([root, opened]) => {
      if (opened.length > 0) addTracks(opened, true)
      else if (root) setTracks((list) => (list.length > 0 ? list : root.tracks))
    })
    return window.api.onTracksOpened((opened) => addTracks(opened, true))
  }, [addTracks, openFolder])

  // Files may be changed in Finder while the player sits in the background.
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const trackSrc = track ? trackUrl(track) : null

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!trackSrc) {
      audio.removeAttribute('src')
      audio.load()
      return
    }
    audio.src = trackSrc
    const resume = resumeRef.current
    resumeRef.current = null
    if (resume) audio.currentTime = resume.time
    if (!resume || resume.playing) audio.play().catch(() => setPlaying(false))
  }, [trackSrc])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
    localStorage.setItem(VOLUME_KEY, String(volume))
  }, [volume])

  // With loop set the element restarts the track itself and never fires `ended`.
  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = repeatOne
    localStorage.setItem(REPEAT_ONE_KEY, String(repeatOne))
  }, [repeatOne])

  useEffect(() => localStorage.setItem(SHOW_REMAINING_KEY, String(showRemaining)), [showRemaining])

  useEffect(() => {
    window.api.setPlaylistOpen(playlistOpen)
    localStorage.setItem(PLAYLIST_OPEN_KEY, String(playlistOpen))
  }, [playlistOpen])

  // Screen coordinates, because the handle moves along with the window's bottom edge while dragging.
  // Pointer events can arrive several times per frame; only the latest offset is sent, once per frame.
  const resizeFrom = useRef<number | null>(null)
  const resizeOffset = useRef(0)
  const resizeFrame = useRef(0)
  const onGripDown = (event: PointerEvent): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeFrom.current = event.screenY
    window.api.resizeStart()
  }
  const onGripMove = (event: PointerEvent): void => {
    if (resizeFrom.current === null) return
    resizeOffset.current = event.screenY - resizeFrom.current
    if (resizeFrame.current) return
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = 0
      window.api.resizePlaylist(resizeOffset.current)
    })
  }
  const onGripUp = (): void => {
    resizeFrom.current = null
  }

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!track) {
      if (tracks.length > 0) setCurrent(0)
      return
    }
    if (audio.paused) audio.play()
    else audio.pause()
  }, [track, tracks.length])

  const step = useCallback(
    (delta: number) => {
      const audio = audioRef.current
      // Back past the first few seconds restarts the track, like a hardware player.
      if (delta < 0 && audio && audio.currentTime > 3) {
        audio.currentTime = 0
        return
      }
      const next = current + delta
      if (next >= 0 && next < tracks.length) setCurrent(next)
    },
    [current, tracks.length]
  )

  const seek = (seconds: number): void => {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = Math.min(Math.max(seconds, 0), audio.duration)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement && event.target.type !== 'range') return
      if (event.code === 'Space') togglePlay()
      else if (event.key === 'ArrowRight') seek((audioRef.current?.currentTime ?? 0) + 5)
      else if (event.key === 'ArrowLeft') seek((audioRef.current?.currentTime ?? 0) - 5)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  // Songs dropped anywhere else land in the folder shown in the list.
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragOver(false)
    if (listing && event.dataTransfer.files.length > 0) importFiles(window.api.pathsForFiles([...event.dataTransfer.files]), listing.path)
  }

  const afterMove = (moved: Moved): void => {
    if (moved.from === moved.to) return
    if (track && remapPath(track.path, moved)) {
      const audio = audioRef.current
      resumeRef.current = audio ? { time: audio.currentTime, playing: !audio.paused } : null
    }
    setTracks((list) =>
      list.map((item) => {
        const path = remapPath(item.path, moved)
        if (!path) return item
        // Only a renamed file gets a new title; songs inside a moved folder keep theirs.
        return { path, title: item.path === moved.from ? titleOf(path) : item.title }
      })
    )
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      showError(error)
    }
    await refresh()
  }

  const moveItem = (from: string, toDir: string): Promise<void> =>
    run(async () => afterMove(await window.api.library.move(from, toDir)))

  const renameItem = (from: string, name: string): Promise<void> => {
    setRenaming(null)
    return run(async () => afterMove(await window.api.library.rename(from, name)))
  }

  const createFolder = (): Promise<void> =>
    run(async () => {
      if (listing) setRenaming(await window.api.library.createFolder(listing.path))
    })

  const trashItem = (item: Entry, isFolder: boolean): Promise<void> => {
    const question = isFolder ? `Przenieść folder „${item.name}” z całą zawartością do Kosza?` : `Przenieść „${item.name}” do Kosza?`
    if (!window.confirm(question)) return Promise.resolve()
    return run(async () => {
      await window.api.library.trash(item.path)
      const gone = (path: string): boolean => path === item.path || path.startsWith(item.path + '/')
      const playingPath = track?.path
      const kept = tracks.filter((queued) => !gone(queued.path))
      setTracks(kept)
      setCurrent(playingPath && !gone(playingPath) ? kept.findIndex((queued) => queued.path === playingPath) : -1)
    })
  }

  const importFiles = (paths: string[], toDir: string): Promise<void> =>
    run(() => window.api.library.import(paths, toDir))

  // Double-click on a song plays its folder from that song on.
  const playFromFolder = (index: number): void => {
    if (!listing) return
    setTracks(listing.tracks)
    setCurrent(index)
  }

  // Folder rows, the up button and the path crumbs all accept drops into their folder.
  const dropProps = (dir: string) => ({
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(dir)
    },
    onDragLeave: () => setDropTarget((target) => (target === dir ? null : target)),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setDropTarget(null)
      setDragOver(false)
      const item = event.dataTransfer.getData(ITEM_DRAG)
      if (item) moveItem(item, dir)
      else importFiles(window.api.pathsForFiles([...event.dataTransfer.files]), dir)
    }
  })

  const dragProps = (path: string) => ({
    draggable: renaming !== path,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(ITEM_DRAG, path)
      event.dataTransfer.effectAllowed = 'move'
    }
  })

  const nameOrInput = (item: Entry): JSX.Element =>
    renaming === item.path ? (
      <input
        className="rename"
        defaultValue={item.name}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') {
            event.currentTarget.dataset.cancelled = 'true'
            setRenaming(null)
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.dataset.cancelled) renameItem(item.path, event.currentTarget.value)
        }}
        aria-label="Nowa nazwa"
      />
    ) : (
      <span className="playlist-title">{item.name}</span>
    )

  const rowActions = (item: Entry, isFolder: boolean): JSX.Element => (
    <>
      <button
        className="row-btn"
        onClick={(event) => {
          event.stopPropagation()
          setRenaming(item.path)
        }}
        aria-label={`Zmień nazwę ${item.name}`}
        title="Zmień nazwę"
      >
        <Icon size={14}>
          <path d="M4 17.2V20h2.8l8.3-8.3-2.8-2.8zM18.7 8.1a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0l-1.3 1.3 2.8 2.8z" />
        </Icon>
      </button>
      <button
        className="row-btn"
        onClick={(event) => {
          event.stopPropagation()
          trashItem(item, isFolder)
        }}
        aria-label={`Usuń ${item.name}`}
        title="Usuń"
      >
        <Icon size={14}>
          <path d="M9 3h6l1 2h4v2H4V5h4zM6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1zm4 2v8h1.5v-8zm2.5 0v8H14v-8z" />
        </Icon>
      </button>
    </>
  )

  const parent = listing && listing.crumbs.length > 1 ? listing.crumbs[listing.crumbs.length - 2] : null

  return (
    <div
      className={`player${dragOver ? ' is-drag-over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => (current + 1 < tracks.length ? setCurrent(current + 1) : setPlaying(false))}
      />

      <header className="titlebar">
        <div className="title" title={track?.path}>
          {track?.title}
        </div>
        <button className="win-btn" onClick={() => window.api.minimize()} aria-label="Minimalizuj">
          <Icon>
            <rect x="6" y="11" width="12" height="2" rx="1" />
          </Icon>
        </button>
        <button className="win-btn" onClick={() => window.api.close()} aria-label="Zamknij">
          <Icon>
            <path d="M7.4 6 12 10.6 16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6L7.4 18 6 16.6l4.6-4.6L6 7.4z" />
          </Icon>
        </button>
      </header>

      <div className="progress">
        <span className="time">{formatTime(time)}</span>
        <input
          type="range"
          className="seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          disabled={!track}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Pozycja"
        />
        <button
          className="time"
          onClick={() => setShowRemaining((on) => !on)}
          aria-label={showRemaining ? 'Pokaż długość utworu' : 'Pokaż pozostały czas'}
        >
          {showRemaining ? `-${formatTime(Math.max(duration - time, 0))}` : formatTime(duration)}
        </button>
      </div>

      <div className="controls">
        <button className="ctrl" onClick={() => step(-1)} disabled={!track} aria-label="Poprzedni">
          <Icon>
            <path d="M6 6h2v12H6zM9.5 12 18 6v12z" />
          </Icon>
        </button>
        <button className="ctrl ctrl-play" onClick={togglePlay} disabled={tracks.length === 0} aria-label={playing ? 'Pauza' : 'Odtwórz'}>
          <Icon>{playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</Icon>
        </button>
        <button className="ctrl" onClick={() => step(1)} disabled={current + 1 >= tracks.length} aria-label="Następny">
          <Icon>
            <path d="M16 6h2v12h-2zM6 18V6l8.5 6z" />
          </Icon>
        </button>

        <input
          type="range"
          className="volume"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Głośność"
        />

        <button
          className={`ctrl${repeatOne ? ' is-on' : ''}`}
          onClick={() => setRepeatOne((on) => !on)}
          aria-label="Zapętl utwór"
          aria-pressed={repeatOne}
          title="Zapętl utwór"
        >
          <Icon>
            <path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />
            <path d="M11 10h1.5v5H11v-3.5h-1V10.5z" />
          </Icon>
        </button>
        <button
          className={`ctrl${playlistOpen ? ' is-on' : ''}`}
          onClick={() => setPlaylistOpen((open) => !open)}
          aria-label="Lista utworów"
          aria-pressed={playlistOpen}
        >
          <Icon>
            <path d="M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zM4 16h2v2H4zm4 0h12v2H8z" />
          </Icon>
        </button>
        <button
          className="ctrl"
          onClick={async () => {
            const chosen = await window.api.chooseTracks()
            if (listing && chosen.length > 0) importFiles(chosen.map((item) => item.path), listing.path)
          }}
          disabled={!listing}
          aria-label="Dodaj pliki do folderu"
          title="Dodaj pliki do folderu"
        >
          <Icon>
            <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
          </Icon>
        </button>
      </div>

      {playlistOpen && listing && (
        <section className="library">
          <div className="library-bar">
            <button
              className={`row-btn${parent && dropTarget === parent.path ? ' is-drop-target' : ''}`}
              onClick={() => parent && openFolder(parent.path)}
              disabled={!parent}
              aria-label="Folder wyżej (upuść tu, aby przenieść wyżej)"
              title="Folder wyżej — upuść tu, aby przenieść wyżej"
              {...(parent ? dropProps(parent.path) : {})}
            >
              <Icon size={14}>
                <path d="M11 20V8.8l-4.6 4.6L5 12l7-7 7 7-1.4 1.4L13 8.8V20z" />
              </Icon>
            </button>
            <nav className="crumbs">
              {listing.crumbs.map((crumb, index) => (
                <span key={crumb.path} className="crumb-wrap">
                  {index > 0 && <span className="crumb-sep">/</span>}
                  <button
                    className={`crumb${dropTarget === crumb.path ? ' is-drop-target' : ''}`}
                    onClick={() => openFolder(crumb.path)}
                    {...(index < listing.crumbs.length - 1 ? dropProps(crumb.path) : {})}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
            <button className="row-btn" onClick={createFolder} aria-label="Nowy folder" title="Nowy folder">
              <Icon size={14}>
                <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm8 4v2.5H8.5V14H11v2.5h2V14h2.5v-2.5H13V10z" />
              </Icon>
            </button>
          </div>

          <ol className="playlist">
            {listing.folders.length === 0 && listing.tracks.length === 0 && (
              <li className="playlist-empty">Folder jest pusty — upuść tu pliki MP3</li>
            )}
            {listing.folders.map((folder) => (
              <li
                key={folder.path}
                className={`is-folder${dropTarget === folder.path ? ' is-drop-target' : ''}`}
                onClick={() => renaming !== folder.path && openFolder(folder.path)}
                {...dragProps(folder.path)}
                {...dropProps(folder.path)}
              >
                <span className="row-icon">
                  <Icon size={14}>
                    <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </Icon>
                </span>
                {nameOrInput(folder)}
                {rowActions(folder, true)}
              </li>
            ))}
            {listing.tracks.map((item, index) => (
              <li
                key={item.path}
                className={item.path === track?.path ? 'is-current' : undefined}
                onDoubleClick={() => playFromFolder(index)}
                {...dragProps(item.path)}
              >
                <span className="row-icon">
                  <Icon size={14}>
                    <path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3z" />
                  </Icon>
                </span>
                {nameOrInput({ name: item.title, path: item.path })}
                {rowActions({ name: item.title, path: item.path }, false)}
              </li>
            ))}
          </ol>
          <div
            className="resize-grip"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            aria-hidden="true"
          >
            <svg viewBox="0 0 10 10" width="10" height="10">
              <path d="M9 3 3 9M9 6.5 6.5 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
        </section>
      )}
    </div>
  )
}

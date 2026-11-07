# Soundplayer

Minimalny odtwarzacz MP3 na macOS — mały, pływający panel nad innymi oknami zamiast dużego okna aplikacji.

- odtwarzanie / pauza, poprzedni / następny, przewijanie, głośność
- lista utworów (dodawanie przyciskiem +, przeciąganiem plików na panel albo z Findera przez „Otwórz za pomocą”)
- panel zapamiętuje swoją pozycję na ekranie
- skróty: spacja — odtwórz/pauza, ← / → — 5 s wstecz/naprzód
- aktualizacje z GitHub Releases przy starcie (tylko zbudowana aplikacja)

## Rozwój

```sh
npm install
npm run dev
```

## Budowanie

```sh
npm run dist:mac      # dist/mac-arm64/Soundplayer.app
npm run release:mac   # zip + dmg i wydanie v<version> na GitHubie
```

`electron-builder` 26 wymaga Node 22+.

## Licencja

MIT

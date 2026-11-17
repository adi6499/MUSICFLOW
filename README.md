# Sukoon

A calm, fast music player for phone and PC. *Sukoon* means peace of mind.

Songs, albums, artists and playlists · search that finds the right song first · voice
search · one-tap moods · mixes made for you · endless radio · songs that blend into each
other · synced lyrics and a sing-along screen · podcasts · sound modes for every kind of
speaker · sleep timer · downloads that play without internet · listening stats · import
from YouTube Music · share a playlist
as a link · eleven themes and a liquid glass look · your own playlists and liked songs,
kept on your device.

One web app runs everywhere: in any browser, "installed" to a phone's home screen,
and inside the Android app in the `android/` folder.

---

## Use it on this PC

You need [Node.js](https://nodejs.org) (version 20 or newer). Then, in this folder:

```bash
npm install
```

```bash
npm run dev
```

Open the address it prints (normally http://localhost:5210). Changes you make to the
code show up straight away.

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app on this PC while you work on it. |
| `npm run build` | Makes the finished website in the `dist` folder. |
| `npm run preview` | Serves that finished website locally, to check it. |
| `npm run check` | Checks the code for mistakes without running it. |
| `npm test` | Health check of every outside service Sukoon relies on (about 10 seconds). |
| `npm run icons` | Redraws the app icon in every size (website + Android). |

**If music ever stops working, run `npm test` first.** It asks each outside service one
small question and tells you which one changed.

## Put it on the web

The project is ready for [Vercel](https://vercel.com): import the GitHub repository and
press Deploy — no settings to fill in. Vercel builds the site and also runs the one
small server function in `api/` (used only for importing YouTube Music playlists).

Any plain file host works too (upload the `dist` folder), but playlist import needs
that server function, so on a plain host it reports "not available" and everything
else works.

## The Android app

`android/` is a small shell around the same web app. It adds what a browser tab
cannot do: playback that keeps going with the screen off, and play/pause/next on the
notification and lock screen. See [android/README.md](android/README.md).

---

## How it is put together

```
index.html            the single page
src/
  main.tsx            start-up
  app.tsx             the frame: navigation, player, things that slide over the page
  lib/                everything that is not about looks
    api.ts            talks to the song catalog (two servers, memory, fallbacks)
    normalize.ts      turns whatever the servers send into one tidy shape
    player.ts         the playback engine: queue, next/previous, retries, sleep timer
    station.ts        "more like this": radio, auto-play, moods
    library.ts        likes, playlists, history, settings (saved on the device)
    lyrics.ts         song words from LRCLIB
    podcasts.ts       Apple's podcast directory
    ytimport.ts       YouTube Music playlist → Sukoon playlist
    eq.ts             the sound engine: modes, bass, clarity, surround, loudness, 10-band equalizer
    themes.ts         the colour themes (one entry each)
    router.ts         which screen is showing; Back button behaviour
    native.ts         the bridge to the Android shell
  pages/              one file per screen
  player/             mini player, desktop bar, full-screen player
  ui/                 shared pieces: rows, cards, sheets, sliders, sound panel, glass
  styles/             the design system (colours, type, spacing, motion)
api/                  the one server function (YouTube playlist reader)
                      (api/update.json is left over on purpose: MusicFlow apps already
                      installed on phones read it to check for updates. Delete it once
                      nobody uses MusicFlow any more.)
scripts/              icon drawing, the health check, the local stand-in for api/
android/              the Android shell
```

### Where the music comes from

- **Songs** come from a community-run catalog service. Sukoon uses two servers and
  takes the best of both: the main one for search, albums and the home feed; the
  backup for complete playlists, fuller artist pages and "similar songs". If either
  is down, the other covers for it. Sukoon does not control this catalog, so a song
  can occasionally be missing or stop working — the app repairs or skips it by itself.
- **Lyrics** come from [LRCLIB](https://lrclib.net).
- **Podcasts** come from Apple's public podcast directory and play from each podcast's
  own host.
- **Playlist import** only reads the *names* of the songs in a public YouTube Music
  playlist, then finds the same songs in the catalog.

### Your data

Liked songs, playlists, history, downloads and settings are saved **only on your device** — there
are no accounts and nothing is uploaded. The website and the Android app therefore
keep separate libraries; **Settings → Back up / Restore** moves a library between them.

### In the player

- **Swipe the cover** left or right to change song; **tap it twice** to like the song.
- **Drag a song** in the queue by its handle to change what plays next.
- **Songs blend together**: the end of one song overlaps the start of the next
  (Settings → Songs blend together; off, or 3 to 12 seconds). Not on iPhone, which does
  not let a web page change loudness.
- **Sing along**: open Lyrics, then *Sing along*. The words fill the screen and light
  up as they are sung, the screen stays awake, and one switch lowers the original
  singer's voice (it removes what is identical in both ears, which is where the singer
  usually sits; it suits most songs, not all).
- **Keyboard** (on a computer): Space, the arrow keys, and N P M L S R Q F. Press **?**
  for the list.
- **Taps you can feel** on phones, a different feel for a press, a like and a drag.

### Downloads and offline

- **Download** a song from its ⋯ menu, or a whole album, playlist, mix or your liked
  songs with the arrow beside Play and Shuffle. *Settings → Downloads* sets the quality
  (about 3, 5 or 10 MB a song) and can keep every liked song downloaded automatically.
- Downloaded songs are kept **inside Sukoon's own storage on the device**, with their
  cover and lyrics. They are not loose files in the phone's folders, and nothing is
  uploaded. *Library → Downloads* lists them, shows the space used, and removes them.
- **With no internet** a strip at the top says so, Home leads with your downloads,
  songs that are not on the device are faded, and the player skips straight to the next
  downloaded song. A downloaded song also starts instantly and uses no data when online.
- A download interrupted by a lost connection or by closing the app carries on by
  itself next time.
- The website opens with no internet after one visit (its own files are kept by a
  service worker); the Android app always does, since its files are inside the app.
- Podcasts cannot be downloaded: most podcast hosts do not allow a web page to save
  their files.
- On iPhone, add Sukoon to the Home Screen: Safari may clear the storage of a website
  that has not been opened for a week.

### Made from your own listening

All of this is worked out on your device; none of it is sent anywhere.

- **Made for you** (Home): *Daily mix*, *Discover*, *On repeat* and *Rediscover*.
- **New from artists you follow** (Home): their recent singles and film songs, with
  the label compilations and remixes that flood "newest first" lists filtered out.
- **Your listening** (Library): this week's minutes, your streak, top artists and songs,
  and a picture of your week to share.
- **Share as a link** (a playlist's ⋯ menu): the link itself carries the playlist, so
  whoever opens it can play it or save it without any account.

### Search

Both catalog servers are asked at once and Sukoon ranks the answers itself (the right
original ahead of covers, remixes and karaoke versions; spelling slips forgiven).
`npm run bench:search` measures it against 65 real searches. The microphone in the
search box listens for a song, an artist or an album; say "play …" and it starts.

### Sound

Settings → Sound (or the sliders button in the player). Pick a mode — Signature (Sukoon's
own tuning), Spatial, Cinema, Old speaker, Phone speaker, Late night and more — or set
Bass, Vocals, Clarity, Surround and Loudness yourself, with a ten-band equalizer underneath for fine control. The modes for
old and small speakers remove the rumble those speakers cannot play, add overtones so
bass is still heard, restore detail, and raise the level; a limiter keeps everything
free of distortion. It is a stereo enhancer, not Dolby Atmos (that needs specially
mixed songs and a licensed decoder). Not available on iPhone and iPad.

### Design notes

Calm paper by day, soft ink by night; flat surfaces and hairlines, one quiet accent,
set in Ubuntu throughout. Effort goes into motion rather than decoration: everything that moves
uses transform and opacity only, long lists skip off-screen rows, artwork is requested
at the smallest size that still looks sharp, and pages you have already visited paint
instantly from memory while they refresh quietly.

// The shapes every part of Music Flow agrees on. The catalog servers return several
// different layouts; normalize.ts turns all of them into these.

export interface Stream {
  /** Bitrate in kbps: 12, 48, 96, 160 or 320. */
  q: number;
  url: string;
}

export interface Track {
  id: string;
  kind: 'song' | 'episode';
  title: string;
  /** Display string, e.g. "Pritam, Arijit Singh". */
  artist: string;
  album?: string;
  albumId?: string;
  /** Any-size artwork URL; use img() from util.ts to pick a size. */
  image: string;
  /** Seconds. 0 when the server did not say. */
  duration: number;
  year?: string;
  language?: string;
  explicit?: boolean;
  plays?: number;
  /** Empty until the player resolves it (songs from the home feed arrive without). */
  streams?: Stream[];
  /** Direct audio address (podcast episodes). */
  url?: string;
  /** Podcast show this episode belongs to. */
  showId?: string;
  /** Short description (episodes). */
  note?: string;
  /** Release date as ISO text (episodes). */
  date?: string;
}

export interface AlbumRef {
  type: 'album';
  id: string;
  title: string;
  artist: string;
  image: string;
  year?: string;
  songCount?: number;
  language?: string;
}

export interface PlaylistRef {
  type: 'playlist';
  id: string;
  title: string;
  subtitle?: string;
  image: string;
  songCount?: number;
  language?: string;
}

export interface ArtistRef {
  type: 'artist';
  id: string;
  name: string;
  image: string;
}

export interface ShowRef {
  type: 'show';
  id: string;
  title: string;
  author: string;
  image: string;
  genre?: string;
  episodeCount?: number;
}

export type Item = Track | AlbumRef | PlaylistRef | ArtistRef | ShowRef;

export interface Album extends AlbumRef {
  songs: Track[];
}

export interface Playlist extends PlaylistRef {
  songs: Track[];
}

export interface Artist extends ArtistRef {
  topSongs: Track[];
  albums: AlbumRef[];
}

export interface Show extends ShowRef {
  about?: string;
  episodes: Track[];
}

/** A playlist the person made themselves; lives only on this device. */
export interface LocalPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  created: number;
  updated: number;
}

export interface HomeSection {
  key: string;
  title: string;
  /** "cards" = square cards; "songs" = compact rows; "artists" = round cards. */
  layout: 'cards' | 'songs' | 'artists';
  items: Item[];
}

export interface SearchResults {
  songs: Track[];
  albums: AlbumRef[];
  artists: ArtistRef[];
  playlists: PlaylistRef[];
  /** Set when the words typed are an artist's name: that artist is shown first. */
  lead?: ArtistRef;
}

export interface LyricLine {
  /** Seconds from the start of the song. */
  t: number;
  text: string;
}

export interface Lyrics {
  synced: LyricLine[] | null;
  plain: string | null;
}

export type RepeatMode = 'off' | 'all' | 'one';
export type Quality = 'auto' | 'high' | 'normal' | 'saver';
export type ThemeChoice = 'auto' | 'light' | 'dark';

export interface Settings {
  theme: ThemeChoice;
  quality: Quality;
  languages: string[];
  /** Keep playing similar songs when the queue ends. */
  autoplay: boolean;
  /** Tint the player with the colour of the album cover. */
  tint: boolean;
  /** Reduce motion regardless of the system setting. */
  calmMotion: boolean;
  /** How glassy the floating bars and menus are: 0 = solid, 30 = frosted, 100 = clear (the magnifier). */
  glassLevel: number;
  /** Small taps you can feel when pressing things. */
  haptics: boolean;
  /** Seconds each song overlaps the next one (0 = a clean cut). */
  crossfade: number;
  /** Palette used when the app is light, and when it is dark (ids from themes.ts). */
  lightTheme: string;
  darkTheme: string;
  /** Sound engine: on/off, the chosen mode's name, the ten equalizer bands… */
  eqOn: boolean;
  eqPreset: string;
  eqGains: number[];
  /** …and the four simple controls, each 0…1. */
  fxBass: number;
  fxClarity: number;
  fxSpace: number;
  fxLoud: number;
  /** Brings the singer forward. */
  fxVocal: number;
  /** Remove sound below this many hertz (0 = keep everything). Set by the small-speaker modes. */
  fxLowCut: number;
  /** Quality used when a song is downloaded for listening without internet. */
  downloadQuality: 'high' | 'normal' | 'saver';
  /** Download every liked song automatically. */
  keepLiked: boolean;
  podcastSpeed: number;
  welcomed: boolean;
  /** The iPhone "Add to Home Screen" tip has been dismissed. */
  homeTipSeen: boolean;
  /** The "Music Flow has an Android app" tip (Android browsers only) has been answered. */
  appTipSeen: boolean;
  /** The "try Music Flow Sound" suggestion in the player has been answered. */
  soundTipSeen: boolean;
}

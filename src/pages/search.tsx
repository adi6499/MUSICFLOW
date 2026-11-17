// Search: type, and songs, artists, albums and playlists appear as you go.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Clock, Mic, Search as SearchIcon, SearchX, X } from 'lucide-preact';
import { searchAll, searchKey } from '../lib/api';
import { buzz } from '../lib/haptics';
import { addSearch, removeSearch, searches, settings } from '../lib/library';
import * as player from '../lib/player';
import { toast } from '../lib/toast';
import { canListen, listen, understand, voiceIsNative, voiceLanguage, type VoiceProblem } from '../lib/voice';
import { quietReplace, route, to } from '../lib/router';
import { cx } from '../lib/util';
import { Empty, Failed, SkeletonRows, SkeletonShelf } from '../ui/bits';
import { ItemShelf, Section } from '../ui/cards';
import { useDebounced, useQuery } from '../ui/hooks';
import { TrackList } from '../ui/rows';
import { isWide, openSheet } from '../ui/state';
import { Moods } from './home';

const PROBLEMS: Record<VoiceProblem, string> = {
  denied: "Music Flow isn't allowed to use the microphone. Allow it in your browser's settings for this site, then try again.",
  nothing: "Didn't catch that.",
  unavailable: "Voice search isn't available on this device.",
  failed: "Voice search didn't work just now.",
};

/** The little panel shown while the browser listens. */
function Listening(props: { language: string; close: () => void; onHeard: (text: string) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<VoiceProblem | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setText('');
    setProblem(null);
    return listen(props.language, {
      onPartial: setText,
      onDone: (said) => { buzz('done'); props.close(); props.onHeard(said); },
      onProblem: (kind) => { buzz('warn'); setProblem(kind); },
    });
  }, [round]);
  const again = problem === 'nothing' || problem === 'failed';
  return (
    <div class="hear">
      <div class={cx('hear-mic', !problem && 'live')}><Mic size={30} /></div>
      <div class="hear-text" aria-live="polite">{problem ? PROBLEMS[problem] : text || 'Listening…'}</div>
      {!problem && <p class="small muted">Say a song, an artist or an album. Try “play Kesariya”.</p>}
      {again && <button class="btn" onClick={() => setRound((n) => n + 1)}>Try again</button>}
    </div>
  );
}

/** "Play …" said out loud starts the best match straight away. */
async function playTop(words: string): Promise<void> {
  toast(`Finding “${words}”…`);
  try {
    const found = await searchAll(words, undefined, settings.peek().languages);
    if (found.songs.length) player.playTracks(found.songs.slice(0, 20), 0, `Search: ${words}`);
    else toast(`Couldn't find “${words}”.`);
  } catch {
    toast("Couldn't search just now. Please try again.");
  }
}

type Filter = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';
const FILTERS: Array<[Filter, string]> = [['all', 'All'], ['songs', 'Songs'], ['artists', 'Artists'], ['albums', 'Albums'], ['playlists', 'Playlists']];

export function Search() {
  const urlQ = route.value.query.q || '';
  const [text, setText] = useState(urlQ);
  const [filter, setFilter] = useState<Filter>('all');
  const [allSongs, setAllSongs] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(text.trim(), 280);
  const ready = term.length >= 2;
  const q = useQuery(ready ? searchKey(term) : null, (signal) => searchAll(term, signal, settings.peek().languages), { ttl: 15 * 60 * 1000 });

  // Keep the address in step with what is typed, so Back returns to these results.
  useEffect(() => {
    if (term !== (route.value.query.q || '')) quietReplace(to.search(term));
    setAllSongs(false);
  }, [term]);
  // …and the box in step with the address (a recent search was tapped, or Back was pressed).
  useEffect(() => {
    if (urlQ !== text.trim()) setText(urlQ);
  }, [urlQ]);
  useEffect(() => {
    if (isWide.value && !urlQ) input.current?.focus();
  }, []);

  const data = q.data;
  const nothing = !!data && !data.songs.length && !data.albums.length && !data.artists.length && !data.playlists.length;
  // If the words typed are an artist's name, lead with the artist.
  const lead = data?.lead;
  const artistFirst = !!lead;
  const otherArtists = data ? data.artists.filter((a) => a.id !== lead?.id) : [];
  const show = (f: Filter) => filter === 'all' || filter === f;
  const remember = () => { if (ready) addSearch(term); };

  const heard = (said: string) => {
    const { words, play } = understand(said);
    if (!words) return;
    setText(words);
    addSearch(words);
    if (play) void playTop(words);
  };
  const speak = () => {
    buzz('tap');
    const language = voiceLanguage(settings.peek().languages);
    input.current?.blur();
    // The Android app shows Android's own "speak now" screen; browsers get our small panel.
    if (voiceIsNative) listen(language, { onDone: heard, onProblem: (kind) => toast(PROBLEMS[kind]) });
    else openSheet((close) => <Listening language={language} close={close} onHeard={heard} />);
  };

  return (
    <div class="page page-in">
      <header class="page-head"><h1 class="display">Search</h1></header>

      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)', margin: '8px calc(var(--gutter) * -1) 0', padding: 'calc(var(--top) + 8px) var(--gutter) 10px' }}>
        <form class="search-box" role="search" onSubmit={(e) => { e.preventDefault(); remember(); input.current?.blur(); }}>
          <SearchIcon size={20} />
          <input
            ref={input}
            type="search"
            value={text}
            placeholder="Songs, artists, albums"
            aria-label="Search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="search"
            onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          />
          {text ? (
            <button type="button" class="icon-btn" aria-label="Clear" onClick={() => { setText(''); input.current?.focus(); }}>
              <X size={19} />
            </button>
          ) : canListen ? (
            <button type="button" class="icon-btn mic" aria-label="Search by voice" onClick={speak}>
              <Mic size={20} />
            </button>
          ) : null}
        </form>
        {ready && (
          <div class="chips scroll" style={{ marginTop: 10 }}>
            {FILTERS.map(([f, name]) => (
              <button key={f} class={cx('chip', filter === f && 'on')} aria-pressed={filter === f} onClick={() => setFilter(f)}>{name}</button>
            ))}
          </div>
        )}
      </div>

      {!ready && (
        <>
          {searches.value.length > 0 && (
            <Section title="Recent searches">
              <div class="rows">
                {searches.value.map((s) => (
                  <div key={s} class="row" role="button" tabIndex={0} style={{ minHeight: 50 }} onClick={() => setText(s)} onKeyDown={(e) => { if (e.key === 'Enter') setText(s); }}>
                    <span style={{ width: 28, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}><Clock size={18} /></span>
                    <div class="row-text"><div class="row-title clip" style={{ fontWeight: 500 }}>{s}</div></div>
                    <button class="icon-btn sm" aria-label={`Remove ${s}`} onClick={(e) => { e.stopPropagation(); removeSearch(s); }}><X size={17} /></button>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section title="Or play a mood"><Moods /></Section>
        </>
      )}

      {ready && q.loading && (
        <div style={{ marginTop: 14 }}>
          <SkeletonRows count={5} />
          <div style={{ marginTop: 26 }}><SkeletonShelf /></div>
        </div>
      )}
      {ready && q.error && !data && <Failed error={q.error} retry={q.reload} />}
      {ready && nothing && (
        <Empty icon={<SearchX size={26} strokeWidth={1.6} />} title="Nothing found" text={`No results for “${term}”. Check the spelling, or try fewer words.`} />
      )}

      {ready && data && !nothing && (
        <div onClickCapture={remember}>
          {artistFirst && show('artists') && filter === 'all' && (
            <Section title="Artist"><ItemShelf items={[lead!]} small /></Section>
          )}
          {show('songs') && data.songs.length > 0 && (
            <Section title="Songs">
              <TrackList tracks={data.songs} from={`Search: ${term}`} limit={filter === 'songs' || allSongs ? undefined : 5} />
              {filter === 'all' && !allSongs && data.songs.length > 5 && (
                <button class="btn quiet small" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); setAllSongs(true); }}>Show all {data.songs.length} songs</button>
              )}
            </Section>
          )}
          {show('artists') && (filter === 'all' ? otherArtists : data.artists).length > 0 && (
            <Section title="Artists"><ItemShelf items={filter === 'all' ? otherArtists : data.artists} small /></Section>
          )}
          {show('albums') && data.albums.length > 0 && (
            <Section title="Albums"><ItemShelf items={data.albums} /></Section>
          )}
          {show('playlists') && data.playlists.length > 0 && (
            <Section title="Playlists"><ItemShelf items={data.playlists} /></Section>
          )}
          {filter !== 'all' && !(data as any)[filter]?.length && (
            <Empty title={`No ${filter} found`} text={`Nothing under ${filter} for “${term}”.`} />
          )}
        </div>
      )}
    </div>
  );
}

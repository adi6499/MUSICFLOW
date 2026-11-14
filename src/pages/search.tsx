// Search: type, and songs, artists, albums and playlists appear as you go.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Clock, Search as SearchIcon, SearchX, X } from 'lucide-preact';
import { searchAll, searchKey } from '../lib/api';
import { addSearch, removeSearch, searches } from '../lib/library';
import { quietReplace, route, to } from '../lib/router';
import { alike, cx, plain } from '../lib/util';
import { Empty, Failed, SkeletonRows, SkeletonShelf } from '../ui/bits';
import { ItemShelf, Section } from '../ui/cards';
import { useDebounced, useQuery } from '../ui/hooks';
import { TrackList } from '../ui/rows';
import { isWide } from '../ui/state';
import { Moods } from './home';

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
  const q = useQuery(ready ? searchKey(term) : null, (signal) => searchAll(term, signal), { ttl: 15 * 60 * 1000 });

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
  const artistFirst = !!data && data.artists.length > 0 && alike(plain(term), plain(data.artists[0].name)) >= 0.8;
  const show = (f: Filter) => filter === 'all' || filter === f;
  const remember = () => { if (ready) addSearch(term); };

  return (
    <div class="page page-in">
      <header class="page-head"><h1 class="display">Search</h1></header>

      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg)', margin: '8px calc(var(--gutter) * -1) 0', padding: 'calc(var(--safe-top) + 8px) var(--gutter) 10px' }}>
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
          {text && (
            <button type="button" class="icon-btn" aria-label="Clear" onClick={() => { setText(''); input.current?.focus(); }}>
              <X size={19} />
            </button>
          )}
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
            <Section title="Artist"><ItemShelf items={data.artists.slice(0, 1)} small /></Section>
          )}
          {show('songs') && data.songs.length > 0 && (
            <Section title="Songs">
              <TrackList tracks={data.songs} from={`Search: ${term}`} limit={filter === 'songs' || allSongs ? undefined : 5} />
              {filter === 'all' && !allSongs && data.songs.length > 5 && (
                <button class="btn quiet small" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); setAllSongs(true); }}>Show all {data.songs.length} songs</button>
              )}
            </Section>
          )}
          {show('artists') && data.artists.length > (artistFirst && filter === 'all' ? 1 : 0) && (
            <Section title="Artists"><ItemShelf items={artistFirst && filter === 'all' ? data.artists.slice(1) : data.artists} small /></Section>
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

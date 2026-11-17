// "Made for you": four mixes built on this device from what you play, the
// screen that lists one of them, and the shelf of new songs from artists you
// follow.

import { Compass, History as HistoryIcon, ListPlus, Repeat, Sparkles } from 'lucide-preact';
import { createPlaylist, following, hydrated } from '../lib/library';
import { canMix, getMix, localMix, mixInfo, mixKey, MIXES, newFromFollowed, newKey, type MixKind } from '../lib/mixes';
import { buzz } from '../lib/haptics';
import { go, route, to } from '../lib/router';
import { toast } from '../lib/toast';
import { longTime, plural } from '../lib/util';
import { Empty, Failed, Link, SkeletonHero, SkeletonRows, TopBar } from '../ui/bits';
import { ItemShelf, Section } from '../ui/cards';
import { useQuery } from '../ui/hooks';
import { TrackList } from '../ui/rows';
import { ListActions, openListMenu } from './collection';
import { Mosaic } from './library';

const ICONS: Record<MixKind, typeof Sparkles> = { daily: Sparkles, discover: Compass, repeat: Repeat, rediscover: HistoryIcon };

/** Home: the mixes this person has listened enough to earn. Nothing at all for a brand-new library. */
export function MadeForYou() {
  if (!hydrated.value) return null;
  const ready = MIXES.filter((m) => canMix(m.kind));
  if (!ready.length) return null;
  return (
    <Section title="Made for you">
      <div class="moods mixes">
        {ready.map((m) => {
          const Icon = ICONS[m.kind];
          return (
            <Link key={m.kind} to={to.mix(m.kind)} class="mood mix" onClick={() => buzz('select')}>
              <i style={{ '--h': m.hue }} aria-hidden="true"><Icon size={20} /></i>
              <b>{m.title}</b>
              <span>{m.line}</span>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

export function MixPage() {
  const kind = (route.value.parts[0] || '') as MixKind;
  const info = mixInfo(kind);
  const local = info ? localMix(kind) : null;
  const q = useQuery(info && !local ? mixKey(kind) : null, () => getMix(kind), { ttl: 8 * 60 * 60 * 1000 });
  const tracks = local || q.data;

  if (!info) {
    return (
      <div class="page page-narrow page-in">
        <TopBar />
        <Empty title="This mix doesn't exist" text="The link may be old or mistyped."><Link to={to.home()} class="btn quiet">Go to Home</Link></Empty>
      </div>
    );
  }
  const keep = () => {
    if (!tracks?.length) return;
    const stamp = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const pl = createPlaylist(`${info.title} · ${stamp}`, tracks);
    buzz('done');
    toast(`Saved as “${pl.name}”`, { label: 'Open', run: () => go(to.localPlaylist(pl.id)) });
  };
  const seconds = (tracks || []).reduce((s, t) => s + (t.duration || 0), 0);

  return (
    <div class="page page-narrow page-in">
      <TopBar title={info.title} threshold={260} />
      {!tracks && q.loading && (<><SkeletonHero /><div style={{ marginTop: 28 }}><SkeletonRows count={8} /></div></>)}
      {!tracks && q.error && <Failed error={q.error} retry={q.reload} />}
      {tracks && (
        <>
          <div class="hero">
            <Mosaic tracks={tracks} size={500} />
            <div class="hero-text">
              <div class="label">Made for you</div>
              <h1 class="title" style={{ marginTop: 6 }}>{info.title}</h1>
              <div class="hero-meta">{info.line}</div>
              <div class="hero-meta faint" style={{ marginTop: 3 }}>{[plural(tracks.length, 'song'), seconds ? longTime(seconds) : ''].filter(Boolean).join(' · ')}</div>
              <ListActions tracks={tracks} from={info.title} onMore={() => openListMenu(info.title, tracks)} />
            </div>
          </div>
          <div style={{ marginTop: 26 }}>
            {tracks.length ? (
              <>
                <TrackList tracks={tracks} from={info.title} />
                <button class="btn quiet" style={{ marginTop: 18 }} onClick={keep}><ListPlus size={18} /> Save as a playlist</button>
              </>
            ) : (
              <Empty title="Not enough to go on yet" text="Play and like a few more songs, and this mix will fill itself in." />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Home: recent singles and film songs by the artists this person follows. */
export function NewFromFollowed() {
  const has = hydrated.value && following.value.length > 0;
  const q = useQuery(has ? newKey() : null, (signal) => newFromFollowed(signal), { ttl: 3 * 60 * 60 * 1000, persist: true });
  if (!has || !q.data || q.data.length < 2) return null;
  return (
    <Section title="New from artists you follow">
      <ItemShelf items={q.data} small />
    </Section>
  );
}

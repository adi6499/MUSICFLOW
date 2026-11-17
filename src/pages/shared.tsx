// A playlist someone sent as a link. The link itself carries the playlist's
// name and its songs, so nothing has to be stored on a server: opening it
// looks the songs up and offers to play them or keep them.

import { ListPlus } from 'lucide-preact';
import { getSongs, songsKey } from '../lib/api';
import { createPlaylist } from '../lib/library';
import { buzz } from '../lib/haptics';
import { go, route, to } from '../lib/router';
import { toast } from '../lib/toast';
import { longTime, plural } from '../lib/util';
import { Empty, Failed, Link, SkeletonHero, SkeletonRows, TopBar } from '../ui/bits';
import { useQuery } from '../ui/hooks';
import { TrackList } from '../ui/rows';
import { ListActions } from './collection';
import { Mosaic } from './library';

export function SharedPage() {
  const query = route.value.query;
  const name = (query.n || '').trim().slice(0, 80) || 'Shared playlist';
  const ids = [...new Set((query.ids || '').split(',').map((s) => s.trim()).filter((id) => /^[\w-]{4,24}$/.test(id)))].slice(0, 150);
  const q = useQuery(ids.length ? songsKey(ids) : null, (signal) => getSongs(ids, signal), { ttl: 6 * 60 * 60 * 1000 });
  const tracks = q.data;

  const keep = () => {
    if (!tracks?.length) return;
    const pl = createPlaylist(name, tracks);
    buzz('done');
    toast(`Saved “${pl.name}” to your library`);
    go(to.localPlaylist(pl.id), { replace: true });
  };

  if (!ids.length) {
    return (
      <div class="page page-narrow page-in">
        <TopBar />
        <Empty title="This link is incomplete" text="Ask for it to be sent again, in full."><Link to={to.home()} class="btn quiet">Go to Home</Link></Empty>
      </div>
    );
  }
  const seconds = (tracks || []).reduce((s, t) => s + (t.duration || 0), 0);
  const missing = tracks ? ids.length - tracks.length : 0;
  return (
    <div class="page page-narrow page-in">
      <TopBar title={name} threshold={260} />
      {q.loading && (<><SkeletonHero /><div style={{ marginTop: 28 }}><SkeletonRows count={8} /></div></>)}
      {q.error && !tracks && <Failed error={q.error} retry={q.reload} />}
      {tracks && (
        <>
          <div class="hero">
            <Mosaic tracks={tracks} size={500} />
            <div class="hero-text">
              <div class="label">Shared with you</div>
              <h1 class="title" style={{ marginTop: 6 }}>{name}</h1>
              <div class="hero-meta faint">{[plural(tracks.length, 'song'), seconds ? longTime(seconds) : ''].filter(Boolean).join(' · ')}</div>
              <ListActions tracks={tracks} from={name} />
              <button class="btn quiet" style={{ marginTop: 12 }} onClick={keep}><ListPlus size={18} /> Save to my library</button>
            </div>
          </div>
          <div style={{ marginTop: 26 }}>
            <TrackList tracks={tracks} from={name} />
            {missing > 0 && <p class="small faint" style={{ padding: '14px 4px 0' }}>{plural(missing, 'song')} from this playlist could not be found any more.</p>}
          </div>
        </>
      )}
    </div>
  );
}

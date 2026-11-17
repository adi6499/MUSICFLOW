// "Get the app": where the Android app file is offered, with plain steps for
// installing it. Shown on the website; inside the app itself it only says
// whether a newer version is waiting.

import type { ComponentChildren } from 'preact';
import { ArrowDownToLine, Check, Copy } from 'lucide-preact';
import { appFileKey, appFileUrl, getAppFile, isNewer } from '../lib/appfile';
import { buzz } from '../lib/haptics';
import { isApp } from '../lib/native';
import { megabytes } from '../lib/offline';
import { to } from '../lib/router';
import { toast } from '../lib/toast';
import { isAndroid, isIOS } from '../lib/util';
import { SITE, VERSION } from '../lib/version';
import { Empty, Failed, Link, Spinner, TopBar } from '../ui/bits';
import { useQuery } from '../ui/hooks';

const PAGE = SITE + '#/app';

function builtOn(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(PAGE);
    buzz('done');
    toast('Link copied. Open it on your phone.');
  } catch {
    toast("Couldn't copy from this browser.");
  }
}

function Step(props: { n: number; children: ComponentChildren }) {
  return (
    <li class="step">
      <span class="step-n">{props.n}</span>
      <div>{props.children}</div>
    </li>
  );
}

export function GetAppPage() {
  const q = useQuery(appFileKey, (signal) => getAppFile(signal), { ttl: 30 * 60 * 1000 });
  const file = q.data;

  // Inside the app: nothing to install, only whether there is something newer.
  if (isApp) {
    const newer = !!file && isNewer(file.version, VERSION);
    return (
      <div class="page page-narrow page-in">
        <TopBar title="Sukoon for Android" threshold={90} />
        <header class="page-head">
          <h1 class="display">Sukoon for Android</h1>
          <p class="muted">You are using version {VERSION}.</p>
        </header>
        <section class="section" style={{ marginTop: 18 }}>
          <div class="set-card app-card">
            {q.loading && <div class="app-wait"><Spinner size={20} /> Checking for a newer version…</div>}
            {!q.loading && newer && (
              <>
                <b>Version {file!.version} is ready</b>
                <p class="muted">Download it and install it on top of this one. Your liked songs, playlists and downloads stay.</p>
                <a class="btn" href={PAGE}><ArrowDownToLine size={18} /> Get version {file!.version}</a>
              </>
            )}
            {!q.loading && !newer && (
              <>
                <b><Check size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />You have the latest version</b>
                <p class="muted">{q.error ? "Couldn't check just now. Try again when you are online." : 'New versions are published on the Sukoon website and announced here.'}</p>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div class="page page-narrow page-in">
      <TopBar title="Sukoon for Android" threshold={150} />
      <header class="app-hero">
        <img class="app-icon" src="./icon-192.png" alt="" width="84" height="84" draggable={false} />
        <h1 class="title">Sukoon for Android</h1>
        <p class="muted">The same Sukoon, as an app on your phone.</p>

        {q.loading && <div class="app-wait"><Spinner size={20} /></div>}
        {q.error && !file && <Failed error={q.error} retry={q.reload} />}
        {!q.loading && !q.error && !file && (
          <Empty title="The app isn't available right now" text="Please look again a little later.">
            <Link to={to.home()} class="btn quiet">Back to Home</Link>
          </Empty>
        )}
        {file && (
          <>
            <a class="btn app-get" href={appFileUrl} download={`Sukoon-${file.version}.apk`} onClick={() => buzz('tap')}>
              <ArrowDownToLine size={19} /> Download the app
            </a>
            <div class="app-meta">
              Version {file.version} · {megabytes(file.bytes)}{builtOn(file.date) ? ` · ${builtOn(file.date)}` : ''}<br />
              For Android 8 or newer
            </div>
            {!isAndroid && !isIOS && (
              <button class="btn quiet small" style={{ marginTop: 14 }} onClick={() => void copyLink()}>
                <Copy size={15} /> Copy this page's link to open on your phone
              </button>
            )}
          </>
        )}
      </header>

      {isIOS && (
        <section class="section">
          <div class="set-card app-card">
            <b>On an iPhone or iPad?</b>
            <p class="muted">This file is for Android phones only. On iPhone, open Sukoon in Safari, tap the Share button, then <b>Add to Home Screen</b>. It then opens full screen like an app.</p>
          </div>
        </section>
      )}

      {file && (
        <>
          <section class="section">
            <div class="section-head"><h2 class="heading">How to install it</h2></div>
            <div class="set-card app-card">
              <ol class="steps">
                <Step n={1}>Tap <b>Download the app</b> above. When it has finished, open the file: tap the notification, or find it in your phone's <b>Downloads</b>.</Step>
                <Step n={2}>Android asks whether your browser may install apps. Tap <b>Settings</b>, switch on <b>Allow from this source</b>, then go back. It asks because Sukoon does not come from the Play Store.</Step>
                <Step n={3}>Tap <b>Install</b>, then <b>Open</b>.</Step>
              </ol>
              <p class="small faint" style={{ marginTop: 12 }}>
                Google Play Protect may say it does not recognise the app. That is usual for an app from outside the Play Store; choose <b>Install anyway</b> to continue.
              </p>
            </div>
          </section>

          <section class="section">
            <div class="section-head"><h2 class="heading">What the app adds</h2></div>
            <div class="set-card app-card">
              <ul class="app-points">
                <li>Music keeps playing with the screen off, with play, pause and skip on the lock screen and in the notification.</li>
                <li>Your downloads are kept safely on the phone. A browser may clear a website's storage; the app's is its own.</li>
                <li>It opens straight away, even with no internet.</li>
              </ul>
            </div>
          </section>

          <section class="section">
            <div class="section-head"><h2 class="heading">Good to know</h2></div>
            <div class="set-card app-card">
              <ul class="app-points">
                <li><b>Updating:</b> when a newer version appears here, download it and install it on top of the old one. Your liked songs, playlists and downloads stay. The app tells you in Settings when one is ready.</li>
                <li><b>Bringing your library across:</b> the website and the app keep separate libraries. On the website use Settings → Back up, then in the app Settings → Restore from a backup.</li>
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// Voice search: say what you want to hear.
//
// Three ways it can work, picked automatically:
//   - a browser that understands speech itself (Chrome, Edge, Safari);
//   - the Android app, which asks Android to listen and hand back the words;
//   - neither: the microphone button is simply not shown.

export type VoiceProblem = 'denied' | 'nothing' | 'unavailable' | 'failed';

export interface Listening {
  /** Words so far, while the person is still speaking. */
  onPartial?: (text: string) => void;
  onDone: (text: string) => void;
  onProblem: (kind: VoiceProblem) => void;
}

interface Shell { listen?: (language: string) => void }

const inBrowser = typeof window !== 'undefined';
const shell: Shell | undefined = inBrowser ? (window as unknown as { SukoonNative?: Shell }).SukoonNative : undefined;
/** Looked up each time, not once: some browsers only add it after the page has loaded. */
const recognition = (): (new () => any) | undefined =>
  (inBrowser ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined);

/** The Android app listens with Android's own "speak now" screen. */
export const voiceIsNative = !!shell?.listen;
export const canListen = voiceIsNative || !!recognition();

/**
 * What was meant by what was said. "Play Kesariya" asks for the song to start;
 * anything else is simply something to search for.
 */
export function understand(said: string): { words: string; play: boolean } {
  const clean = said.trim().replace(/[.?!]+$/, '').trim();
  const asked = /^(?:please\s+)?(?:play|put on|listen to)\s+(.+)$/i.exec(clean);
  return { words: (asked ? asked[1] : clean).trim(), play: !!asked };
}

/** Songs here are mostly Indian, and Indian English copes best with their names. */
export function voiceLanguage(languages: string[]): string {
  const indian = languages.some((l) => l !== 'english');
  if (indian || !inBrowser) return 'en-IN';
  return navigator.language || 'en-IN';
}

let waiting: Listening | null = null;

/** Android's answer arrives here (see native.ts). */
export function nativeHeard(text: string, possible: boolean): void {
  const job = waiting;
  waiting = null;
  if (!job) return;
  const clean = text.trim();
  if (!possible) job.onProblem('unavailable');
  else if (!clean) job.onProblem('nothing');
  else job.onDone(clean);
}

/** Start listening. Returns a function that stops it. */
export function listen(language: string, job: Listening): () => void {
  if (shell?.listen) {
    waiting = job;
    try { shell.listen(language); } catch { waiting = null; job.onProblem('unavailable'); }
    return () => { if (waiting === job) waiting = null; };
  }
  const Recognition = recognition();
  if (!Recognition) { job.onProblem('unavailable'); return () => { /* nothing to stop */ }; }

  let finished = false;
  let heard = '';
  let rec: any;
  const end = (fn: () => void) => { if (!finished) { finished = true; fn(); } };
  try {
    rec = new Recognition();
    rec.lang = language;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let text = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript || '';
        if (e.results[i].isFinal) final = true;
      }
      heard = text.trim();
      if (final && heard) end(() => job.onDone(heard));
      else job.onPartial?.(heard);
    };
    rec.onerror = (e: any) => {
      const kind = String(e?.error || '');
      if (kind === 'aborted') return;
      end(() => job.onProblem(
        kind === 'not-allowed' || kind === 'service-not-allowed' ? 'denied'
          : kind === 'no-speech' ? 'nothing'
            : kind === 'audio-capture' ? 'unavailable'
              : 'failed',
      ));
    };
    // Some browsers end without ever marking a result "final".
    rec.onend = () => end(() => (heard ? job.onDone(heard) : job.onProblem('nothing')));
    rec.start();
  } catch {
    end(() => job.onProblem('failed'));
  }
  return () => {
    finished = true;
    try { rec?.abort(); } catch { /* already stopped */ }
  };
}

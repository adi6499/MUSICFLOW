import { useEffect, useRef, useState } from 'preact/hooks';
import { forget, isAbort, isFresh, peek, peekSaved } from '../lib/api';

export interface Query<T> {
  data: T | undefined;
  error: Error | null;
  /** True only when there is nothing to show yet. */
  loading: boolean;
  reload: () => void;
}

interface State<T> {
  key: string | null;
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Load something for a screen.
 *
 * `key` must be the same key the loader itself remembers its answer under
 * (see api.ts). That lets a screen you have already visited paint instantly
 * from memory, with no loading state, while a stale answer is refreshed
 * quietly behind the scenes. Leaving the screen cancels the request.
 */
export function useQuery<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  opts: { ttl?: number; persist?: boolean } = {},
): Query<T> {
  const ttl = opts.ttl ?? 30 * 60 * 1000;
  const initial = (): State<T> => {
    const known = key ? peek<T>(key) : undefined;
    return { key, data: known, error: null, loading: !!key && known === undefined };
  };
  const [state, setState] = useState<State<T>>(initial);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const forceRef = useRef(false);

  useEffect(() => {
    if (!key) {
      setState({ key, data: undefined, error: null, loading: false });
      return;
    }
    const ctl = new AbortController();
    let alive = true;
    const stop = () => { alive = false; ctl.abort(); };
    const force = forceRef.current;
    forceRef.current = false;
    if (force) forget(key);
    const known = force ? state.data : peek<T>(key);
    setState({ key, data: known, error: null, loading: known === undefined });
    if (known !== undefined && !force && isFresh(key, ttl)) return stop;

    if (known === undefined && opts.persist) {
      // Show the copy saved on the device while the network answers.
      void peekSaved<T>(key).then((saved) => {
        if (alive && saved !== undefined) setState((s) => (s.key === key && s.data === undefined ? { ...s, data: saved, loading: false } : s));
      });
    }
    loadRef.current(ctl.signal)
      .then((data) => { if (alive) setState({ key, data, error: null, loading: false }); })
      .catch((e) => {
        if (!alive || isAbort(e)) return;
        setState((s) => ({
          key,
          data: s.key === key ? s.data : undefined,
          error: e instanceof Error ? e : new Error('Something went wrong.'),
          loading: false,
        }));
      });
    return stop;
  }, [key, nonce]);

  // In the render right after `key` changes, state still belongs to the old key.
  const now = state.key === key ? state : initial();
  return {
    data: now.data,
    error: now.error,
    loading: now.loading,
    reload: () => { forceRef.current = true; setNonce((n) => n + 1); },
  };
}

/** True once the page has scrolled past `offset` pixels (drives the sticky top bar). */
export function useScrolled(offset = 24): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.scrollY > offset);
  useEffect(() => {
    let last = window.scrollY > offset;
    setOn(last);
    const check = () => {
      const scrolled = window.scrollY > offset;
      if (scrolled !== last) { last = scrolled; setOn(scrolled); }
    };
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [offset]);
  return on;
}

/** A value that only changes after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

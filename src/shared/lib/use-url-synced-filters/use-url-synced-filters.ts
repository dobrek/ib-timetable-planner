import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Owns filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves it. State starts at SSR-safe defaults, then
 * seeds from the URL once on mount; until then it isn't mirrored back, so the first
 * render can't clobber a bookmarked URL.
 *
 * The seed runs exactly once (a mount guard), so an unstable `parse` identity can't
 * re-fire it and overwrite in-flight user edits.
 */
export function useUrlSyncedFilters<T>(
  initial: T,
  parse: (search: string) => T,
  serialize: (state: T) => string,
): { state: T; setState: Dispatch<SetStateAction<T>>; ready: boolean } {
  const [state, setState] = useState(initial);
  const [ready, setReady] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setState(parse(window.location.search));
    setReady(true);
  }, [parse]);

  useEffect(() => {
    if (!ready) return;
    const search = serialize(state);
    const url = window.location.pathname + (search ? `?${search}` : "");
    window.history.replaceState(window.history.state, "", url);
  }, [ready, state, serialize]);

  return { state, setState, ready };
}

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Owns filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves it. State starts at SSR-safe defaults, then
 * seeds from the URL on mount; until then it isn't mirrored back, so the first render
 * can't clobber a bookmarked URL.
 *
 * `parse` and `serialize` must be referentially stable (module-level functions or
 * `useCallback`) — the seed effect re-runs when `parse` changes.
 */
export function useUrlSyncedFilters<T>(
  initial: T,
  parse: (search: string) => T,
  serialize: (state: T) => string,
): { state: T; setState: Dispatch<SetStateAction<T>>; ready: boolean } {
  const [state, setState] = useState(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- client-only URL state, seeded after the SSR-matching first render */
    setState(parse(window.location.search));
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [parse]);

  useEffect(() => {
    if (!ready) return;
    const search = serialize(state);
    const url = window.location.pathname + (search ? `?${search}` : "");
    window.history.replaceState(window.history.state, "", url);
  }, [ready, state, serialize]);

  return { state, setState, ready };
}

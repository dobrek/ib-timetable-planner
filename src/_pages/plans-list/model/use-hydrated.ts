import { useSyncExternalStore } from "react";

/**
 * False on the server and through hydration; true from the first render after it.
 *
 * It exists for exactly one thing here: rendering a LOCAL time. The page is server-rendered on
 * workerd, which has no reader and therefore runs in UTC, while the browser formats in the reader's
 * own zone — so `toLocaleTimeString` genuinely produces different text on the two sides.
 *
 * `suppressHydrationWarning` is NOT the fix, and this was verified in the browser rather than
 * reasoned about: it silences the warning by keeping the SERVER's text, so a reader two hours ahead
 * of UTC is shown 08:29 for a job they started at 10:29. Silencing the warning would have hidden a
 * wrong number instead of a noisy console.
 *
 * `useSyncExternalStore` with a constant client snapshot is the idiom the repo already uses for
 * this class of value (`board-zoom.ts`): the first client render agrees with the server by
 * construction, and React re-renders once with the real answer immediately after. The subscribe
 * function never fires because the answer never changes again.
 */
export const useHydrated = (): boolean => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

const subscribe = (): (() => void) => noop;
const getSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;
const noop = (): void => undefined;

// @vitest-environment jsdom
//
// The factory attaches a `visibilitychange` listener to `document`, and pausing a backgrounded tab is
// one of its four invariants — so this needs a DOM. The jsdom PROJECT is scoped to `*.test.tsx` (the
// repo's ".tsx only for JSX" convention) and this file has no JSX, so the environment is selected
// per-file here rather than by renaming a JSX-free test.
//
// This suite is the POINT of the extraction, not a formality. The hub's own suite covers the
// visibility machinery only incidentally, and the pending page's suite runs in node with no
// `document` at all — so before this file existed, half the centralised lifecycle had no direct
// coverage anywhere, and the `afterTick` ordering that `use-pending-proposal` depends on could be got
// backwards with both slice suites staying green.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPollingStore, type PollingStoreOptions } from "./polling-store";

type Snapshot = { value: number };

const INTERVAL = 5000;

const snapshot = (value: number): Snapshot => ({ value });

/** Everything a store needs, with the domain answers pre-filled; each test overrides what it is about. */
const store = (over: Partial<PollingStoreOptions<Snapshot>> = {}) =>
  createPollingStore<Snapshot>({
    initial: snapshot(1),
    isEqual: (a, b) => a.value === b.value,
    read: (current) => Promise.resolve(current),
    isActive: () => true,
    intervalMs: INTERVAL,
    ...over,
  });

/** A read that answers from a queue, records the snapshot it was handed, and repeats its last answer. */
const scriptedRead = (...answers: Snapshot[]) => {
  const seen: Snapshot[] = [];
  const queue = [...answers];
  let last = answers.at(-1);
  const read = (current: Snapshot): Promise<Snapshot> => {
    seen.push(current);
    last = queue.shift() ?? last;
    return Promise.resolve(last ?? current);
  };
  return { read, seen };
};

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPollingStore", () => {
  it("serves `initial` as both the client and the server snapshot", () => {
    const initial = snapshot(1);
    const polling = store({ initial });

    expect(polling.getSnapshot()).toBe(initial);
    // Identical objects, so the first client render cannot disagree with the server's markup.
    expect(polling.getServerSnapshot()).toBe(polling.getSnapshot());
    polling.dispose();
  });

  it("reads nothing until something subscribes", async () => {
    const { seen } = scriptedRead();
    const read = vi.fn().mockResolvedValue(snapshot(2));
    const polling = store({ read });

    await advance(INTERVAL * 4);
    expect(read).not.toHaveBeenCalled();
    expect(seen).toEqual([]);

    polling.subscribe(() => undefined);
    await advance(INTERVAL);

    expect(read).toHaveBeenCalledTimes(1);
    polling.dispose();
  });

  it("runs no timer at all while nothing is active", async () => {
    const read = vi.fn().mockResolvedValue(snapshot(2));
    const polling = store({ read, isActive: () => false });
    polling.subscribe(() => undefined);

    await advance(INTERVAL * 12);

    expect(read).not.toHaveBeenCalled();
    polling.dispose();
  });

  it("stops the timer on the tick that makes the snapshot inactive", async () => {
    const read = vi.fn().mockResolvedValue(snapshot(9));
    const polling = store({ read, isActive: (s) => s.value < 9 });
    polling.subscribe(() => undefined);

    await advance(INTERVAL);
    expect(read).toHaveBeenCalledTimes(1);

    await advance(INTERVAL * 12);
    expect(read, "an inactive snapshot must stop its own timer").toHaveBeenCalledTimes(1);
    polling.dispose();
  });

  it("hands `read` the current snapshot, and publishes what it returns", async () => {
    const { read, seen } = scriptedRead(snapshot(2), snapshot(3));
    const polling = store({ read });
    polling.subscribe(() => undefined);

    await advance(INTERVAL * 2);

    expect(seen.map((s) => s.value)).toEqual([1, 2]);
    expect(polling.getSnapshot().value).toBe(3);
    polling.dispose();
  });

  it("keeps snapshot identity, and stays silent, when `isEqual` says nothing changed", async () => {
    const notified = vi.fn();
    const polling = store({ read: () => Promise.resolve(snapshot(1)) });
    polling.subscribe(notified);
    const before = polling.getSnapshot();

    await advance(INTERVAL * 3);

    // A fresh object every tick would re-render the island on a timer, and could loop.
    expect(polling.getSnapshot()).toBe(before);
    expect(notified).not.toHaveBeenCalled();
    polling.dispose();
  });

  it("never runs two reads at once, however slow one is", async () => {
    let resolveFirst: ((value: Snapshot) => void) | undefined;
    const calls: number[] = [];
    const read = (): Promise<Snapshot> => {
      calls.push(calls.length);
      return calls.length === 1
        ? new Promise<Snapshot>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(snapshot(3));
    };
    const polling = store({ read });
    polling.subscribe(() => undefined);

    await advance(INTERVAL * 6);
    expect(calls, "a slow read must not stack a queue behind it").toHaveLength(1);

    resolveFirst?.(snapshot(2));
    await advance(INTERVAL);

    expect(calls.length).toBeGreaterThan(1);
    polling.dispose();
  });

  it("keeps the last snapshot when a read fails, and retries on the next tick", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(snapshot(7));
    const polling = store({ read });
    polling.subscribe(() => undefined);

    await advance(INTERVAL);
    expect(polling.getSnapshot().value, "a failed read is not a blank slate").toBe(1);

    await advance(INTERVAL);
    expect(polling.getSnapshot().value).toBe(7);
    polling.dispose();
  });

  it("publishes nothing when the last subscriber leaves mid-read", async () => {
    let resolveRead: ((value: Snapshot) => void) | undefined;
    const polling = store({
      read: () =>
        new Promise<Snapshot>((resolve) => {
          resolveRead = resolve;
        }),
    });
    const notified = vi.fn();
    const unsubscribe = polling.subscribe(notified);

    await advance(INTERVAL);
    unsubscribe();
    resolveRead?.(snapshot(4));
    await advance(0);

    expect(polling.getSnapshot().value, "a store nobody is watching stays silent").toBe(1);
    expect(notified).not.toHaveBeenCalled();
    polling.dispose();
  });

  it("stops when the last subscriber leaves, and re-arms on the next one", async () => {
    // StrictMode's mount → cleanup → remount rehearsal, which must not leave a dead store behind.
    const read = vi.fn().mockResolvedValue(snapshot(1));
    const polling = store({ read });

    const unsubscribe = polling.subscribe(() => undefined);
    await advance(INTERVAL);
    expect(read).toHaveBeenCalledTimes(1);

    unsubscribe();
    await advance(INTERVAL * 6);
    expect(read).toHaveBeenCalledTimes(1);

    polling.subscribe(() => undefined);
    await advance(INTERVAL);
    expect(read).toHaveBeenCalledTimes(2);
    polling.dispose();
  });

  it("goes quiet after dispose, and is re-armable", async () => {
    const read = vi.fn().mockResolvedValue(snapshot(1));
    const polling = store({ read });
    polling.subscribe(() => undefined);

    polling.dispose();
    await advance(INTERVAL * 6);
    expect(read).not.toHaveBeenCalled();

    polling.subscribe(() => undefined);
    await advance(INTERVAL);
    expect(read, "dispose is a teardown, not a tombstone").toHaveBeenCalledTimes(1);
    polling.dispose();
  });

  it("pauses while the tab is hidden and reads immediately on return", async () => {
    const read = vi.fn().mockResolvedValue(snapshot(1));
    const polling = store({ read });
    polling.subscribe(() => undefined);

    setVisibility("hidden");
    await advance(INTERVAL * 12);
    expect(read, "a backgrounded tab must not poll all night").not.toHaveBeenCalled();

    setVisibility("visible");
    await advance(0);
    expect(read, "and must be fresh the moment it is looked at again").toHaveBeenCalledTimes(1);
    polling.dispose();
  });

  it("ticks on becoming visible even when nothing is active — the default is UNGATED", async () => {
    // The hub's rule 5: a tab that knows of no active job still has to discover one started
    // elsewhere, and gating this on `shouldRun()` would leave it showing nothing until a reload.
    const read = vi.fn().mockResolvedValue(snapshot(1));
    const polling = store({ read, isActive: () => false });
    polling.subscribe(() => undefined);

    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    expect(read).toHaveBeenCalledTimes(1);
    polling.dispose();
  });

  it("lets `tickOnVisible` gate that tick", async () => {
    // The pending page's `announced` latch: once it has navigated, returning to the tab must not
    // re-deliver behind the browser's back.
    const read = vi.fn().mockResolvedValue(snapshot(1));
    const polling = store({ read, isActive: () => false, tickOnVisible: () => false });
    polling.subscribe(() => undefined);

    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    expect(read).not.toHaveBeenCalled();
    polling.dispose();
  });

  it("fires `afterTick` AFTER the publish, with the read's result", async () => {
    // The ordering trap no slice suite can catch: firing it before the publish leaves both consumers
    // green while the pending page navigates into a board racing an unpublished snapshot.
    const seenDuringAfterTick: number[] = [];
    const polling = store({
      read: () => Promise.resolve(snapshot(5)),
      afterTick: (next) => {
        seenDuringAfterTick.push(next.value, polling.getSnapshot().value);
      },
    });
    polling.subscribe(() => undefined);

    await advance(INTERVAL);

    expect(seenDuringAfterTick).toEqual([5, 5]);
    polling.dispose();
  });

  it("fires `afterTick` even when the last subscriber left mid-read", async () => {
    // The other half of D9. The work `read` did already happened server-side; a subscriber leaving is
    // a reason to publish nothing, never a reason to swallow the fact that it happened.
    let resolveRead: ((value: Snapshot) => void) | undefined;
    const afterTick = vi.fn();
    const polling = store({
      afterTick,
      read: () =>
        new Promise<Snapshot>((resolve) => {
          resolveRead = resolve;
        }),
    });
    const unsubscribe = polling.subscribe(() => undefined);

    await advance(INTERVAL);
    unsubscribe();
    resolveRead?.(snapshot(4));
    await advance(0);

    expect(afterTick).toHaveBeenCalledWith(snapshot(4));
    polling.dispose();
  });

  it("does not fire `afterTick` when the read failed", async () => {
    const afterTick = vi.fn();
    const polling = store({ afterTick, read: () => Promise.reject(new Error("offline")) });
    polling.subscribe(() => undefined);

    await advance(INTERVAL * 2);

    expect(afterTick).not.toHaveBeenCalled();
    polling.dispose();
  });

  it("defaults the interval to five seconds", async () => {
    const read = vi.fn().mockResolvedValue(snapshot(1));
    const polling = createPollingStore<Snapshot>({
      initial: snapshot(1),
      isEqual: (a, b) => a.value === b.value,
      read,
      isActive: () => true,
    });
    polling.subscribe(() => undefined);

    await advance(4999);
    expect(read).not.toHaveBeenCalled();

    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    polling.dispose();
  });
});

/**
 * Deterministic PRNG utilities shared by the engine and the fuzz harness. Keeping one copy means a
 * given seed replays the exact same search everywhere: the engine's attempt/LNS streams and the fuzz
 * test's random-but-plausible instances stay reproducible against the same `mulberry32` sequence.
 */

/** Deterministic PRNG so a given seed always replays the same stream of numbers in `[0, 1)`. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A Fisher–Yates shuffle of `items` into a fresh array, driven by `rng` (never mutates the input). */
export const shuffled = <T>(items: readonly T[], rng: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** One uniformly random element of `items`, drawn from `rng`. */
export const pickFrom = <T>(items: T[], rng: () => number): T => items[Math.floor(rng() * items.length)];

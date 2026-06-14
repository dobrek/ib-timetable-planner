/**
 * Group a list into a `Map<key, projectedValue[]>` — like {@link groupBy} but it
 * projects each item to a value rather than keeping the item. Pass
 * `{ skipNullKeys: true }` to drop items whose key is `null` (callers that treat a
 * null key as "never grouped", e.g. null teachers never conflict).
 */
export function groupByInto<T, K, V>(list: readonly T[], key: (item: T) => K, value: (item: T) => V): Map<K, V[]>;
export function groupByInto<T, K, V>(
  list: readonly T[],
  key: (item: T) => K,
  value: (item: T) => V,
  options: { skipNullKeys: true },
): Map<NonNullable<K>, V[]>;
export function groupByInto<T, K, V>(
  list: readonly T[],
  key: (item: T) => K,
  value: (item: T) => V,
  options?: { skipNullKeys?: boolean },
): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const item of list) {
    const k = key(item);
    if (options?.skipNullKeys && k === null) continue;
    const existing = map.get(k);
    if (existing) existing.push(value(item));
    else map.set(k, [value(item)]);
  }
  return map;
}

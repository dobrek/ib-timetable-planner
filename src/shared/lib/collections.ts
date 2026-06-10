export const groupBy = <T, K>(list: readonly T[], keyGetter: (item: T) => K): Map<K, T[]> =>
  Map.groupBy(list, keyGetter);

export const unique = <T>(list: T[]): T[] => [...new Set(list)];

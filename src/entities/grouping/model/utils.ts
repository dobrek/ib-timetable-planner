export type GroupedArray<T, K> = { key: K; values: T[] }[];

export const groupBy = <T, K>(list: T[], keyGetter: (item: T) => K): GroupedArray<T, K> =>
  list.reduce<GroupedArray<T, K>>((acc, current) => {
    const key = keyGetter(current);
    const existing = acc.find(({ key: k }) => k === key);
    return existing
      ? acc.map((group) => (group.key === key ? { ...group, values: [...group.values, current] } : group))
      : [...acc, { key, values: [current] }];
  }, []);

export const unique = <T>(list: T[]): T[] => [...new Set(list)];

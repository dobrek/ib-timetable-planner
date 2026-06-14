export const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

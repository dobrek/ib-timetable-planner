/** Empty number field → undefined so the resolver reports "required" rather than NaN. */
export const toNumberOrUndefined = (raw: string): number | undefined => (raw === "" ? undefined : Number(raw));

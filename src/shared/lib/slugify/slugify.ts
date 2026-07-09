/**
 * One filesystem/URL-safe slug for the whole app: lowercase, fold diacritics to ASCII
 * (`Kraków` → `krakow`, `Paweł` → `pawel`), collapse every run of non-alphanumerics to a
 * single `-`, trim leading/trailing separators, and fall back to `plan` when nothing
 * alphanumeric survives. ASCII inputs are unchanged. Used for exported workbook filenames.
 */
export const slugify = (value: string): string => {
  const slug = foldDiacritics(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "plan";
};

/**
 * Fold accented Latin letters onto ASCII. NFD splits precomposed letters into base + combining
 * marks (U+0300–U+036F) which are then stripped; stroke letters like `ł` (U+0142) are atomic —
 * they do not decompose — so they need an explicit map. Input is already lowercased by {@link slugify}.
 */
const foldDiacritics = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");

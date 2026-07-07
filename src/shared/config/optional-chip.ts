/**
 * The optional visual axis for a chip-like element, composed BELOW its tone class (subject color
 * or collision tone): `border-dashed` restyles the tone's border without recoloring it, and the
 * dim is a single saturation step — deliberately `saturate-*`, NOT opacity, because pending/drag/
 * lens states already stack multiplicatively on the opacity axis and a dimmed optional *blocking*
 * chip must still read red. One home for the editing board (placed chip, drag overlay, parked
 * card) and the read-only perspective grids, which must render the same placement identically.
 */
export const optionalChipClass = "border-dashed saturate-75";

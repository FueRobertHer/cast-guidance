/**
 * A signed number for reading: "+3", "+0", and a negative with a true minus
 * sign, "−1" (DS-001 Writing). For the screen only: a dice expression has to
 * keep the ASCII hyphen its parser reads.
 */
export function signed(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

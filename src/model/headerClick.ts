/**
 * VS Code reports *that* a header tab became active, not *how*. These rules separate a real click
 * from activations VS Code causes on its own.
 */

/** Wait this long before acting: a header that is cycled past (still active? no) is not a click. */
export const HEADER_SETTLE_MS = 200;

/** Activations this close (before or after) to a tab opening/closing are VS Code picking a fallback tab. */
export const STRUCTURAL_QUIET_MS = 500;

export function isHeaderClick(o: { activatedAt: number; lastStructuralChange: number; stillActive: boolean }): boolean {
  return o.stillActive && Math.abs(o.activatedAt - o.lastStructuralChange) > STRUCTURAL_QUIET_MS;
}

/** Index `workbench.action.next/previousEditor` would move to in the flattened tab list (it wraps). */
export function neighborIndex(length: number, activeIndex: number, direction: 1 | -1): number | undefined {
  if (length < 2 || activeIndex < 0) return undefined;
  return (activeIndex + direction + length) % length;
}

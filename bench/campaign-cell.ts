/**
 * A calibration cell's identity and a solving host's fingerprint, each written down once.
 *
 * Two programs name a cell: the analyzer derives it from what a row says solved it
 * (`solver_config`), and the campaign runner derives it from the cell it meant to apply. A run counts
 * only when the two agree, so they must spell the key the same way — which is why the spelling lives
 * here and nowhere else.
 *
 * **Dependency-free on purpose.** The runner executes under Node's native type stripping, where the
 * `@/` alias does not resolve, while the analyzer runs under vitest. A module both can load imports
 * nothing and uses erasable syntax only.
 */
export type CellTuning = {
  readonly workers: number;
  readonly stageBudgetS: number;
  readonly modeABudgetS: number;
  /** Tier number to the objective value its stage stops at. Absent or empty when none. */
  readonly targets?: Readonly<Record<string, number>>;
};

/**
 * `w4-s120-a300`: workers, stage budget, Mode A budget. Targets are appended only when present
 * (`-t3=95,6=900`, by tier), because they change what a stage measures; production forwards none.
 */
export const cellKeyOf = ({ workers, stageBudgetS, modeABudgetS, targets = {} }: CellTuning): string => {
  const base = `w${workers}-s${stageBudgetS}-a${modeABudgetS}`;
  const pinned = Object.entries(targets)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([tier, value]) => `${tier}=${value}`);
  return pinned.length === 0 ? base : `${base}-t${pinned.join(",")}`;
};

export type HostFingerprint = { readonly machine: string; readonly cpuCount: number | null };

/** `x86_64/4` — enough to tell the deployed container from a laptop solving against the same database. */
export const hostKeyOf = ({ machine, cpuCount }: HostFingerprint): string => `${machine}/${cpuCount ?? "?"}`;

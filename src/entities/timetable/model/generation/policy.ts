import { z } from "zod";

/**
 * The solve policy vocabulary (S-307, FR-302) — one module for the preset list, the Zod schema the
 * action input and the launch form share, the shipped default, the tolerant reader for the
 * `generation_jobs.policy` audit column, and the author-facing noun for each preset.
 *
 * It lives in the entity because both sides of the plan-detail slice need it: the write side
 * (`_pages/plan-detail/api`, which validates the author's choice once and writes it to the row AND
 * the wire from the same object) and the read side (`clean-label.ts`, whose `not-clean` sentence has
 * to know whether a clean board was even requested).
 *
 * The preset list is a projection of the frozen wire contract
 * (`contracts/generation-wire.schema.json` `$defs/SolveRequest.properties.policy.preset`); the Python
 * side holds the same three names in `cpsat_engine/policy.py`, where each resolves to engine
 * configuration. Tier indices never cross the wire — only the name does.
 */
export const SOLVE_POLICY_PRESETS = ["clean", "canonical", "student-first"] as const;

export type SolvePolicyPreset = (typeof SOLVE_POLICY_PRESETS)[number];

/** `strictObject` mirrors the contract's `additionalProperties: false`. */
export const solvePolicySchema = z.strictObject({ preset: z.enum(SOLVE_POLICY_PRESETS) });

export type SolvePolicy = z.infer<typeof solvePolicySchema>;

/** The service default (FR-302): a clean board is required unless the author opts out. */
export const DEFAULT_SOLVE_POLICY: SolvePolicy = { preset: "clean" };

/**
 * Read the `generation_jobs.policy` audit column tolerantly.
 *
 * Rows written before S-307 carry legacy shapes — `{ clean: true }` from the app, `{ mode: … }` /
 * `{ budgetMs, mode }` from integration fixtures — and every one of them was solved in clean mode,
 * because the service hardcoded it. Reading any shape without a recognised `preset` as the clean
 * default is therefore the honest reading, not a fallback that hides a bug.
 */
export const parseStoredPolicy = (value: unknown): SolvePolicy => {
  const parsed = solvePolicySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SOLVE_POLICY;
};

/**
 * The author-facing noun for a preset. Nouns only — the consequence sentences an author chooses
 * between live beside the choice, in the launch dialog, never here.
 */
export const policyLabel = (preset: SolvePolicyPreset): string => POLICY_LABELS[preset];

const POLICY_LABELS: Record<SolvePolicyPreset, string> = {
  clean: "clean",
  canonical: "canonical order",
  "student-first": "student-first",
};

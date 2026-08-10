import { readFileSync } from "node:fs";

/**
 * Read a JSON file and pin its payload to `T` in one place.
 *
 * `JSON.parse` returns `any`, and `@typescript-eslint/no-unsafe-assignment` is an error across this
 * repo — so every bench/test read of a fixture would otherwise need its own inline assertion. One
 * helper keeps the assertion honest and countable: the type argument at each call site is the claim
 * being made about that file, and for the contract goldens the schema validation right beside it is
 * what actually checks the claim.
 *
 * `T` appears only in the return position by design — this helper *is* the assertion, so the
 * `no-unnecessary-type-parameters` advice (return `unknown`) would push a bare `as` back to every
 * call site, which is exactly the scattering it exists to prevent.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see the docblock above.
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** The raw bytes of a JSON file — what a canonical-form byte comparison must compare against. */
export const readText = (path: string): string => readFileSync(path, "utf8");

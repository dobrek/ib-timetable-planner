import { z } from "zod";

/**
 * Single source of truth for account validation, imported by both the Astro Actions (`input` — the
 * authoritative server gate) and the react-hook-form resolvers.
 *
 * Neither is the real enforcement point. The password floor lives in Supabase Auth's config and the
 * name rules in the `profiles` CHECK, because a user can call either API directly with their own
 * token. These rules mirror them so the form catches a mistake before the round trip.
 */

/** The PRD's floor (§NFG). GoTrue counts UTF-8 bytes; `min` counts UTF-16 units, which is never fewer. */
const MIN_PASSWORD_LENGTH = 15;

/** GoTrue refuses a password over 72 bytes (bcrypt's limit) — bytes, so accented letters count double. */
const MAX_PASSWORD_BYTES = 72;

/**
 * Mirrors `char_length(display_name) between 1 and 60` in the `profiles` CHECK. `char_length` counts
 * code points, so the rule does too: `max` counts UTF-16 units and would refuse emoji the CHECK accepts.
 */
const MAX_DISPLAY_NAME_LENGTH = 60;

/**
 * Characters that let a name hide or reorder text, mirroring the `profiles` CHECK. Written as
 * escapes, never as the literal characters, so a reviewer can see them:
 *   \p{Cc}               C0 and C1 control characters
 *   \u{200B}-\u{200F}    zero-width space, non-joiner and joiner; LRM and RLM marks
 *   \u{202A}-\u{202E}    bidi embeddings and overrides
 *   \u{2066}-\u{2069}    bidi isolates
 *   \u{FEFF}             byte-order mark / zero-width no-break space
 */
const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}]/u;

export const updatePasswordInput = z.object({
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .refine(
      (password) => utf8Length(password) <= MAX_PASSWORD_BYTES,
      "That password is too long — use at most 72 characters, fewer with accented letters or emoji.",
    ),
});

/** The form adds a confirmation the server never sees: a typo would otherwise surface only at the next sign-in. */
export const passwordFormSchema = updatePasswordInput
  .extend({ confirm: z.string() })
  .refine(({ password, confirm }) => password === confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

/**
 * NFC-normalized and trimmed, so the stored name is what the user saw; empty clears it. Accepts
 * `null` as well as a string, so the parsed value the client submits is itself valid input.
 */
export const updateDisplayNameInput = z.object({
  displayName: z
    .string()
    .nullable()
    .transform((name) => (name ?? "").normalize("NFC").trim())
    .pipe(
      z
        .string()
        .refine(
          (name) => codePointLength(name) <= MAX_DISPLAY_NAME_LENGTH,
          `Use at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
        )
        .refine((name) => !FORBIDDEN_NAME_CHARACTERS.test(name), "Remove invisible or text-direction characters."),
    )
    .transform((name) => (name === "" ? null : name)),
});

/** Raw form field shape before Zod transforms — what the RHF form holds. */
export type PasswordFormValues = z.input<typeof passwordFormSchema>;
/** What the password form's submit handler receives. */
export type PasswordFormOutput = z.output<typeof passwordFormSchema>;
/** What the action receives and the client submits. */
export type UpdatePasswordInput = z.output<typeof updatePasswordInput>;
export type DisplayNameFormValues = z.input<typeof updateDisplayNameInput>;
export type UpdateDisplayNameInput = z.output<typeof updateDisplayNameInput>;

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Code points, not graphemes, on purpose: that is what Postgres's `char_length` counts. */
const codePointLength = (text: string): number => Array.from(text).length;

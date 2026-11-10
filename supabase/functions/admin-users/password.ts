// The temporary password: 24 characters from an unambiguous alphabet, uniformly distributed.
//
// Pure: the only I/O is the injectable `fill`, so `deno test` covers every property directly.
//
// Why generated, never typed. An admin-typed password would be weak and would travel through the
// admin's clipboard history. Generation also settles the floor: the Auth server's admin
// `createUser` enforces no strength check of its own on the version CI runs.

/** No `I`, `l`, `O`, `0` or `1`: nothing to misread when the password is read aloud or copied by eye. */
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export const PASSWORD_LENGTH = 24;

/** Fills the buffer with random bytes and returns it, like `crypto.getRandomValues`. */
export type RandomFill = (buffer: Uint8Array) => Uint8Array;

// Rejection sampling: a byte at or above this limit is discarded, because 256 is not a multiple of
// the alphabet's size and taking `byte % size` over all of them would favour the first characters.
const LIMIT = 256 - (256 % ALPHABET.length);

// A password with no lowercase letter, no uppercase letter or no digit is redrawn, so it passes any
// "letters and digits" policy the Auth server is ever configured with. Redrawing a whole candidate
// keeps the result uniform over the passwords that qualify.
const REQUIRED_CLASSES: readonly RegExp[] = [/[a-z]/, /[A-Z]/, /[0-9]/];

// 24 characters from this alphabet fail the class check about once in a thousand draws, so 100
// attempts without success means `fill` is not random, and the answer is to stop, not to spin.
const MAX_ATTEMPTS = 100;

export function generatePassword(fill: RandomFill = fillRandom): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = draw(PASSWORD_LENGTH, fill);
    if (REQUIRED_CLASSES.every((required) => required.test(candidate))) return candidate;
  }
  throw new Error("generatePassword: no candidate with every character class; the random source is not random");
}

const fillRandom: RandomFill = (buffer) => crypto.getRandomValues(buffer);

const draw = (length: number, fill: RandomFill): string => {
  const chars: string[] = [];
  while (chars.length < length) {
    for (const byte of fill(new Uint8Array(length * 2))) {
      if (byte < LIMIT && chars.length < length) chars.push(ALPHABET[byte % ALPHABET.length]);
    }
  }
  return chars.join("");
};

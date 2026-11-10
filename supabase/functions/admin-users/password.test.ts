import assert from "node:assert/strict";
import { ALPHABET, generatePassword, PASSWORD_LENGTH, type RandomFill } from "./password.ts";

const AMBIGUOUS = /[Il O01]/;

Deno.test("a password is 24 characters, every one from the alphabet", () => {
  for (let i = 0; i < 500; i++) {
    const password = generatePassword();
    assert.equal(password.length, PASSWORD_LENGTH);
    assert.ok(
      [...password].every((char) => ALPHABET.includes(char)),
      password,
    );
  }
});

Deno.test("the alphabet has no ambiguous character and no repeat", () => {
  assert.doesNotMatch(ALPHABET, AMBIGUOUS);
  assert.equal(new Set(ALPHABET).size, ALPHABET.length);
});

Deno.test("every password holds a lowercase letter, an uppercase letter and a digit", () => {
  for (let i = 0; i < 2000; i++) {
    const password = generatePassword();
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
  }
});

Deno.test("two draws differ", () => {
  assert.notEqual(generatePassword(), generatePassword());
});

Deno.test("characters are uniformly distributed within each class: none is far from its class's average", () => {
  const draws = 20_000;
  const counts = new Map<string, number>();
  for (let i = 0; i < draws; i++) {
    for (const char of generatePassword()) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  assert.equal(counts.size, ALPHABET.length);
  // Not one share for all 57: a candidate with no digit is redrawn (2.65 % of them), which lifts every
  // digit by ~2.7 % and lowers the letters a little, by design. Within a class the redraw is symmetric,
  // so each class must be flat. ~8400 per character, sd ~92: a 5 % band is over 4.5 sd. A modulo bias
  // (no rejection) would draw the first 28 characters 5/4 as often, `a`–`d` among the lowercase: 25 %.
  for (const charClass of [/[A-Z]/, /[a-z]/, /[0-9]/]) {
    const members = [...counts].filter(([char]) => charClass.test(char));
    const average = members.reduce((sum, [, count]) => sum + count, 0) / members.length;
    for (const [char, count] of members) {
      assert.ok(Math.abs(count - average) < average * 0.05, `${char}: ${count} against ${average}`);
    }
  }
});

Deno.test("a byte at or above the rejection limit is discarded, never folded into the alphabet", () => {
  // 228 is 4 x 57, so bytes 228..255 must be skipped. Every fill hands back 24 of them first, then 24
  // valid bytes: the password must be built from the valid ones alone. Folded in, the high bytes would
  // make a candidate with no digit, redrawn until the generator gives up.
  const valid = Array.from({ length: PASSWORD_LENGTH }, (_, i) => (i * 7) % 228);
  const pattern = [...Array.from({ length: PASSWORD_LENGTH }, (_, i) => 228 + i), ...valid];
  const highThenValid: RandomFill = (buffer) => {
    buffer.set(pattern.slice(0, buffer.length));
    return buffer;
  };
  assert.equal(generatePassword(highThenValid), valid.map((byte) => ALPHABET[byte % ALPHABET.length]).join(""));
});

Deno.test("a source that is not random is refused instead of spinning", () => {
  const constant: RandomFill = (buffer) => buffer.fill(0);
  assert.throws(() => generatePassword(constant), /not random/);
});

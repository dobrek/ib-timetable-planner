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

Deno.test("characters are uniformly distributed: no character is far from its expected share", () => {
  const draws = 20_000;
  const counts = new Map<string, number>();
  for (let i = 0; i < draws; i++) {
    for (const char of generatePassword()) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  const expected = (draws * PASSWORD_LENGTH) / ALPHABET.length;
  assert.equal(counts.size, ALPHABET.length);
  // Expected ~8571 per character, sd ~92: a 5 % band is more than 5 sd, and a modulo bias on this
  // alphabet (the first 32 of 56 characters drawn 5/4 as often) is 25 %.
  for (const [char, count] of counts) {
    assert.ok(Math.abs(count - expected) < expected * 0.05, `${char}: ${count} against ${expected}`);
  }
});

Deno.test("a byte at or above the rejection limit is discarded, never folded into the alphabet", () => {
  // 224 is 4 x 56: bytes 224..255 must be skipped. The first calls hand back only such bytes, so the
  // generator has to ask again rather than accept them, and what it finally takes is valid.
  let calls = 0;
  const highBytesFirst: RandomFill = (buffer) => {
    calls++;
    for (let i = 0; i < buffer.length; i++) buffer[i] = calls <= 3 ? 224 + (i % 32) : (i * 7) % 224;
    return buffer;
  };
  const password = generatePassword(highBytesFirst);
  assert.ok(calls > 3);
  assert.equal(password.length, PASSWORD_LENGTH);
  assert.ok([...password].every((char) => ALPHABET.includes(char)));
});

Deno.test("a source that is not random is refused instead of spinning", () => {
  const constant: RandomFill = (buffer) => buffer.fill(0);
  assert.throws(() => generatePassword(constant), /not random/);
});

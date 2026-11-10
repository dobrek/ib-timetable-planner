import { randomUUID } from "node:crypto";

/**
 * A password for a test user: 40 characters with all four character classes, so it meets any likely
 * password policy, and no `#`, quotes or whitespace (the README's dotenv rule).
 */
export const strongPassword = (): string => `${randomUUID()}Aa1!`;

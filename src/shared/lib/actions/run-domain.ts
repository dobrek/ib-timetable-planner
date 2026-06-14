import { ActionError } from "astro:actions";
import { DomainError } from "../errors";

/**
 * Run a domain function and translate its framework-free `DomainError` into Astro's
 * `ActionError` (codes are a 1:1 subset). Non-domain throws propagate unchanged.
 */
export async function runDomain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new ActionError({ code: error.code, message: error.message });
    }
    throw error;
  }
}

import type { Mock } from "vitest";
import type { FetchLike } from "./mail-transport";

/** The first call a fake `fetch` received: its URL, its init, and its body parsed as JSON. */
export const firstCall = (fetch: Mock<FetchLike>): { url: string; init: RequestInit; body: unknown } => {
  const call = fetch.mock.calls.at(0);
  if (!call) throw new Error("fetch was never called");
  const [url, init] = call;
  return { url, init, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
};

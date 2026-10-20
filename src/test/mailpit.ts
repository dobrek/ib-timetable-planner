/**
 * A small client for the local stack's Mailpit (v1.30.2) API, for suites that read the mail Auth
 * sends. Integration lane and e2e alike: plain `fetch`, no Vitest import.
 *
 * - **Loopback only.** It refuses any `MAILPIT_URL` that is not a local host, before a request.
 * - **Address-exact.** Mailpit's `to:` search is a substring match, so every result is re-checked
 *   against `To[].Address`. Use a unique address per test; mail arrival order is never relied on.
 * - **Deletes by id only.** Mailpit's `DELETE /api/v1/messages` with no ids empties the whole
 *   mailbox, including mail a parallel suite is waiting for, so an empty list is refused here.
 */
export type MailSummary = { ID: string; Subject: string; Created: string; To: { Address: string }[] };

export type MailMessage = { ID: string; Subject: string; HTML: string; Text: string };

/** Every message addressed to exactly `address`, newest first. */
export async function messagesTo(address: string): Promise<MailSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const body = (await getJson(`/api/v1/search?query=${query}&limit=50`)) as { messages: MailSummary[] };
  return body.messages.filter((message) => message.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()));
}

/**
 * Poll until a message to `address` arrives, and return the newest. `after` skips messages created
 * at or before that instant — pass the previous message's `Created` to wait for the next one.
 */
export async function waitForMessageTo(
  address: string,
  { after, timeoutMs = 10_000 }: { after?: string; timeoutMs?: number } = {},
): Promise<MailSummary> {
  const deadline = Date.now() + timeoutMs;
  const isNew = (message: MailSummary) => after === undefined || Date.parse(message.Created) > Date.parse(after);
  for (;;) {
    const found = (await messagesTo(address)).find(isNew);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`mailpit: no message to ${address} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function readMessage(id: string): Promise<MailMessage> {
  return (await getJson(`/api/v1/message/${encodeURIComponent(id)}`)) as MailMessage;
}

/** Delete exactly these messages. Refuses an empty list, which Mailpit reads as "delete all". */
export async function deleteMessages(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) throw new Error("mailpit: refusing to delete with no ids — Mailpit would empty the mailbox");
  await send("/api/v1/messages", { method: "DELETE", body: JSON.stringify({ IDs: ids }) });
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const baseUrl = (): string => {
  const url = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  const { hostname } = new URL(url);
  if (!LOOPBACK_HOSTS.has(hostname)) throw new Error(`mailpit: refusing non-loopback host "${hostname}"`);
  return url.replace(/\/$/, "");
};

const getJson = async (path: string): Promise<unknown> => (await send(path)).json();

// Mailpit answers a DELETE with a plain-text `ok`, so only reads parse the body.
const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`mailpit: ${init.method ?? "GET"} ${path} answered ${response.status}`);
  return response;
};

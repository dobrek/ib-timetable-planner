import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetryLine } from "./telemetry-lines.ts";

/**
 * Reads production's log lines from Cloudflare's Workers Observability Telemetry Query API — the
 * record of the container's lifecycle, which no row holds.
 *
 * Everything this client assumes was observed on the live account on 2026-10-01 (the spike, recorded
 * in this change's `change.md`), not taken from documentation:
 *
 * - **Auth** is an API token with Account → Workers Observability: Edit. The `wrangler` OAuth token is
 *   refused (`10000 Authentication error`) on every `/workers/observability/*` endpoint.
 * - **Selection** is by filter, never by `needle`: a bare needle searches the Workers dataset only and
 *   missed every container line. Container stdout is `$metadata.type = cf-container` (the `containers`
 *   dataset); Durable Object lines are `$workers.executionModel = durableObject` with
 *   `$metadata.type = cf-worker`. A line's fixed text is matched with `$metadata.message includes`.
 * - **Latency**: a line becomes queryable 18–36 s after it is logged, so a command that reads a line
 *   it just caused waits for it rather than concluding it is missing.
 * - **Retention** is seven days: a container that has not started within that window has no startup
 *   line to read. A query must also stay SHORT: over 144 h the same filters returned nothing, so long
 *   windows are split (`queryWindows`).
 *
 * Raw responses are kept under the campaign's state directory (gitignored) and nowhere else.
 */
export type TelemetrySource = "container" | "durable-object";

export type TelemetryQuery = {
  readonly source: TelemetrySource;
  readonly fromMs: number;
  readonly toMs: number;
  /** Fixed text the line must contain (`$metadata.message includes`). */
  readonly contains?: string;
};

export type TelemetryClient = {
  lines(query: TelemetryQuery): Promise<TelemetryLine[]>;
};

export type TelemetryClientOptions = {
  readonly accountId: string;
  readonly token: string;
  /** Where raw responses are kept — `.campaign/telemetry/`. */
  readonly rawDir: string;
  readonly fetch?: typeof fetch;
};

/** The most events one query returns; a lifecycle window holds far fewer of the lines asked for. */
const QUERY_LIMIT = 2000;

export const createTelemetryClient = ({
  accountId,
  token,
  rawDir,
  fetch: fetchImpl = fetch,
}: TelemetryClientOptions): TelemetryClient => {
  const one = async (query: TelemetryQuery): Promise<TelemetryLine[]> => {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(telemetryRequest(query)),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await response.text();
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, `${Date.now()}-${query.source}-${query.fromMs}.json`), text);
    return linesFrom(response.status, text);
  };
  return {
    lines: async (query) =>
      (await Promise.all(queryWindows(query.fromMs, query.toMs).map((window) => one({ ...query, ...window }))))
        .flat()
        .sort((a, b) => a.timestamp - b.timestamp),
  };
};

/**
 * A long window split into pieces of at most `MAX_WINDOW_MS`, oldest first. Observed on the live
 * account (2026-10-01): the same filters found the startup line over 120 h and NOTHING over 144 h, as
 * the query's granularity coarsened — so a long search is many short ones, never one wide one.
 */
export const queryWindows = (fromMs: number, toMs: number): { fromMs: number; toMs: number }[] =>
  Array.from({ length: Math.max(1, Math.ceil((toMs - fromMs) / MAX_WINDOW_MS)) }, (_, index) => ({
    fromMs: fromMs + index * MAX_WINDOW_MS,
    toMs: Math.min(toMs, fromMs + (index + 1) * MAX_WINDOW_MS),
  }));

const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The query body for one source and window — the spike's filters, nothing assumed. */
export const telemetryRequest = ({ source, fromMs, toMs, contains }: TelemetryQuery): Record<string, unknown> => ({
  queryId: "calibration-campaign",
  dry: true,
  view: "events",
  limit: QUERY_LIMIT,
  timeframe: { from: fromMs, to: toMs },
  parameters: {
    datasets: [],
    filters: [
      ...SOURCE_FILTERS[source],
      ...(contains === undefined
        ? []
        : [{ key: "$metadata.message", operation: "includes", type: "string", value: contains }]),
    ],
  },
});

/** The events of a query response as time-ordered lines; a refused query is an error, never "no lines". */
export const linesFrom = (status: number, body: string): TelemetryLine[] => {
  const parsed = JSON.parse(body) as TelemetryResponse;
  if (status !== 200 || parsed.success !== true) {
    throw new Error(`telemetry query refused (HTTP ${status}): ${JSON.stringify(parsed.errors ?? []).slice(0, 300)}`);
  }
  return (parsed.result?.events?.events ?? [])
    .map((event) => ({
      timestamp: event.timestamp,
      message: textOf(event.$metadata?.message ?? event.source?.message),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
};

// --- helpers --------------------------------------------------------------------------------------

/** A log line's text; a structured line (an object) is kept as JSON rather than "[object Object]". */
const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : JSON.stringify(value);
};

const SOURCE_FILTERS: Readonly<Record<TelemetrySource, readonly Record<string, string>[]>> = {
  container: [{ key: "$metadata.type", operation: "eq", type: "string", value: "cf-container" }],
  "durable-object": [
    { key: "$workers.executionModel", operation: "eq", type: "string", value: "durableObject" },
    { key: "$metadata.type", operation: "eq", type: "string", value: "cf-worker" },
  ],
};

type TelemetryResponse = {
  readonly success?: boolean;
  readonly errors?: unknown;
  readonly result?: {
    readonly events?: {
      readonly events?: readonly {
        readonly timestamp: number;
        readonly $metadata?: { readonly message?: unknown };
        readonly source?: { readonly message?: unknown };
      }[];
    };
  };
};

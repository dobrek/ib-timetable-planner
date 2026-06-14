import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { withSupabase } from "./with-supabase";

describe("withSupabase", () => {
  it("returns unavailable when the client is null", async () => {
    expect(await withSupabase(null, () => Promise.resolve("data"))).toEqual({ ok: false, error: "unavailable" });
  });

  it("runs the loader with the client and wraps the result on success", async () => {
    const client = {} as SupabaseClient;
    const result = await withSupabase(client, (c) => Promise.resolve(c === client ? "loaded" : "wrong-client"));
    expect(result).toEqual({ ok: true, value: "loaded" });
  });
});

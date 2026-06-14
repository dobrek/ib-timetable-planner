import { describe, expect, it, vi } from "vitest";
import { writeParentWithLinks } from "./write-parent-with-links";

describe("writeParentWithLinks", () => {
  const parent = { id: "parent-1" };

  it("inserts the parent then the links and returns the parent", async () => {
    const insertLinks = vi.fn().mockResolvedValue(undefined);
    const deleteParent = vi.fn().mockResolvedValue(undefined);

    const result = await writeParentWithLinks({
      insertParent: () => Promise.resolve(parent),
      insertLinks,
      deleteParent,
    });

    expect(result).toBe(parent);
    expect(insertLinks).toHaveBeenCalledWith(parent);
    expect(deleteParent).not.toHaveBeenCalled();
  });

  it("deletes the parent and rethrows when the link insert fails (no orphan parent)", async () => {
    const linkError = new Error("link insert failed");
    const deleteParent = vi.fn().mockResolvedValue(undefined);

    await expect(
      writeParentWithLinks({
        insertParent: () => Promise.resolve(parent),
        insertLinks: () => Promise.reject(linkError),
        deleteParent,
      }),
    ).rejects.toBe(linkError);

    expect(deleteParent).toHaveBeenCalledWith(parent);
  });
});

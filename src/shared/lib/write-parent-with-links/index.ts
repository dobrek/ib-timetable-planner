/** The injected write operations for `writeParentWithLinks`. `T` is the inserted parent (carries its id). */
export type WriteParentWithLinksOps<T extends { id: string }> = {
  insertParent: () => Promise<T>;
  insertLinks: (parent: T) => Promise<void>;
  deleteParent: (parent: T) => Promise<void>;
};

/**
 * Two-step parent + child-links write with compensating cleanup. workerd + supabase-js can't
 * run a client-side transaction and "no migration" rules out a Postgres function, so atomicity
 * lives here: insert the parent, then the links — and if the link insert fails, delete the
 * just-created parent so no orphan parent lingers. The DB operations are injected so the
 * cleanup path is a CI-gated unit test rather than an un-triggerable manual step.
 */
export const writeParentWithLinks = async <T extends { id: string }>(ops: WriteParentWithLinksOps<T>): Promise<T> => {
  const parent = await ops.insertParent();
  try {
    await ops.insertLinks(parent);
  } catch (error) {
    await ops.deleteParent(parent);
    throw error;
  }
  return parent;
};

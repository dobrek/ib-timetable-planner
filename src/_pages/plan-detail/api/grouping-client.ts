import { actions } from "astro:actions";

export async function computeGroupings(args: {
  planId: string;
  cohortId: string;
}): Promise<{ error: string | undefined }> {
  const { error } = await actions.computeGroupings(args);
  return { error: error?.message };
}

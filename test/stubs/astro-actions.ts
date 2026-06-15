// Vitest stub for Astro's `astro:actions` virtual module.
//
// The action wrapper + its helpers import `ActionError` / `defineAction` /
// `ActionAPIContext` from here. Under Vitest the real virtual module is absent, so
// this minimal stand-in makes the wrapper unit-testable. Mirrors the existing
// `astro-env-server.ts` stub (aliased in vitest.config.ts).

/** Subset of Astro's ActionError codes the domain layer raises (+ auth/infra codes). */
export type ActionErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_CONTENT"
  | "INTERNAL_SERVER_ERROR";

export class ActionError extends Error {
  readonly code: ActionErrorCode;

  constructor({ code, message }: { code: ActionErrorCode; message?: string }) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

// Passthrough: the real `defineAction` wires Astro's validation/serialization around
// the handler; here we just return the action object so tests can invoke `.handler`
// directly with a constructed context.
export function defineAction<T>(action: T): T {
  return action;
}

// Minimal shape the helpers read: `locals.user` (session), `request.headers`, `cookies`.
export type ActionAPIContext = {
  locals: { user?: unknown };
  request: Request;
  cookies: unknown;
};

import { navigate } from "astro:transitions/client";

/** Re-run the current route's loader, preserving the query string. */
export function refreshPage(): Promise<void> {
  return navigate(window.location.pathname + window.location.search);
}

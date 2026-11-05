import type { AppRole } from "@/shared/config";

/** How the page names each role. A `Record`, so a role added to the enum does not compile until it is named. */
export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  author: "Author",
  viewer: "Viewer",
};

/** The picker's fourth choice: no role row at all. */
export const NO_ACCESS_LABEL = "No access";

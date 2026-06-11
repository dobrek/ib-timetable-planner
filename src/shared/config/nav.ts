import { Home, BookOpen, GraduationCap, Users, CalendarDays, LayoutGrid, type LucideIcon } from "lucide-react";

/** One navigation item. The shell and any future consumer share these lists. */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Global navigation: the app's only top-level sections. The catalog moved inside
 * plans — its routes are plan-scoped (see {@link planNavItems}).
 */
export const GLOBAL_NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/plans", label: "Plans", icon: CalendarDays },
] as const;

/** Scenario-local navigation rendered when the user is inside a plan. */
export const planNavItems = (planId: string): readonly NavItem[] => [
  { href: `/plans/${planId}`, label: "Board", icon: LayoutGrid },
  { href: `/plans/${planId}/courses`, label: "Courses", icon: BookOpen },
  { href: `/plans/${planId}/teachers`, label: "Teachers", icon: GraduationCap },
  { href: `/plans/${planId}/students`, label: "Students", icon: Users },
];

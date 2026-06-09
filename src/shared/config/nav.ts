import { Home, BookOpen, GraduationCap, Users, CalendarDays, type LucideIcon } from "lucide-react";

/** One top-level navigation section. The shell and any future consumer share this list. */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** The app's top-level sections, in nav order. Single source of truth for the route convention. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/teachers", label: "Teachers", icon: GraduationCap },
  { href: "/students", label: "Students", icon: Users },
  { href: "/plans", label: "Plans", icon: CalendarDays },
] as const;

import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

export type ConfigStatus = {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
};

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase is not configured — authentication features are disabled.",
    docsUrl: "https://github.com/dobrek/ib-timetable-planner#supabase",
    docsLabel: "See the configuration guide",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);

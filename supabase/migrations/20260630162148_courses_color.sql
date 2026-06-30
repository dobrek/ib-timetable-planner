-- Optional per-course subject color — visual-only catalog data.
--
-- A nullable `color text` column storing the app-gated enum KEY (e.g. 'rose'), never a raw
-- CSS color. The enum is enforced in app code (Zod `subjectColorSchema`), consistent with
-- `level`/`week_mode` being plain text gated in the app — no DB check constraint. Additive +
-- nullable, so existing rows read as NULL (uncolored) and the column inherits the table's
-- existing grants + the column-agnostic RLS policy (no GRANT/RLS/default-privilege change;
-- precedent: 20260621130000_bi_weekly_week_columns.sql). It is display-only and never enters
-- the constraint/collision core or the catalog hash.

alter table public.courses
  add column color text;

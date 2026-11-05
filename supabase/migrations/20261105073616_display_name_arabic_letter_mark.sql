-- display_name_arabic_letter_mark: refuse U+061C in a display name (S-406, closing S-401
-- follow-up F4).
--
-- `profiles_display_name_check` refuses the characters that let a name hide or reorder text, but
-- not the Arabic Letter Mark (U+061C), an invisible directional mark like the LRM and RLM it does
-- refuse. S-406 puts display names in front of an admin who changes roles by them, so the gap
-- closes here.
--
-- ADDITIVE. A second constraint beside the first, with nothing dropped or rewritten. A null name
-- still passes (`null !~ …` is null, which a CHECK accepts). Written as an ARE hex escape, never as
-- the literal character, so a reviewer can see it.
--
-- `not valid` then `validate`, in this file's one transaction: the ADD's lock is held to commit
-- either way, so the split buys nothing here but states the order the check runs in. A hosted row
-- holding U+061C would fail VALIDATE and the deploy, so the plan checks hosted read-only before
-- merging. The app's copy of the rule (`FORBIDDEN_NAME_CHARACTERS` in
-- `src/_pages/account/model/schemas.ts`) gains the same character: keep the two in step.

set local lock_timeout = '5s';

alter table public.profiles
  add constraint profiles_display_name_no_letter_mark check (display_name !~ '\x061C') not valid;

alter table public.profiles validate constraint profiles_display_name_no_letter_mark;

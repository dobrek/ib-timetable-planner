// The user entity (S-407): how the app names a person, and who a plan or a job is credited to.
//
// Imported by islands (`UserCredit`), so everything here must stay client-safe: see
// `api/load-credited-users.ts` for why it never value-imports the `@/shared/api` barrel.
export { profileLabel, type ProfileLabel } from "./model/profile-label";
export { creditFor, creditText, type Credit, type CreditedUser } from "./model/credit";
export { loadCreditedUsers } from "./api/load-credited-users";
export { loadCredit } from "./api/load-credit";
export { default as UserCredit } from "./ui/UserCredit";

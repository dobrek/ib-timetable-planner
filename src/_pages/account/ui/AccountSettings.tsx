import { Toaster } from "@/shared/ui";
import DisplayNameForm from "./DisplayNameForm";
import PasswordForm from "./PasswordForm";

type Props = {
  email: string;
  displayName: string | null;
  /** The account is pending (S-409, S-410): the password saved here is the person's first. */
  isFirstPassword: boolean;
};

/**
 * The account page island: both account forms and the page's one Toaster. The forms toast through
 * `submitForm`, so a Toaster per form would show every toast twice.
 */
export default function AccountSettings({ email, displayName, isFirstPassword }: Props) {
  return (
    <div className="space-y-6">
      <DisplayNameForm displayName={displayName} />
      <PasswordForm email={email} isFirstPassword={isFirstPassword} />
      <Toaster />
    </div>
  );
}

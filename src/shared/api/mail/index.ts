export {
  type FetchLike,
  type MailSender,
  type MailTransport,
  type OutgoingMail,
  type SendFailure,
  type SendOutcome,
  type SendStopReason,
} from "./mail-transport";
export { createResendTransport, type ResendTransportOptions } from "./resend-transport";
export { createMailpitTransport, type MailpitTransportOptions } from "./mailpit-transport";
export {
  chooseMailTransport,
  createMailTransport,
  selectMailTransport,
  type MailTransportChoice,
  type MailTransportKeys,
  type MailTransportProblem,
} from "./select-mail-transport";

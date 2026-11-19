/**
 * Who a job email comes from (S-310): the S-402 sender, so every email the product sends reads as
 * one sender. `team@`, not `no-reply@` (Resend's deliverability insights flag `no-reply@`), and
 * "IB Planner" as the name, matching the product name in every subject.
 *
 * It mirrors the hosted SMTP sender set by hand (`smtp_admin_email`, `smtp_sender_name`,
 * `docs/runbooks/email-delivery.md`); the two change together.
 */
export const JOB_EMAIL_FROM = { name: "IB Planner", address: "team@ib-timetable-planner.dev" } as const;

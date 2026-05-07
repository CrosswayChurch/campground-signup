// lib/reminders.ts
// Compatibility shim — actual implementation lives in lib/messaging.ts.
// Kept so existing imports from /api/cron/reminders keep working.

export {
  sendEmail,
  sendSms,
  sendByPreference,
  type Assignment,
  type MessageKind,
} from "./messaging";

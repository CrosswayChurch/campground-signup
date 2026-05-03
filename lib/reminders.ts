// lib/reminders.ts
// Email via Resend, SMS via httpSMS

import { niceDate, ymd } from "./schedule";
import { roleByKey } from "./roles";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Church Signup <noreply@example.com>";

const HTTPSMS_API_KEY = process.env.HTTPSMS_API_KEY || "";
const HTTPSMS_FROM = process.env.HTTPSMS_FROM || ""; // your phone number in E.164

const SITE_URL = process.env.SITE_URL || "";

type Assignment = {
  id: string;
  serviceDate: Date;
  role: string;
  fullName: string;
  email: string | null;
  phone: string | null;
};

function buildMessage(a: Assignment, kind: "3day" | "1day") {
  const role = roleByKey(a.role);
  const roleLabel = role?.label || a.role;
  const dateStr = niceDate(ymd(a.serviceDate));
  const lead = kind === "3day" ? "in 3 days" : "tomorrow";

  const subject = `Reminder: ${roleLabel} on ${dateStr}`;

  const text = `Hi ${a.fullName.split(" ")[0]},

This is a friendly reminder that you signed up as ${roleLabel} for the service ${lead} (${dateStr}).

If you can no longer make it, please update your signup at ${SITE_URL || "the church website"} so someone else can fill in.

Thank you!
— Crossway Church`;

  const html = `<div style="font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; line-height: 1.6;">
    <p>Hi ${a.fullName.split(" ")[0]},</p>
    <p>This is a friendly reminder that you signed up as <strong>${roleLabel}</strong> for the service ${lead} (<strong>${dateStr}</strong>).</p>
    <p>If you can no longer make it, please update your signup${SITE_URL ? ` at <a href="${SITE_URL}">${SITE_URL}</a>` : ""} so someone else can fill in.</p>
    <p>Thank you!<br>— Crossway Church</p>
  </div>`;

  return { subject, text, html };
}

export async function sendEmail(a: Assignment, kind: "3day" | "1day") {
  if (!a.email) return { ok: false, reason: "no email" };
  if (!RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY not set" };

  const { subject, text, html } = buildMessage(a, kind);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [a.email],
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: `Resend ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export async function sendSms(a: Assignment, kind: "3day" | "1day") {
  if (!a.phone) return { ok: false, reason: "no phone" };
  if (!HTTPSMS_API_KEY || !HTTPSMS_FROM) {
    return { ok: false, reason: "HTTPSMS not configured" };
  }

  const { text } = buildMessage(a, kind);

  try {
    const res = await fetch("https://api.httpsms.com/v1/messages/send", {
      method: "POST",
      headers: {
        "x-api-key": HTTPSMS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: text,
        from: HTTPSMS_FROM,
        to: a.phone,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: `httpSMS ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

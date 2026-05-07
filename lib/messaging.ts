// lib/messaging.ts
// Email via Resend, SMS via TextBelt
// Three message kinds: "confirm" (sent immediately on signup), "3day" and "1day" (sent by cron)

import { niceDate, ymd } from "./schedule";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "Crossway Fellowship <notifications@crossway-fellowship.org>";

const TEXTBELT_API_KEY = process.env.TEXTBELT_API_KEY || "";

const SITE_URL = process.env.SITE_URL || "";
const CONTACT_NAME = process.env.CONTACT_NAME || "Derek Ranck";

export type MessageKind = "confirm" | "3day" | "1day";

export type Assignment = {
  id: string;
  serviceDate: Date;
  role: string;
  fullName: string;
  email: string | null;
  phone: string | null;
};

const ROLE_ACTIONS: Record<string, string> = {
  ADULT_TEACHER: "Teach the Message",
  CHILDRENS_TEACHER: "Tell the children's story",
  SONG_LEADER: "Lead the singing",
  MODERATOR: "Moderate the service",
  ATTENDER: "Plan to attend",
};

function roleAction(roleKey: string) {
  return ROLE_ACTIONS[roleKey] || "help with the service";
}

function firstName(fullName: string) {
  return (fullName || "").trim().split(/\s+/)[0] || "Friend";
}

// Channel-specific notice that the address/number doesn't accept replies
function noReplyNote(channel: "email" | "sms") {
  if (channel === "email") {
    return `Please note: this email address (notifications@crossway-fellowship.org) cannot receive replies. If you have questions, please contact ${CONTACT_NAME}.`;
  }
  return `This text is from Crossway Fellowship's automated signup system and cannot receive replies. Contact ${CONTACT_NAME} with questions.`;
}

function buildMessage(a: Assignment, kind: MessageKind, channel: "email" | "sms") {
  const action = roleAction(a.role);
  const dateStr = niceDate(ymd(a.serviceDate));
  const fName = firstName(a.fullName);
  const noReply = noReplyNote(channel);

  let subject: string;
  let body: string;

  if (kind === "confirm") {
    subject = `You're signed up for ${dateStr}`;
    body = `Hi ${fName},

You have signed up to ${action} on Sunday, ${dateStr}.

${noReply}

Thank you!
— Crossway Fellowship`;
  } else if (kind === "3day") {
    subject = `Reminder: ${action} on ${dateStr}`;
    body = `Hi ${fName},

This is a friendly reminder that you signed up to ${action} for the service in 3 days (${dateStr}).

If you can no longer make it, please contact ${CONTACT_NAME} so someone else can fill in.

${noReply}

Thank you!
— Crossway Fellowship`;
  } else {
    subject = `Reminder: ${action} tomorrow`;
    body = `Hi ${fName},

This is a friendly reminder that you signed up to ${action} for the service tomorrow (${dateStr}).

If you can no longer make it, please contact ${CONTACT_NAME} so someone else can fill in.

${noReply}

Thank you!
— Crossway Fellowship`;
  }

  const html = `<div style="font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; line-height: 1.6;">
${body
  .split("\n\n")
  .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
  .join("")}
</div>`;

  return { subject, text: body, html };
}

export async function sendEmail(a: Assignment, kind: MessageKind) {
  if (!a.email) return { ok: false, reason: "no email" };
  if (!RESEND_API_KEY) return { ok: false, reason: "RESEND_API_KEY not set" };

  const { subject, text, html } = buildMessage(a, kind, "email");

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

export async function sendSms(a: Assignment, kind: MessageKind) {
  if (!a.phone) return { ok: false, reason: "no phone" };
  if (!TEXTBELT_API_KEY) return { ok: false, reason: "TEXTBELT_API_KEY not set" };

  const { text } = buildMessage(a, kind, "sms");

  try {
    const params = new URLSearchParams();
    params.set("phone", a.phone);
    params.set("message", text);
    params.set("key", TEXTBELT_API_KEY);

    const res = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!data?.success) {
      return { ok: false, reason: `TextBelt: ${data?.error || "unknown error"}` };
    }
    return { ok: true, quotaRemaining: data?.quotaRemaining };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export async function sendByPreference(
  a: Assignment & { remindBy: string },
  kind: MessageKind
) {
  const channels: { type: string; ok: boolean; reason?: string }[] = [];
  const pref = (a.remindBy || "EMAIL").toUpperCase();

  if (pref === "NONE") {
    return { channels: [], skipped: true };
  }

  if (pref === "EMAIL" || pref === "BOTH") {
    const r = await sendEmail(a, kind);
    channels.push({ type: "email", ok: r.ok, reason: r.reason });
  }
  if (pref === "SMS" || pref === "BOTH") {
    const r = await sendSms(a, kind);
    channels.push({ type: "sms", ok: r.ok, reason: r.reason });
  }
  return { channels, skipped: false };
}

import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { sendEmail, sendSms, type Assignment, type MessageKind } from "@/lib/messaging";

export const dynamic = "force-dynamic";

// POST /api/admin/test-message
// Body: { channel: "email" | "sms", to: string, role?: string, kind?: "confirm" | "3day" | "1day" }
//
// Sends a sample message to the specified address/number, useful for verifying
// that Resend / TextBelt are configured correctly.
export async function POST(req: Request) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const channel = String(body.channel || "").toLowerCase();
  const to = String(body.to || "").trim();
  const role = String(body.role || "ATTENDER");
  const kind = String(body.kind || "confirm") as MessageKind;

  if (channel !== "email" && channel !== "sms") {
    return NextResponse.json({ error: "channel must be 'email' or 'sms'" }, { status: 400 });
  }
  if (!to) {
    return NextResponse.json({ error: "Missing 'to' (email or phone)" }, { status: 400 });
  }
  if (!["confirm", "3day", "1day"].includes(kind)) {
    return NextResponse.json({ error: "Bad kind" }, { status: 400 });
  }

  // Fake assignment for testing — uses next Sunday as the date
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  sunday.setHours(0, 0, 0, 0);

  const fakeAssignment: Assignment = {
    id: "test",
    serviceDate: sunday,
    role,
    fullName: "Test Person",
    email: channel === "email" ? to : null,
    phone: channel === "sms" ? to : null,
  };

  const result = channel === "email"
    ? await sendEmail(fakeAssignment, kind)
    : await sendSms(fakeAssignment, kind);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason || "Send failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, channel, to, kind, role });
}

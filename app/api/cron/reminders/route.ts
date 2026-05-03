import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { sendEmail, sendSms } from "@/lib/reminders";

export const dynamic = "force-dynamic";

// GET or POST /api/cron/reminders
// Protected by CRON_SECRET — pass as ?key=... or Authorization: Bearer ...
//
// Logic:
// - Find all assignments whose serviceDate is exactly 3 days away (and remind3Sent is null) — send "3 day" reminder
// - Find all assignments whose serviceDate is exactly 1 day away (and remind1Sent is null) — send "1 day" reminder
//
// Run this once a day via Railway's cron feature.

function isAuthed(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  if (key && key === secret) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return false;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function runReminders() {
  const now = new Date();

  const day3Start = startOfDay(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));
  const day3End = new Date(day3Start);
  day3End.setDate(day3Start.getDate() + 1);

  const day1Start = startOfDay(new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000));
  const day1End = new Date(day1Start);
  day1End.setDate(day1Start.getDate() + 1);

  const results: any[] = [];

  // 3-day reminders
  const threeDay = await prisma.assignment.findMany({
    where: {
      serviceDate: { gte: day3Start, lt: day3End },
      remind3Sent: null,
      remindBy: { not: "NONE" as any },
    },
  });

  for (const a of threeDay) {
    const r: any = { id: a.id, fullName: a.fullName, kind: "3day", channels: [] };
    if (a.remindBy === "EMAIL" || a.remindBy === "BOTH") {
      const res = await sendEmail(a as any, "3day");
      r.channels.push({ type: "email", ...res });
    }
    if (a.remindBy === "SMS" || a.remindBy === "BOTH") {
      const res = await sendSms(a as any, "3day");
      r.channels.push({ type: "sms", ...res });
    }
    await prisma.assignment.update({
      where: { id: a.id },
      data: { remind3Sent: new Date() },
    });
    results.push(r);
  }

  // 1-day reminders
  const oneDay = await prisma.assignment.findMany({
    where: {
      serviceDate: { gte: day1Start, lt: day1End },
      remind1Sent: null,
      remindBy: { not: "NONE" as any },
    },
  });

  for (const a of oneDay) {
    const r: any = { id: a.id, fullName: a.fullName, kind: "1day", channels: [] };
    if (a.remindBy === "EMAIL" || a.remindBy === "BOTH") {
      const res = await sendEmail(a as any, "1day");
      r.channels.push({ type: "email", ...res });
    }
    if (a.remindBy === "SMS" || a.remindBy === "BOTH") {
      const res = await sendSms(a as any, "1day");
      r.channels.push({ type: "sms", ...res });
    }
    await prisma.assignment.update({
      where: { id: a.id },
      data: { remind1Sent: new Date() },
    });
    results.push(r);
  }

  return { ok: true, count: results.length, results };
}

export async function GET(req: Request) {
  if (!isAuthed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out = await runReminders();
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (!isAuthed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const out = await runReminders();
  return NextResponse.json(out);
}

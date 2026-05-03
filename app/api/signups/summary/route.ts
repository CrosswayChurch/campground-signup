import { NextResponse } from "next/server";
import prisma from "@/lib/db";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdFromDate(dt: Date) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export const dynamic = "force-dynamic";

// GET /api/signups/summary?month=YYYY-MM
// Returns count of filled slots per Sunday in that month.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = String(url.searchParams.get("month") || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Bad month" }, { status: 400 });
  }

  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) return NextResponse.json({ error: "Bad month" }, { status: 400 });

  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);

  const rows = await prisma.assignment.findMany({
    where: { serviceDate: { gte: start, lt: end } },
    select: { serviceDate: true },
  });

  const summary: Record<string, number> = {};
  for (const r of rows) {
    const key = ymdFromDate(r.serviceDate);
    summary[key] = (summary[key] || 0) + 1;
  }

  return NextResponse.json({ summary });
}

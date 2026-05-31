import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { isAdminAuthed } from "@/lib/adminAuth";
import { fromYmd, isAllowedSunday } from "@/lib/schedule";
import { ATTENDER_CAP, roleByKey } from "@/lib/roles";
import { sendByPreference } from "@/lib/messaging";

export const dynamic = "force-dynamic";

function normEmail(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

function normPhone(v: unknown) {
  let s = String(v || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  return plus ? `+${s}` : s;
}

// GET /api/admin/signups?date=YYYY-MM-DD (optional)
export async function GET(req: Request) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date");

  let where: any = {};
  if (date) {
    const dt = fromYmd(date);
    if (!dt) return NextResponse.json({ error: "Bad date" }, { status: 400 });
    const next = new Date(dt);
    next.setDate(dt.getDate() + 1);
    where = { serviceDate: { gte: dt, lt: next } };
  }

  const assignments = await prisma.assignment.findMany({
    where,
    orderBy: [{ serviceDate: "asc" }, { role: "asc" }, { slotIndex: "asc" }],
  });

  return NextResponse.json({ assignments });
}

// POST /api/admin/signups — admin assigns someone to a slot
// Body: { serviceDate, role, fullName, email?, phone?, partySize?, remindBy }
export async function POST(req: Request) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const serviceDate = String(body.serviceDate || "").trim();
  const role = String(body.role || "").trim();
  const fullName = String(body.fullName || "").trim();
  const email = normEmail(body.email);
  const phone = normPhone(body.phone);
  const remindBy = String(body.remindBy || "EMAIL").toUpperCase();
  const partySizeRaw = Number(body.partySize);

  if (!isAllowedSunday(serviceDate)) {
    return NextResponse.json({ error: "Not a valid service Sunday" }, { status: 400 });
  }
  if (fullName.length < 2) {
    return NextResponse.json({ error: "Name too short" }, { status: 400 });
  }
  if (!["EMAIL", "SMS", "BOTH", "NONE"].includes(remindBy)) {
    return NextResponse.json({ error: "Bad remindBy value" }, { status: 400 });
  }
  if ((remindBy === "EMAIL" || remindBy === "BOTH") && !email) {
    return NextResponse.json({ error: "Email required for email reminders" }, { status: 400 });
  }
  if ((remindBy === "SMS" || remindBy === "BOTH") && !phone) {
    return NextResponse.json({ error: "Phone required for SMS reminders" }, { status: 400 });
  }

  const roleDef = roleByKey(role);
  if (!roleDef) return NextResponse.json({ error: "Unknown role" }, { status: 400 });

  const dt = fromYmd(serviceDate)!;
  const next = new Date(dt);
  next.setDate(dt.getDate() + 1);

  let partySize = 1;
  if (roleDef.multipleEntries) {
    if (!Number.isFinite(partySizeRaw) || partySizeRaw < 1) {
      return NextResponse.json({ error: "Please enter how many people are attending" }, { status: 400 });
    }
    partySize = Math.floor(partySizeRaw);
    if (partySize > ATTENDER_CAP) {
      return NextResponse.json({ error: `Party size can't exceed ${ATTENDER_CAP}` }, { status: 400 });
    }
  }

  let slotIndex: number;
  if (!roleDef.multipleEntries) {
    slotIndex = 0;
  } else {
    const existing = await prisma.assignment.findMany({
      where: { serviceDate: { gte: dt, lt: next }, role: "ATTENDER" as any },
      select: { slotIndex: true, partySize: true },
    });
    const usedSeats = existing.reduce(
      (sum: number, e: { partySize: number }) => sum + (e.partySize || 1),
      0
    );
    const remaining = ATTENDER_CAP - usedSeats;
    if (partySize > remaining) {
      return NextResponse.json(
        { error: `Only ${remaining} spot${remaining === 1 ? "" : "s"} remaining.` },
        { status: 409 }
      );
    }
    const maxSlot = existing.reduce(
      (m: number, e: { slotIndex: number }) => Math.max(m, e.slotIndex),
      0
    );
    slotIndex = maxSlot + 1;
  }

  if (email || phone) {
    const conflict = await prisma.assignment.findFirst({
      where: {
        role: role as any,
        serviceDate: { gte: dt, lt: next },
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean) as any,
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: `${fullName} is already signed up for that role on this Sunday.` },
        { status: 409 }
      );
    }
  }

  try {
    const created = await prisma.assignment.create({
      data: {
        serviceDate: dt,
        role: role as any,
        slotIndex,
        fullName,
        email: email || null,
        phone: phone || null,
        partySize,
        remindBy: remindBy as any,
      },
    });

    // Fire-and-forget confirmation message
    sendByPreference(
      {
        id: created.id,
        serviceDate: dt,
        role,
        fullName,
        email: email || null,
        phone: phone || null,
        remindBy,
      },
      "confirm"
    ).catch(() => {});

    return NextResponse.json({ ok: true, assignment: created });
  } catch (e: any) {
    if (String(e?.code) === "P2002") {
      return NextResponse.json({ error: "That slot is already taken." }, { status: 409 });
    }
    return NextResponse.json({ error: "Server error", detail: String(e?.message || e) }, { status: 500 });
  }
}

// PATCH /api/admin/signups
export async function PATCH(req: Request) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Look up the existing record to know its role and date for capacity check
  const existing = await prisma.assignment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: any = {};

  if (body.fullName !== undefined) {
    const v = String(body.fullName).trim();
    if (v.length < 2) return NextResponse.json({ error: "Name too short" }, { status: 400 });
    data.fullName = v;
  }
  if (body.email !== undefined) {
    const v = normEmail(body.email);
    data.email = v || null;
  }
  if (body.phone !== undefined) {
    const v = normPhone(body.phone);
    data.phone = v || null;
  }
  if (body.remindBy !== undefined) {
    const v = String(body.remindBy).toUpperCase();
    if (!["EMAIL", "SMS", "BOTH", "NONE"].includes(v)) {
      return NextResponse.json({ error: "Bad remindBy" }, { status: 400 });
    }
    data.remindBy = v;
  }
  if (body.partySize !== undefined) {
    const n = Number(body.partySize);
    if (!Number.isFinite(n) || n < 1 || n > ATTENDER_CAP) {
      return NextResponse.json({ error: `Party size must be 1–${ATTENDER_CAP}` }, { status: 400 });
    }
    if (existing.role === "ATTENDER") {
      const next = new Date(existing.serviceDate);
      next.setDate(existing.serviceDate.getDate() + 1);
      const others = await prisma.assignment.findMany({
        where: {
          serviceDate: { gte: existing.serviceDate, lt: next },
          role: "ATTENDER" as any,
          NOT: { id },
        },
        select: { partySize: true },
      });
      const otherSeats = others.reduce(
        (sum: number, e: { partySize: number }) => sum + (e.partySize || 1),
        0
      );
      if (otherSeats + Math.floor(n) > ATTENDER_CAP) {
        const remaining = ATTENDER_CAP - otherSeats;
        return NextResponse.json(
          { error: `Only ${remaining} spot${remaining === 1 ? "" : "s"} available.` },
          { status: 409 }
        );
      }
    }
    data.partySize = Math.floor(n);
  }

  try {
    const updated = await prisma.assignment.update({ where: { id }, data });
    return NextResponse.json({ ok: true, assignment: updated });
  } catch (e: any) {
    return NextResponse.json({ error: "Update failed", detail: String(e?.message || e) }, { status: 500 });
  }
}

// DELETE /api/admin/signups?id=...
export async function DELETE(req: Request) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.assignment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

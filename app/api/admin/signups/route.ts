import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { isAdminAuthed } from "@/lib/adminAuth";
import { fromYmd, isAllowedSunday } from "@/lib/schedule";
import { ATTENDER_CAP, roleByKey } from "@/lib/roles";

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
// Body: { serviceDate, role, slotIndex?, fullName, email?, phone?, remindBy }
export async function POST(req: Request) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const serviceDate = String(body.serviceDate || "").trim();
  const role = String(body.role || "").trim();
  const slotIndexRaw = body.slotIndex;
  const fullName = String(body.fullName || "").trim();
  const email = normEmail(body.email);
  const phone = normPhone(body.phone);
  const remindBy = String(body.remindBy || "EMAIL").toUpperCase();

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

  let slotIndex: number;
  if (roleDef.slots === 1) {
    slotIndex = 0;
  } else {
    const requested = Number(slotIndexRaw);
    if (Number.isFinite(requested) && requested >= 1 && requested <= ATTENDER_CAP) {
      slotIndex = Math.floor(requested);
    } else {
      const dt = fromYmd(serviceDate)!;
      const next = new Date(dt);
      next.setDate(dt.getDate() + 1);
      const taken = await prisma.assignment.findMany({
        where: { serviceDate: { gte: dt, lt: next }, role: "ATTENDER" as any },
        select: { slotIndex: true },
      });
      const takenSet = new Set(taken.map((t: { slotIndex: number }) => t.slotIndex));
      let found = -1;
      for (let i = 1; i <= ATTENDER_CAP; i++) {
        if (!takenSet.has(i)) { found = i; break; }
      }
      if (found === -1) return NextResponse.json({ error: "All attender slots are full" }, { status: 409 });
      slotIndex = found;
    }
  }

  const dt = fromYmd(serviceDate)!;
  const next = new Date(dt);
  next.setDate(dt.getDate() + 1);

  // Enforce one-person-one-role rule (skip if no email and no phone — admin
  // may want to add someone without contact info)
  if (email || phone) {
    const conflict = await prisma.assignment.findFirst({
      where: {
        serviceDate: { gte: dt, lt: next },
        OR: [
          email ? { email } : undefined,
          phone ? { phone } : undefined,
        ].filter(Boolean) as any,
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: `${fullName} is already signed up for a role on this Sunday.` },
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
        remindBy: remindBy as any,
      },
    });
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

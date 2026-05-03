import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { fromYmd, isAllowedSunday } from "@/lib/schedule";
import { ROLES, ATTENDER_CAP, roleByKey } from "@/lib/roles";

export const dynamic = "force-dynamic";

function normEmail(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

function normPhone(v: unknown) {
  // Strip everything except digits and a leading +
  let s = String(v || "").trim();
  if (!s) return "";
  const plus = s.startsWith("+");
  s = s.replace(/\D/g, "");
  return plus ? `+${s}` : s;
}

// GET /api/signups?date=YYYY-MM-DD
// Returns the assignments for that Sunday.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });
    if (!isAllowedSunday(date)) {
      return NextResponse.json({ error: "Not a valid service Sunday" }, { status: 400 });
    }

    const dt = fromYmd(date)!;
    const next = new Date(dt);
    next.setDate(dt.getDate() + 1);

    const assignments = await prisma.assignment.findMany({
      where: { serviceDate: { gte: dt, lt: next } },
      orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
      // Don't expose email/phone to public
      select: {
        id: true,
        role: true,
        slotIndex: true,
        fullName: true,
      },
    });

    return NextResponse.json({ assignments, roles: ROLES });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// POST /api/signups
// Body: { serviceDate, role, slotIndex?, fullName, email?, phone?, remindBy }
export async function POST(req: Request) {
  try {
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
      return NextResponse.json({ error: "Please enter your full name" }, { status: 400 });
    }
    if (!email && !phone) {
      return NextResponse.json(
        { error: "Please provide an email or phone number" },
        { status: 400 }
      );
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
    if (!roleDef) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }

    // Resolve slotIndex
    let slotIndex: number;
    if (roleDef.slots === 1) {
      slotIndex = 0;
    } else {
      // ATTENDER — pick the lowest open slot if not specified
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
          if (!takenSet.has(i)) {
            found = i;
            break;
          }
        }
        if (found === -1) {
          return NextResponse.json({ error: "All attender slots are full" }, { status: 409 });
        }
        slotIndex = found;
      }
    }

    const dt = fromYmd(serviceDate)!;

    // One-person-one-role-per-Sunday rule:
    // Check if this email or phone is already on the schedule for that Sunday.
    const next = new Date(dt);
    next.setDate(dt.getDate() + 1);

    if (email || phone) {
      const conflicts = await prisma.assignment.findFirst({
        where: {
          serviceDate: { gte: dt, lt: next },
          OR: [
            email ? { email } : undefined,
            phone ? { phone } : undefined,
          ].filter(Boolean) as any,
        },
      });
      if (conflicts) {
        return NextResponse.json(
          { error: "You're already signed up for a role on this Sunday." },
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
      return NextResponse.json({ ok: true, id: created.id });
    } catch (e: any) {
      // Unique constraint — slot already taken
      if (String(e?.code) === "P2002") {
        return NextResponse.json({ error: "That slot was just taken. Please pick another." }, { status: 409 });
      }
      throw e;
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { fromYmd, isAllowedSunday } from "@/lib/schedule";
import { ROLES, ATTENDER_CAP, roleByKey } from "@/lib/roles";
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

// GET /api/signups?date=YYYY-MM-DD
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
      select: {
        id: true,
        role: true,
        slotIndex: true,
        fullName: true,
        partySize: true,
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
// Body: { serviceDate, role, fullName, email?, phone?, partySize?, remindBy }
export async function POST(req: Request) {
  try {
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

    const dt = fromYmd(serviceDate)!;
    const next = new Date(dt);
    next.setDate(dt.getDate() + 1);

    // Determine party size. Solo roles always 1.
    let partySize = 1;
    if (roleDef.multipleEntries) {
      if (!Number.isFinite(partySizeRaw) || partySizeRaw < 1) {
        return NextResponse.json({ error: "Please enter how many people are attending (1 or more)" }, { status: 400 });
      }
      partySize = Math.floor(partySizeRaw);
      if (partySize > ATTENDER_CAP) {
        return NextResponse.json({ error: `Party size can't exceed ${ATTENDER_CAP}` }, { status: 400 });
      }
    }

    // Resolve slotIndex
    let slotIndex: number;
    if (!roleDef.multipleEntries) {
      slotIndex = 0;
    } else {
      // ATTENDER: check capacity and pick next sequential slotIndex
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
          { error: `Only ${remaining} spot${remaining === 1 ? "" : "s"} remaining for that Sunday.` },
          { status: 409 }
        );
      }
      const maxSlot = existing.reduce(
        (m: number, e: { slotIndex: number }) => Math.max(m, e.slotIndex),
        0
      );
      slotIndex = maxSlot + 1;
    }

    // One-person-one-role-per-Sunday: check email/phone not already used
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
          partySize,
          remindBy: remindBy as any,
        },
      });

      // Fire-and-forget confirmation message (don't block the response on it)
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
      ).catch(() => {
        // Swallow errors — the signup itself succeeded
      });

      return NextResponse.json({ ok: true, id: created.id });
    } catch (e: any) {
      if (String(e?.code) === "P2002") {
        return NextResponse.json({ error: "That role was just filled. Please refresh and try again." }, { status: 409 });
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

import { NextResponse } from "next/server";
import { setAdminCookie } from "@/lib/adminAuth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const password = String(body?.password || "");
  const correct = process.env.ADMIN_PASSWORD || "";

  if (!correct) return NextResponse.json({ error: "ADMIN_PASSWORD is not set" }, { status: 500 });
  if (password !== correct) return NextResponse.json({ error: "Invalid password" }, { status: 401 });

  setAdminCookie();
  return NextResponse.json({ ok: true });
}

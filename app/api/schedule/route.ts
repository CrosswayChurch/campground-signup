import { NextResponse } from "next/server";
import { getAllowedSundays } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sundays: getAllowedSundays() });
}

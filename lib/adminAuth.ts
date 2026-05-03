import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "ch_admin";

function secret() {
  return process.env.ADMIN_COOKIE_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

export function setAdminCookie() {
  const value = `ok.${sign("ok")}`;
  cookies().set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export function clearAdminCookie() {
  cookies().set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function isAdminAuthed() {
  const c = cookies().get(COOKIE_NAME)?.value || "";
  const [status, sig] = c.split(".");
  if (status !== "ok" || !sig) return false;
  return sig === sign("ok");
}

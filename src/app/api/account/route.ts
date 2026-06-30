// Self-service account settings for the signed-in user.
//   PATCH /api/account  { currentPassword, email?, newPassword? }
// Lets a user change THEIR OWN email and/or password. Requires the current
// password as confirmation (so an open/unattended session can't be hijacked).
// Operates on the session user's own id — never an arbitrary account.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { currentPassword?: string; email?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const me = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!me) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  // 1) Confirm identity with the current password.
  const ok = await bcrypt.compare(body.currentPassword ?? "", me.passwordHash);
  if (!ok) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });

  const data: Record<string, unknown> = {};

  // 2) Email change (optional) — validate + ensure it's not taken by someone else.
  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (email !== me.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash && clash.id !== me.id) {
        return NextResponse.json({ error: "That email is already in use." }, { status: 409 });
      }
      data.email = email;
    }
  }

  // 3) Password change (optional).
  if (typeof body.newPassword === "string" && body.newPassword.length > 0) {
    if (body.newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(body.newPassword, 10);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  try {
    await prisma.user.update({ where: { id: me.id }, data });
  } catch {
    return NextResponse.json({ error: "Couldn't save changes." }, { status: 500 });
  }

  // If email or password changed, the JWT is now stale → the client should sign
  // out and sign back in with the new credentials.
  const reauth = "email" in data || "passwordHash" in data;
  return NextResponse.json({ ok: true, emailChanged: "email" in data, passwordChanged: "passwordHash" in data, reauth });
}

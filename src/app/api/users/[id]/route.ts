// Single-user admin API (admin-only).
//   PATCH  /api/users/:id → update name/role/access/active, and optionally password
//   DELETE /api/users/:id → remove the user

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null;
  return session;
}

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  access: true,
  active: true,
  createdAt: true,
} as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") data.name = body.name.trim();
    if (body.role === "ADMIN" || body.role === "EMPLOYEE") data.role = body.role;
    if (Array.isArray(body.access)) data.access = body.access.map(String);
    if (typeof body.active === "boolean") data.active = body.active;
    if (typeof body.password === "string" && body.password.length >= 6) {
      data.passwordHash = await bcrypt.hash(body.password, 10);
    }
    const updated = await prisma.user.update({
      where: { id: params.id },
      data,
      select: PUBLIC_FIELDS,
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Don't let an admin delete their own account out from under themselves.
  if (session.user.id === params.id)
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  try {
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}

// Users admin API (admin-only).
//   GET  /api/users → list all team members (no password hashes)
//   POST /api/users → create a user with a hashed password

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

// Never return password hashes to the client.
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  access: true,
  active: true,
  createdAt: true,
} as const;

export async function GET() {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: PUBLIC_FIELDS,
  });
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  if (!(await requireAdmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !name || password.length < 6) {
      return NextResponse.json(
        { error: "Name, email and a 6+ character password are required." },
        { status: 400 }
      );
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "Email already exists." }, { status: 409 });

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: body.role === "ADMIN" ? "ADMIN" : "EMPLOYEE",
        access: Array.isArray(body.access) ? body.access.map(String) : [],
        active: body.active !== false,
      },
      select: PUBLIC_FIELDS,
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}

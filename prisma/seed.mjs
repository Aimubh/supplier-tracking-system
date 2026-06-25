// Seed the first admin user. Idempotent (upsert by email).
// Run with: npm run db:seed
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin@123"; // change after first login
const ALL_TABS = ["dashboard", "directory", "pre-order", "on-working", "post-order", "order-summary"];

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN", active: true, access: ALL_TABS },
    create: {
      email: ADMIN_EMAIL,
      name: "Bhavya",
      passwordHash,
      role: "ADMIN",
      access: ALL_TABS,
      active: true,
    },
  });
  console.log(`Seeded admin: ${admin.email} (password: ${ADMIN_PASSWORD})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

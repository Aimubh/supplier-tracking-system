// Restore a database backup produced by prisma/backup.mjs.
//
//   npm run db:restore -- backups/backup-2026-06-25T14-30-00-000Z.json
//
// Uses upsert so existing rows (matched by id) are updated and missing rows are
// created. It does NOT delete rows that are absent from the backup. Run against
// the target database selected by DATABASE_URL in your .env.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npm run db:restore -- <path-to-backup.json>");
    process.exit(1);
  }

  const file = resolve(process.cwd(), arg);
  const dump = JSON.parse(readFileSync(file, "utf8"));
  const { users = [], products = [], manufacturers = [] } = dump.data ?? {};

  console.log("Restoring from:", file);
  console.log("Counts:", dump.counts ?? "(unknown)");

  for (const u of users) {
    await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
  }
  for (const p of products) {
    await prisma.product.upsert({ where: { id: p.id }, update: p, create: p });
  }
  for (const m of manufacturers) {
    await prisma.manufacturer.upsert({ where: { id: m.id }, update: m, create: m });
  }

  console.log("Restore complete.");
}

main()
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

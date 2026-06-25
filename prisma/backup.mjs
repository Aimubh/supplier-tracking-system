// Local database backup — exports every table to a timestamped JSON file in
// /backups (which is gitignored). This captures the LIVE data (products,
// manufacturers, and users incl. password hashes), so the output must NEVER be
// committed to git. Run with: npm run db:backup
//
// Restore counterpart: prisma/restore.mjs

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const prisma = new PrismaClient();

async function main() {
  const [users, products, manufacturers] = await Promise.all([
    prisma.user.findMany(),
    prisma.product.findMany(),
    prisma.manufacturer.findMany(),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    schema: "supplier-tracking-system",
    counts: {
      users: users.length,
      products: products.length,
      manufacturers: manufacturers.length,
    },
    data: { users, products, manufacturers },
  };

  const dir = resolve(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });

  // Filesystem-safe timestamp: 2026-06-25T14-30-00-000Z
  const stamp = dump.exportedAt.replace(/:/g, "-").replace(/\./g, "-");
  const file = resolve(dir, `backup-${stamp}.json`);

  writeFileSync(file, JSON.stringify(dump, null, 2), "utf8");

  console.log("Backup written to:", file);
  console.log("Counts:", dump.counts);
  console.log("\nThis file contains live data (incl. password hashes).");
  console.log("It is in /backups and gitignored — do NOT commit it.");
}

main()
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

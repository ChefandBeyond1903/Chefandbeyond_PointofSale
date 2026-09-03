// One-off: set costCents on every Serv-Ware product to COST_FACTOR * its own
// selling price (priceCents). Unlike the Atosa cost script this needs no
// price-list file — the factor is applied straight to our list price.
//
//   node scripts/apply-servware-cost.mjs [--apply]
//
// Dry run (prints what would change) unless --apply is passed.

import { PrismaClient } from "@prisma/client";

const COST_FACTOR = 0.6125;
const APPLY = process.argv.includes("--apply");

const prisma = new PrismaClient();

const products = await prisma.product.findMany({
  where: { vendor: "Serv-Ware" },
  select: { id: true, sku: true, priceCents: true, costCents: true },
});

let changed = 0;
for (const p of products) {
  const cost = Math.round(p.priceCents * COST_FACTOR);
  if (cost === p.costCents) continue;
  changed++;
  if (APPLY) {
    await prisma.product.update({ where: { id: p.id }, data: { costCents: cost } });
  }
}

console.log(
  `${APPLY ? "APPLIED" : "DRY RUN"} — Serv-Ware: ${products.length} products, ` +
    `cost ${APPLY ? "updated" : "would update"} on ${changed} ` +
    `(factor ${COST_FACTOR} x selling price).`,
);

await prisma.$disconnect();

// One-off: replace the CB POS catalog with the Atosa USA product list
// scraped from chefandbeyond.com.
//
//   node scripts/import-atosa.mjs [path/to/atosa.json]
//
// - Hard-deletes every existing product that is NOT an incoming ATO- SKU
//   (i.e. the seed demo products), then removes any category left empty.
// - Upserts all Atosa products by SKU: price from the site, cost 0,
//   tax 9.75%, stock tracked starting at 0.
// Safe to re-run.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { categorize } = require(
  process.env.CATEGORIZE_PATH ||
    "C:/Users/cemil/AppData/Local/Temp/claude/C--Users-cemil/8b9affa7-32f0-4f5f-8b8e-ad5c08bff84b/scratchpad/categorize.js",
);

const JSON_PATH =
  process.argv[2] ||
  "C:/Users/cemil/AppData/Local/Temp/claude/C--Users-cemil/8b9affa7-32f0-4f5f-8b8e-ad5c08bff84b/scratchpad/atosa.json";

const TAX_BPS = 975; // 9.75%

const prisma = new PrismaClient();

function clean(desc) {
  return String(desc || "").replace(/\s+/g, " ").trim().slice(0, 1000) || null;
}

async function main() {
  const raw = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const items = raw
    .filter((p) => p.sku && p.name && (p.price_cents ?? null) !== null)
    .map((p) => ({
      sku: p.sku.trim(),
      name: p.name.trim(),
      description: clean(p.short_description),
      priceCents: Math.round(p.price_cents),
      category: categorize(p.name),
    }));

  const incomingSkus = new Set(items.map((i) => i.sku));
  console.log(`Loaded ${items.length} Atosa products from ${JSON_PATH}`);

  // ---- 1. remove existing non-Atosa (seed) products ----
  const toDelete = await prisma.product.findMany({
    where: { sku: { notIn: [...incomingSkus] } },
    select: { id: true, sku: true, name: true },
  });
  if (toDelete.length) {
    const ids = toDelete.map((p) => p.id);
    const refCount = await prisma.saleItem.count({ where: { productId: { in: ids } } });
    if (refCount > 0) {
      throw new Error(
        `${refCount} sale-line(s) reference products slated for deletion. Aborting — ` +
          `archive them instead or clear sales first.`,
      );
    }
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted ${toDelete.length} existing product(s): ${toDelete.map((p) => p.sku).join(", ")}`);
  } else {
    console.log("No existing non-Atosa products to delete.");
  }

  // ---- 2. ensure categories ----
  const catNames = [...new Set(items.map((i) => i.category))].sort();
  const catId = {};
  for (const name of catNames) {
    const c = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
    catId[name] = c.id;
  }
  console.log(`Categories ready: ${catNames.join(", ")}`);

  // ---- 3. upsert products ----
  let created = 0;
  let updated = 0;
  let i = 0;
  for (const it of items) {
    const existing = await prisma.product.findUnique({ where: { sku: it.sku }, select: { id: true } });
    const data = {
      name: it.name,
      description: it.description,
      priceCents: it.priceCents,
      costCents: 0,
      taxRateBps: TAX_BPS,
      trackStock: true,
      stock: 0,
      active: true,
      categoryId: catId[it.category],
    };
    if (existing) {
      await prisma.product.update({ where: { sku: it.sku }, data });
      updated++;
    } else {
      await prisma.product.create({ data: { sku: it.sku, barcode: null, ...data } });
      created++;
    }
    if (++i % 100 === 0) console.log(`  …${i}/${items.length}`);
  }

  // ---- 4. drop now-empty categories ----
  const empties = await prisma.category.findMany({
    where: { products: { none: {} } },
    select: { id: true, name: true },
  });
  if (empties.length) {
    await prisma.category.deleteMany({ where: { id: { in: empties.map((c) => c.id) } } });
    console.log(`Removed empty categories: ${empties.map((c) => c.name).join(", ")}`);
  }

  const total = await prisma.product.count();
  console.log(`\nDone. created=${created} updated=${updated}. Catalog now holds ${total} products.`);
}

main()
  .catch((e) => {
    console.error("\nImport failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

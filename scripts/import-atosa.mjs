// One-off: replace the CB POS catalog with the Atosa USA product list
// scraped from chefandbeyond.com (scripts/data/atosa.jsonl).
//
//   node scripts/import-atosa.mjs [path/to/atosa.jsonl]
//
// - Deletes every existing product whose SKU is NOT in the incoming Atosa set.
//   A product still referenced by a sale line, PO line, or bill line cannot be
//   hard-deleted, so those are deactivated (active = false) instead.
// - Upserts every Atosa product by SKU: name + description + price from the
//   site, cost 0 (entered later), vendor "Atosa USA", stock tracked. Quantities
//   are per-store (StoreInventory) and are left for later.
// - Categories are derived from the product name (see categorize()) and created
//   as needed; categories left empty afterward are removed.
// Safe to re-run.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = "Atosa USA";
const JSON_PATH = process.argv[2] || join(__dirname, "data", "atosa.jsonl");

const prisma = new PrismaClient();

// Ordered keyword rules: first match wins. Keep the specific rules above the
// generic ones (e.g. "Additional Shelf" parts before "Wall Shelf" shelving).
const CATEGORY_RULES = [
  [/additional .*(shelf|divider)|replacement cartridge|filter paper|pan rack|\bcaster|flex hose|bottle organizer|wall mount kit|griddle cleaner|coil cleaner|water filter/i, "Parts & Accessories"],
  [/walk-?in/i, "Walk-In Coolers & Freezers"],
  [/ice (machine|maker)|ice storage bin|ice bin/i, "Ice Machines & Bins"],
  [/blast chiller/i, "Blast Chillers"],
  [/milk cooler/i, "Milk Coolers"],
  [/chest freezer/i, "Chest Freezers"],
  [/back bar|bottle cooler|bar cooler|draft beer|beer cooler|glass froster/i, "Back Bar & Bottle Coolers"],
  [/merchandiser|display case|open air|pizza locker/i, "Merchandisers & Display Cases"],
  [/pizza prep|sandwich|salad prep|mega top|prep table/i, "Prep Tables"],
  [/chef base|worktop|work top|undercounter|under-counter/i, "Undercounter & Worktop Refrigeration"],
  [/reach-?in|refrigerator|freezer/i, "Reach-In Refrigeration"],
  [/combi oven|convection oven/i, "Ovens"],
  [/fryer|filter paper/i, "Fryers"],
  [/griddle|charbroiler|char-broiler|cheesemelter|salamander/i, "Griddles & Charbroilers"],
  [/heated holding|food warmer|food cooker\/warmer|rice cooker|steam table|heated display/i, "Holding & Warming"],
  [/range|wok|hotplate|hot plate|stock pot|stove/i, "Ranges & Cooking"],
  [/work table|equipment stand|\bsink\b|compartment sink/i, "Work Tables & Sinks"],
  [/overshelf|wall shelf|wall-mounted shel|shelving|\bshelves\b/i, "Shelving"],
  [/shelf|caster|pan rack|flex hose|bottle organizer|wall mount kit|cleaner|water filter|cartridge|wire divider/i, "Parts & Accessories"],
];

function categorize(name) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat;
  return "Other Equipment";
}

function clean(desc) {
  return String(desc || "").replace(/\s+/g, " ").trim().slice(0, 1000) || null;
}

async function main() {
  const raw = readFileSync(JSON_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const items = raw
    .filter((p) => p.sku && p.name && (p.price_usd ?? null) !== null)
    .map((p) => ({
      sku: p.sku.trim(),
      name: p.name.trim(),
      description: clean(p.description ?? p.short_description),
      priceCents: Math.round(Number(p.price_usd) * 100),
      category: categorize(p.name),
    }));

  const incomingSkus = new Set(items.map((i) => i.sku));
  console.log(`Loaded ${items.length} Atosa products from ${JSON_PATH}`);

  // ---- 1. clear out every product that isn't in the incoming Atosa set ----
  const stale = await prisma.product.findMany({
    where: { sku: { notIn: [...incomingSkus] } },
    select: { id: true, sku: true },
  });
  if (stale.length) {
    const ids = stale.map((p) => p.id);
    const referenced = new Set();
    for (const [table, delegate] of [
      ["saleItem", prisma.saleItem],
      ["purchaseOrderItem", prisma.purchaseOrderItem],
      ["billItem", prisma.billItem],
    ]) {
      const rows = await delegate.findMany({
        where: { productId: { in: ids } },
        select: { productId: true },
      });
      rows.forEach((r) => r.productId && referenced.add(r.productId));
      if (rows.length) console.log(`  ${rows.length} ${table} row(s) block a hard delete`);
    }

    const deletableIds = ids.filter((id) => !referenced.has(id));
    const keepActiveOff = ids.filter((id) => referenced.has(id));

    if (deletableIds.length) {
      await prisma.product.deleteMany({ where: { id: { in: deletableIds } } });
      console.log(`Deleted ${deletableIds.length} unreferenced product(s).`);
    }
    if (keepActiveOff.length) {
      await prisma.product.updateMany({
        where: { id: { in: keepActiveOff } },
        data: { active: false },
      });
      console.log(`Deactivated ${keepActiveOff.length} referenced product(s) (kept for history).`);
    }
  } else {
    console.log("No existing non-Atosa products to remove.");
  }

  // ---- 2. ensure categories ----
  const catNames = [...new Set(items.map((i) => i.category))].sort();
  const catId = {};
  for (const name of catNames) {
    const c = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
    catId[name] = c.id;
  }
  console.log(`Categories ready (${catNames.length}): ${catNames.join(", ")}`);

  // ---- 3. upsert products ----
  let created = 0;
  let updated = 0;
  let i = 0;
  for (const it of items) {
    const data = {
      name: it.name,
      description: it.description,
      priceCents: it.priceCents,
      costCents: 0,
      vendor: VENDOR,
      trackStock: true,
      active: true,
      categoryId: catId[it.category],
    };
    const existing = await prisma.product.findUnique({
      where: { sku: it.sku },
      select: { id: true },
    });
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

// Additive catalog import: adds/updates one brand's products from a scraped
// JSONL file. Unlike import-atosa.mjs it deletes nothing — other brands are
// left untouched.
//
//   node scripts/import-brand.mjs <path/to/brand.jsonl> "<Vendor Name>"
//   node scripts/import-brand.mjs scripts/data/dukers.jsonl "Dukers Appliance Co"
//
// - Upserts each row by SKU: name + price from the site, cost 0 (set later),
//   the given vendor, stock tracked. Quantities are per-store and entered later.
// - Categories are derived from the product name (same keyword map the Atosa
//   import used, so category rows are shared) and created as needed.
// Safe to re-run.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const [jsonPath, vendorArg] = process.argv.slice(2);
if (!jsonPath || !vendorArg) {
  console.error('Usage: node scripts/import-brand.mjs <file.jsonl> "<Vendor Name>"');
  process.exit(1);
}
const VENDOR = vendorArg.trim();
const prisma = new PrismaClient();

// Ordered keyword rules: first match wins. Specific rules above generic ones.
const CATEGORY_RULES = [
  [/additional .*(shelf|divider)|replacement cartridge|filter paper|pan rack|\bcaster|flex hose|bottle organizer|wall mount kit|griddle cleaner|coil cleaner|water filter|faucet|drainboard|dunnage rack|foot valve|knee valve|waste valve|overflow pipe|table legs|leg set|side splash|pot rack|hinge bracket|hose kit|sneeze guard|slant rack|security unit|utility (cart|transport)|bussing|\bwheel\b|\binsert\b|shelf mat|shelf clip|shelving post|wall bracket|(refrigerator|freezer) rack/i, "Parts & Accessories"],
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
  [/combi oven|convection oven|pizza oven/i, "Ovens"],
  [/fryer/i, "Fryers"],
  [/griddle|charbroiler|char-broiler|cheesemelter|salamander|portable grill/i, "Griddles & Charbroilers"],
  [/heated holding|food warmer|food (pan )?warmer|food cooker\/warmer|rice cooker|steam table|heated display|hot food (table|serving)|hot dog steamer|warming drawer|chip warmer|proofer cabinet|heater proofer/i, "Holding & Warming"],
  [/meat slicer|planetary|dough mixer|\bmixer\b|food processor/i, "Food Prep Equipment"],
  [/range|wok|hotplate|hot plate|stock pot|stove|gas burner/i, "Ranges & Cooking"],
  [/work table|equipment stand|\bsink\b|compartment sink|dishtable|dish table/i, "Work Tables & Sinks"],
  [/overshelf|undershelf|wall shelf|wall-mounted shel|shelving|\bshelves\b|\bshelf\b/i, "Shelving"],
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
  const items = readFileSync(jsonPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((p) => p.sku && p.name && (p.price_usd ?? null) !== null)
    .map((p) => ({
      sku: p.sku.trim(),
      name: p.name.trim(),
      description: clean(p.description ?? p.short_description),
      priceCents: Math.round(Number(p.price_usd) * 100),
      category: categorize(p.name),
    }));

  console.log(`Loaded ${items.length} "${VENDOR}" products from ${jsonPath}`);

  // ---- ensure a Vendor row so this brand appears on the Vendors page ----
  await prisma.vendor.upsert({ where: { name: VENDOR }, update: {}, create: { name: VENDOR } });
  console.log(`Vendor "${VENDOR}" ready.`);

  // ---- categories ----
  const catNames = [...new Set(items.map((i) => i.category))].sort();
  const catId = {};
  for (const name of catNames) {
    const c = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
    catId[name] = c.id;
  }
  console.log(`Categories ready (${catNames.length}): ${catNames.join(", ")}`);

  // ---- upsert products (no deletes) ----
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

  const total = await prisma.product.count();
  const mine = await prisma.product.count({ where: { vendor: VENDOR } });
  console.log(`\nDone. created=${created} updated=${updated}. "${VENDOR}" now has ${mine} products; catalog total ${total}.`);
}

main()
  .catch((e) => {
    console.error("\nImport failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

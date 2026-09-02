// One-off: set umrpCents on every Atosa product from the Atosa price-list PDF
// (the UMRP column). Matches PDF model number to our SKU by stripping "ATO-".
//
//   node --env-file=.env scripts/apply-atosa-umrp.mjs <umrp-map.json> [--apply]
//
// Without --apply it's a dry run (prints coverage, writes nothing).

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const [mapPath, flag] = process.argv.slice(2);
if (!mapPath) {
  console.error("Usage: node scripts/apply-atosa-umrp.mjs <umrp-map.json> [--apply]");
  process.exit(1);
}
const APPLY = flag === "--apply";
const raw = JSON.parse(readFileSync(mapPath, "utf8")); // { MODEL: umrpCents }

// Loose key: uppercase, alphanumerics only (so "/", "-", ".", spaces, "*" all
// collapse — SWS1284/304 and SWS1284-304 land on the same key).
const loose = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const byLoose = new Map();
for (const [model, cents] of Object.entries(raw)) {
  const k = loose(model);
  if (!byLoose.has(k)) byLoose.set(k, cents);
}

// Candidate model spellings for one of our SKUs (minus the ATO- prefix).
function candidates(model) {
  const set = new Set();
  const add = (s) => s && set.add(s);
  add(model);
  // indoor walk-in variants aren't priced separately — use the outdoor one
  add(model.replace(/-IL-IR$/i, "-EL-ER").replace(/-IL\/IR$/i, "-EL/ER"));
  const noGas = model.replace(/-(NG|LP|N|L)$/i, "");
  add(noGas);
  for (const m of [model, noGas]) {
    add(m.replace(/-(GRL|GR)$/i, "")); // trailing colour / hinge code Atosa omits
    add(m.replace(/-SA$/i, "")); // "stainless" assembly suffix
    add(m.replace(/-?(AUS)-?([12])$/i, "$1$2"));
    add(m + "GR"); // Atosa sometimes appends the colour with no dash
    add(m + "GRL");
    add(m + "L"); // left/right-hinge share a price
  }
  add(noGas.replace(/-(GRL|GR)$/i, ""));
  return [...set];
}

function umrpFor(sku) {
  const model = sku.replace(/^ATO-/i, "");
  for (const c of candidates(model)) {
    const hit = byLoose.get(loose(c));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const prisma = new PrismaClient();

const products = await prisma.product.findMany({
  where: { vendor: "Atosa USA" },
  select: { id: true, sku: true, priceCents: true, umrpCents: true },
});

let matched = 0;
let changed = 0;
let abovePrice = 0;
const unmatched = [];

for (const p of products) {
  let umrp = umrpFor(p.sku);
  if (umrp === undefined) umrp = umrpFor(p.sku.replace(/-(ICE-BIN)$/i, ""));
  if (umrp === undefined) {
    unmatched.push(p.sku);
    continue;
  }
  matched++;
  if (umrp > p.priceCents) {
    abovePrice++;
    continue; // never set a floor above the sell price
  }
  if (umrp === p.umrpCents) continue;
  if (APPLY) {
    await prisma.product.update({ where: { id: p.id }, data: { umrpCents: umrp } });
  }
  changed++;
}

console.log(
  `${APPLY ? "APPLIED" : "DRY RUN"} — Atosa products: ${products.length}, ` +
    `matched in PDF: ${matched}, umrp ${APPLY ? "updated" : "would update"}: ${changed}, ` +
    `skipped (PDF umrp > our price): ${abovePrice}, unmatched: ${unmatched.length}`,
);
if (unmatched.length) {
  console.log("\nUnmatched SKUs (no umrp set):");
  console.log(unmatched.join("\n"));
}

await prisma.$disconnect();

// One-off: set costCents on every Atosa product to 0.475 * (Atosa list price)
// from the Atosa price-list PDF. Matches PDF model to our SKU by stripping
// "ATO-" (same loose matching as apply-atosa-umrp.mjs).
//
//   node --env-file=.env scripts/apply-atosa-cost.mjs <pricelist.json> [--apply]
//
// pricelist.json: { MODEL: { list, map, umrp } } in cents. Dry run unless --apply.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const COST_FACTOR = 0.475;

const [mapPath, flag] = process.argv.slice(2);
if (!mapPath) {
  console.error("Usage: node scripts/apply-atosa-cost.mjs <pricelist.json> [--apply]");
  process.exit(1);
}
const APPLY = flag === "--apply";
const raw = JSON.parse(readFileSync(mapPath, "utf8"));

const loose = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const listByLoose = new Map();
for (const [model, v] of Object.entries(raw)) {
  const k = loose(model);
  if (!listByLoose.has(k) && v && v.list > 0) listByLoose.set(k, v.list);
}

function candidates(model) {
  const set = new Set();
  const add = (s) => s && set.add(s);
  add(model);
  add(model.replace(/-IL-IR$/i, "-EL-ER").replace(/-IL\/IR$/i, "-EL/ER"));
  const noGas = model.replace(/-(NG|LP|N|L)$/i, "");
  add(noGas);
  for (const m of [model, noGas]) {
    add(m.replace(/-(GRL|GR)$/i, ""));
    add(m.replace(/-SA$/i, ""));
    add(m.replace(/-?(AUS)-?([12])$/i, "$1$2"));
    add(m + "GR");
    add(m + "GRL");
    add(m + "L");
  }
  add(noGas.replace(/-(GRL|GR)$/i, ""));
  return [...set];
}

function listFor(sku) {
  const model = sku.replace(/^ATO-/i, "").replace(/-(ICE-BIN)$/i, "");
  for (const c of candidates(model)) {
    const hit = listByLoose.get(loose(c));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const prisma = new PrismaClient();
const products = await prisma.product.findMany({
  where: { vendor: "Atosa USA" },
  select: { id: true, sku: true, priceCents: true, costCents: true },
});

let matched = 0;
let changed = 0;
const unmatched = [];

for (const p of products) {
  const list = listFor(p.sku);
  if (list === undefined) {
    unmatched.push(p.sku);
    continue;
  }
  matched++;
  const cost = Math.round(list * COST_FACTOR);
  if (cost === p.costCents) continue;
  if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { costCents: cost } });
  changed++;
}

console.log(
  `${APPLY ? "APPLIED" : "DRY RUN"} — Atosa: ${products.length}, matched: ${matched}, ` +
    `cost ${APPLY ? "updated" : "would update"}: ${changed}, unmatched: ${unmatched.length}`,
);
if (unmatched.length) console.log("\nUnmatched:\n" + unmatched.join("\n"));

await prisma.$disconnect();

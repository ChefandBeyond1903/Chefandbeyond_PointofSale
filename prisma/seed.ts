import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const manager = await prisma.user.upsert({
    where: { email: "manager@cbpos.local" },
    update: {},
    create: {
      email: "manager@cbpos.local",
      name: "Morgan Manager",
      passwordHash,
      role: "MANAGER",
    },
  });

  await prisma.user.upsert({
    where: { email: "cashier@cbpos.local" },
    update: {},
    create: {
      email: "cashier@cbpos.local",
      name: "Casey Cashier",
      passwordHash,
      role: "CASHIER",
    },
  });

  const categories = ["Beverages", "Snacks", "Apparel", "Accessories", "Home"];
  const catByName: Record<string, string> = {};
  for (const name of categories) {
    const c = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    catByName[name] = c.id;
  }

  const products: Array<{
    name: string;
    sku: string;
    barcode?: string;
    category: string;
    priceCents: number;
    costCents: number;
    taxRateBps: number;
    stock: number;
  }> = [
    { name: "Cola 330ml", sku: "BEV-001", barcode: "0000000000017", category: "Beverages", priceCents: 199, costCents: 70, taxRateBps: 800, stock: 120 },
    { name: "Sparkling Water 500ml", sku: "BEV-002", barcode: "0000000000024", category: "Beverages", priceCents: 149, costCents: 45, taxRateBps: 800, stock: 90 },
    { name: "Cold Brew Coffee", sku: "BEV-003", barcode: "0000000000031", category: "Beverages", priceCents: 349, costCents: 130, taxRateBps: 800, stock: 40 },
    { name: "Potato Chips", sku: "SNK-001", barcode: "0000000000048", category: "Snacks", priceCents: 259, costCents: 95, taxRateBps: 800, stock: 75 },
    { name: "Chocolate Bar", sku: "SNK-002", barcode: "0000000000055", category: "Snacks", priceCents: 179, costCents: 60, taxRateBps: 800, stock: 150 },
    { name: "Trail Mix", sku: "SNK-003", barcode: "0000000000062", category: "Snacks", priceCents: 399, costCents: 150, taxRateBps: 800, stock: 30 },
    { name: "Cotton T-Shirt", sku: "APP-001", barcode: "0000000000079", category: "Apparel", priceCents: 1999, costCents: 700, taxRateBps: 0, stock: 25 },
    { name: "Baseball Cap", sku: "APP-002", barcode: "0000000000086", category: "Apparel", priceCents: 2499, costCents: 900, taxRateBps: 0, stock: 18 },
    { name: "Canvas Tote Bag", sku: "ACC-001", barcode: "0000000000093", category: "Accessories", priceCents: 1299, costCents: 400, taxRateBps: 0, stock: 42 },
    { name: "Stainless Water Bottle", sku: "ACC-002", barcode: "0000000000109", category: "Accessories", priceCents: 1799, costCents: 650, taxRateBps: 0, stock: 33 },
    { name: "Scented Candle", sku: "HOM-001", barcode: "0000000000116", category: "Home", priceCents: 1599, costCents: 550, taxRateBps: 800, stock: 20 },
    { name: "Ceramic Mug", sku: "HOM-002", barcode: "0000000000123", category: "Home", priceCents: 999, costCents: 300, taxRateBps: 800, stock: 60 },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        priceCents: p.priceCents,
        costCents: p.costCents,
        taxRateBps: p.taxRateBps,
        stock: p.stock,
        trackStock: true,
        categoryId: catByName[p.category],
      },
    });
  }

  console.log("Seed complete.");
  console.log("  Manager login: manager@cbpos.local / password123");
  console.log("  Cashier login: cashier@cbpos.local / password123");
  console.log(`  ${products.length} products across ${categories.length} categories.`);
  void manager;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set to seed staff accounts`);
  return v;
}

const admin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Create (or find) the Supabase Auth user and return its id. */
async function ensureAuthUser(email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (data.user) return data.user.id;

  // Already exists — look it up (staff lists stay small, one page is enough).
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);
  if (!existing) throw error ?? new Error(`Could not create or find auth user ${email}`);
  return existing.id;
}

async function main() {
  const password = process.env.SEED_STAFF_PASSWORD ?? "password123";

  // Company (single row) ------------------------------------------------------
  await prisma.company.upsert({
    where: { id: "company" },
    update: {},
    create: {
      id: "company",
      name: "Chef and Beyond",
      legalName: "Chef and Beyond LLC",
      taxId: "",
      address: "",
      phone: "",
      email: "",
      website: "",
    },
  });

  // Stores ------------------------------------------------------------------
  const nashville = await prisma.store.upsert({
    where: { name: "Chef and Beyond - Nashville" },
    update: { taxRateBps: 975 },
    create: { name: "Chef and Beyond - Nashville", taxRateBps: 975 },
  });

  const clarksville = await prisma.store.upsert({
    where: { name: "Chef and Beyond - Clarksville" },
    update: { taxRateBps: 600 },
    create: { name: "Chef and Beyond - Clarksville", taxRateBps: 600 },
  });

  // Staff — identity in Supabase Auth, role/store in our User table.
  // First seed creates each account with the default password; change it in the
  // app and a later reseed will NOT overwrite it (ensureAuthUser never touches
  // an existing account's password). Add real staff here and they survive every
  // reset/reseed.
  const staff: {
    email: string;
    name: string;
    role: "CASHIER" | "MANAGER" | "ADMIN";
    storeId: string | null;
  }[] = [
    { email: "admin@cbpos.local", name: "Avery Admin", role: "ADMIN", storeId: null },
    { email: "manager@cbpos.local", name: "Morgan Manager", role: "MANAGER", storeId: nashville.id },
    { email: "cashier@cbpos.local", name: "Casey Cashier", role: "CASHIER", storeId: clarksville.id },
    { email: "igoc@chefandbeyond.com", name: "Ilhan Goc", role: "CASHIER", storeId: clarksville.id },
    { email: "bcameron@chefandbeyond.com", name: "Blake Cameron", role: "MANAGER", storeId: clarksville.id },
  ];
  for (const s of staff) {
    const email = s.email.toLowerCase();
    const authId = await ensureAuthUser(email, password);
    // The proxy reads the role from the session's app_metadata to gate
    // manager-only pages without a database round-trip.
    await admin.auth.admin.updateUserById(authId, { app_metadata: { pos_role: s.role } });
    await prisma.user.upsert({
      where: { email },
      update: { name: s.name, role: s.role, storeId: s.storeId, authId },
      create: { email, name: s.name, role: s.role, storeId: s.storeId, authId },
    });
  }

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
    stock: number;
  }> = [
    { name: "Cola 330ml", sku: "BEV-001", barcode: "0000000000017", category: "Beverages", priceCents: 199, costCents: 70, stock: 120 },
    { name: "Sparkling Water 500ml", sku: "BEV-002", barcode: "0000000000024", category: "Beverages", priceCents: 149, costCents: 45, stock: 90 },
    { name: "Cold Brew Coffee", sku: "BEV-003", barcode: "0000000000031", category: "Beverages", priceCents: 349, costCents: 130, stock: 40 },
    { name: "Potato Chips", sku: "SNK-001", barcode: "0000000000048", category: "Snacks", priceCents: 259, costCents: 95, stock: 75 },
    { name: "Chocolate Bar", sku: "SNK-002", barcode: "0000000000055", category: "Snacks", priceCents: 179, costCents: 60, stock: 150 },
    { name: "Trail Mix", sku: "SNK-003", barcode: "0000000000062", category: "Snacks", priceCents: 399, costCents: 150, stock: 30 },
    { name: "Cotton T-Shirt", sku: "APP-001", barcode: "0000000000079", category: "Apparel", priceCents: 1999, costCents: 700, stock: 25 },
    { name: "Baseball Cap", sku: "APP-002", barcode: "0000000000086", category: "Apparel", priceCents: 2499, costCents: 900, stock: 18 },
    { name: "Canvas Tote Bag", sku: "ACC-001", barcode: "0000000000093", category: "Accessories", priceCents: 1299, costCents: 400, stock: 42 },
    { name: "Stainless Water Bottle", sku: "ACC-002", barcode: "0000000000109", category: "Accessories", priceCents: 1799, costCents: 650, stock: 33 },
    { name: "Scented Candle", sku: "HOM-001", barcode: "0000000000116", category: "Home", priceCents: 1599, costCents: 550, stock: 20 },
    { name: "Ceramic Mug", sku: "HOM-002", barcode: "0000000000123", category: "Home", priceCents: 999, costCents: 300, stock: 60 },
  ];

  const storeIds = [nashville.id, clarksville.id];
  for (const p of products) {
    const row = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        priceCents: p.priceCents,
        costCents: p.costCents,
        trackStock: true,
        categoryId: catByName[p.category],
      },
    });
    for (const storeId of storeIds) {
      await prisma.storeInventory.upsert({
        where: { productId_storeId: { productId: row.id, storeId } },
        update: {},
        create: { productId: row.id, storeId, quantity: p.stock },
      });
    }
  }

  console.log("Seed complete.");
  console.log(`  Admin login:   admin@cbpos.local / ${password}    (all stores)`);
  console.log(`  Manager login: manager@cbpos.local / ${password}  (Nashville · 9.75%)`);
  console.log(`  Cashier login: cashier@cbpos.local / ${password}  (Clarksville · 6%)`);
  console.log(`  ${staff.length} staff accounts ensured (new ones default to ${password}).`);
  console.log(`  ${products.length} products across ${categories.length} categories.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

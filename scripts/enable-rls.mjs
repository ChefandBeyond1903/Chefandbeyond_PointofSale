// Enable Row Level Security on a table. Every public table needs it: Prisma
// connects as the owner (unaffected), but without RLS the Supabase publishable
// key could read the table through the auto-generated REST API.
// Run: node scripts/enable-rls.mjs CardReader
import { PrismaClient } from "@prisma/client";
const table = process.argv[2];
if (!table) throw new Error("usage: node scripts/enable-rls.mjs <Table>");
const p = new PrismaClient();
await p.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
const rows = await p.$queryRawUnsafe(`select relname, relrowsecurity from pg_class where relname = $1 and relkind = 'r'`, table);
console.log(rows);
await p.$disconnect();

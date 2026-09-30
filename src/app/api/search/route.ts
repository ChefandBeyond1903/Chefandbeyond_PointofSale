import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireScopedUser, scopeStoreId } from "@/lib/scope";
import { formatMoney } from "@/lib/money";
import { searchTerms } from "@/lib/search";
import { ok, toErrorResponse } from "@/lib/api";

// How many hits to return per category in the header's "search everything"
// box — enough to be useful in a dropdown without it turning into a full list.
const TAKE = 6;

type Hit = { id: string; title: string; subtitle: string; href: string };

export async function GET(req: NextRequest) {
  try {
    const actor = await requireScopedUser();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    const empty = {
      products: [] as Hit[],
      customers: [] as Hit[],
      vendors: [] as Hit[],
      purchaseOrders: [] as Hit[],
      invoices: [] as Hit[],
      quotes: [] as Hit[],
      bills: [] as Hit[],
    };
    if (q.length < 2) return ok(empty);

    const scopedStore = scopeStoreId(actor);
    const storeScope = scopedStore ? { storeId: scopedStore } : {};
    const asNumber = Number(q.replace(/[^0-9]/g, ""));
    const hasNumber = Number.isInteger(asNumber) && asNumber > 0;
    // Bills aren't on a cashier's nav at all — don't surface them in search either.
    const canSeeBills = actor.role === "MANAGER" || actor.role === "ADMIN";
    const terms = searchTerms(q);

    const [products, customers, vendors, purchaseOrders, invoices, quotes, bills] =
      await Promise.all([
        prisma.product.findMany({
          where: terms.length
            ? {
                AND: terms.map((term) => ({
                  OR: [
                    { name: { contains: term, mode: "insensitive" as const } },
                    { sku: { contains: term, mode: "insensitive" as const } },
                    { barcode: { contains: term, mode: "insensitive" as const } },
                    { vendor: { contains: term, mode: "insensitive" as const } },
                  ],
                })),
              }
            : {},
          take: TAKE,
          orderBy: { name: "asc" },
          select: { id: true, name: true, sku: true, vendor: true, priceCents: true },
        }),
        prisma.customer.findMany({
          where: {
            ...storeScope,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          },
          take: TAKE,
          orderBy: { name: "asc" },
          select: { id: true, name: true, company: true, email: true, phone: true },
        }),
        prisma.vendor.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { contact: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          },
          take: TAKE,
          orderBy: { name: "asc" },
          select: { id: true, name: true, contact: true },
        }),
        prisma.purchaseOrder.findMany({
          where: {
            AND: [
              scopedStore
                ? { OR: [{ storeId: scopedStore }, { storeId: null }, { createdById: actor.id }] }
                : {},
              {
                OR: [
                  { poNumber: { contains: q, mode: "insensitive" } },
                  { vendor: { contains: q, mode: "insensitive" } },
                  ...(hasNumber ? [{ sale: { number: asNumber } } as const] : []),
                ],
              },
            ],
          },
          take: TAKE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            poNumber: true,
            vendor: true,
            status: true,
            sale: { select: { number: true } },
          },
        }),
        prisma.sale.findMany({
          where: {
            ...storeScope,
            OR: [
              { customerNameSnapshot: { contains: q, mode: "insensitive" } },
              { customerCompanySnapshot: { contains: q, mode: "insensitive" } },
              { customerEmailSnapshot: { contains: q, mode: "insensitive" } },
              { customerPhoneSnapshot: { contains: q, mode: "insensitive" } },
              { websiteOrderNumber: { contains: q, mode: "insensitive" } },
              ...(hasNumber ? [{ number: asNumber }] : []),
            ],
          },
          take: TAKE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            customerNameSnapshot: true,
            customerCompanySnapshot: true,
            totalCents: true,
          },
        }),
        prisma.quote.findMany({
          where: {
            ...storeScope,
            OR: [
              { customerNameSnapshot: { contains: q, mode: "insensitive" } },
              { customerCompanySnapshot: { contains: q, mode: "insensitive" } },
              { customerEmailSnapshot: { contains: q, mode: "insensitive" } },
              { customerPhoneSnapshot: { contains: q, mode: "insensitive" } },
              ...(hasNumber ? [{ number: asNumber }] : []),
            ],
          },
          take: TAKE,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            customerNameSnapshot: true,
            customerCompanySnapshot: true,
            totalCents: true,
          },
        }),
        prisma.bill.findMany({
          where: {
            ...storeScope,
            OR: [
              { billNumber: { contains: q, mode: "insensitive" } },
              { vendor: { contains: q, mode: "insensitive" } },
              { memo: { contains: q, mode: "insensitive" } },
            ],
          },
          // Not a role check on the where-clause — just skip fetching entirely
          // for a cashier so the response shape stays the same either way.
          take: canSeeBills ? TAKE : 0,
          orderBy: { createdAt: "desc" },
          select: { id: true, billNumber: true, vendor: true, status: true, subtotalCents: true },
        }),
      ]);

    return ok({
      products: products.map(
        (p): Hit => ({
          id: p.id,
          title: p.name,
          subtitle: [p.sku, p.vendor].filter(Boolean).join(" · ") || formatMoney(p.priceCents),
          href: `/products?open=${p.id}`,
        }),
      ),
      customers: customers.map(
        (c): Hit => ({
          id: c.id,
          title: c.name,
          subtitle: [c.company, c.phone || c.email].filter(Boolean).join(" · "),
          href: `/customers?open=${c.id}`,
        }),
      ),
      vendors: vendors.map(
        (v): Hit => ({
          id: v.id,
          title: v.name,
          subtitle: v.contact,
          href: `/vendors?open=${v.id}`,
        }),
      ),
      purchaseOrders: purchaseOrders.map(
        (p): Hit => ({
          id: p.id,
          title: p.poNumber,
          subtitle: [p.vendor, p.status].filter(Boolean).join(" · "),
          href: `/purchase-orders/${p.id}`,
        }),
      ),
      invoices: invoices.map(
        (s): Hit => ({
          id: s.id,
          title: `Invoice #${s.number}`,
          subtitle: [s.customerCompanySnapshot || s.customerNameSnapshot, formatMoney(s.totalCents)]
            .filter(Boolean)
            .join(" · "),
          href: `/invoices?open=${s.id}`,
        }),
      ),
      quotes: quotes.map(
        (qt): Hit => ({
          id: qt.id,
          title: `Quote #${qt.number}`,
          subtitle: [qt.customerCompanySnapshot || qt.customerNameSnapshot, formatMoney(qt.totalCents)]
            .filter(Boolean)
            .join(" · "),
          href: `/quotes?open=${qt.id}`,
        }),
      ),
      bills: bills.map(
        (b): Hit => ({
          id: b.id,
          title: b.billNumber ? `Bill ${b.billNumber}` : `Bill — ${b.vendor}`,
          subtitle: [b.vendor, formatMoney(b.subtotalCents)].filter(Boolean).join(" · "),
          href: `/bills?open=${b.id}`,
        }),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

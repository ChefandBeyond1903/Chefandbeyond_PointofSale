import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().trim().max(64).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  description: z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0).default(0),
  umrpCents: z.number().int().min(0).default(0),
  trackStock: z.boolean().default(true),
  categoryId: z.string().trim().min(1).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  active: z.boolean().default(true),
  favorite: z.boolean().default(false),
  vendor: z.string().trim().max(120).default(""),
});

// Every field optional and — crucially — NO defaults, so a partial update
// only touches the keys actually sent. (productCreateSchema.partial() would
// still apply .default() to omitted fields and silently reset them.)
export const productUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().min(1).max(64).optional(),
  barcode: z.string().trim().max(64).optional(),
  description: z.string().trim().max(1000).optional(),
  priceCents: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).optional(),
  umrpCents: z.number().int().min(0).optional(),
  trackStock: z.boolean().optional(),
  categoryId: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
  favorite: z.boolean().optional(),
  vendor: z.string().trim().max(120).optional(),
});

// Bulk operations on the Products page: act on a set of product ids at once.
// `categoryId` may be a string (move), null (clear the category), or omitted
// (leave it). At least one mutating field must be present.
export const productBulkUpdateSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(1000),
    categoryId: z.string().trim().min(1).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.categoryId !== undefined || v.active !== undefined, {
    message: "Nothing to update",
  });

export const productBulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  // hard:true permanently removes rows that no sale references (sale-referenced
  // ones fall back to archive). Default is archive-only (active:false).
  hard: z.boolean().optional().default(false),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// Accepts an ISO datetime or a plain "YYYY-MM-DD".
const dateInput = z
  .string()
  .trim()
  .refine((s) => !s || !Number.isNaN(Date.parse(s)), "Invalid date");

// Receive items against a purchase order and record a vendor bill.
export const billCreateSchema = z.object({
  billNumber: z.string().trim().max(120).default(""),
  billDate: dateInput.optional(),
  dueDate: dateInput.optional().nullable(),
  terms: z.string().trim().max(40).default(""),
  memo: z.string().trim().max(2000).default(""),
  // Admin only: which store the received stock lands in. Others receive into
  // the PO's own store.
  storeId: z.string().min(1).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        receiveQty: z.number().int(), // may be negative to correct an over-receipt
        unitCostCents: z.number().int().min(0),
      }),
    )
    .min(1),
});

// An operating expense (rent, utilities, …) recorded for the P&L.
export const expenseCreateSchema = z.object({
  category: z.string().trim().min(1).max(120),
  payee: z.string().trim().max(160).default(""),
  amountCents: z.number().int().min(1).max(100_000_000_00),
  expenseDate: dateInput.optional(),
  memo: z.string().trim().max(2000).default(""),
  status: z.enum(["PAID", "UNPAID"]).default("PAID"),
  // Admin only: which store the expense belongs to. A manager's expenses are
  // pinned to their own store.
  storeId: z.string().trim().min(1).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export const expenseUpdateSchema = z.object({
  category: z.string().trim().min(1).max(120).optional(),
  payee: z.string().trim().max(160).optional(),
  amountCents: z.number().int().min(1).max(100_000_000_00).optional(),
  expenseDate: dateInput.optional(),
  memo: z.string().trim().max(2000).optional(),
  status: z.enum(["PAID", "UNPAID"]).optional(),
  storeId: z.string().trim().max(64).nullable().optional(),
});

export const expenseCategoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const billUpdateSchema = z.object({
  billNumber: z.string().trim().max(120).optional(),
  billDate: dateInput.optional(),
  dueDate: dateInput.optional().nullable(),
  terms: z.string().trim().max(40).optional(),
  memo: z.string().trim().max(2000).optional(),
  status: z.enum(["OPEN", "PAID"]).optional(),
});

// Set the on-hand quantity of a product at a store (absolute value).
export const inventoryAdjustSchema = z.object({
  productId: z.string().min(1),
  storeId: z.string().min(1),
  quantity: z.number().int(),
});

export const vendorCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(120).default(""),
  email: z.string().trim().max(160).default(""),
  phone: z.string().trim().max(60).default(""),
  address: z.string().trim().max(400).default(""),
  notes: z.string().trim().max(1000).default(""),
  freightMinimumCents: z.number().int().min(0).max(1_000_000_00).default(0),
});

export const vendorUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contact: z.string().trim().max(120).optional(),
  email: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(60).optional(),
  address: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(1000).optional(),
  freightMinimumCents: z.number().int().min(0).max(1_000_000_00).optional(),
});

export const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(9999),
  discountCents: z.number().int().min(0).default(0),
  // Manual per-unit price set at the register (up or down). Omit to use the
  // product's catalog price.
  unitPriceCents: z.number().int().min(0).max(100_000_00).optional(),
});

export const saleCustomerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(60).default(""),
  address: z.string().trim().max(400).default(""),
  company: z.string().trim().max(160).default(""),
});

export const saleCreateSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  orderDiscountCents: z.number().int().min(0).default(0),
  shippingCents: z.number().int().min(0).default(0),
  // Omitted when saving an unpaid invoice for a terms customer.
  paymentMethod: z.enum(["CASH", "CARD"]).optional(),
  tenderedCents: z.number().int().min(0).default(0),
  // Staff credited with the sale. Omit to credit the signed-in operator.
  salespersonId: z.string().min(1).optional(),
  // ADMIN only: the store to ring the sale at (tax rate, snapshots, inventory).
  // Ignored for everyone else — they always sell from their assigned store.
  storeId: z.string().min(1).optional(),
  note: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  // Bill the invoice to a customer: either an existing id, or details to
  // match/auto-create by name.
  customerId: z.string().min(1).optional(),
  customer: saleCustomerSchema.optional(),
});

// Record a payment against an unpaid (INVOICED) sale, settling it.
export const salePaymentSchema = z.object({
  paymentMethod: z.enum(["CASH", "CARD"]),
  // The day the money was received — this becomes the sale's revenue date.
  paidAt: dateInput.optional(),
  tenderedCents: z.number().int().min(0).default(0),
});

// A parked cart. Same shape as a sale minus payment; recalled later on another
// device to finish the sale.
export const heldSaleCreateSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  label: z.string().trim().max(200).default(""),
  note: z.string().trim().max(500).default(""),
  orderDiscountCents: z.number().int().min(0).default(0),
  shippingCents: z.number().int().min(0).default(0),
  salespersonId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  customer: saleCustomerSchema.partial().optional(),
});

// Payment terms a customer can be given; "" means due on receipt.
export const PAYMENT_TERMS = ["", "Due on receipt", "Net 15", "Net 30", "Net 45", "Net 60"] as const;
const paymentTermsSchema = z.enum(PAYMENT_TERMS);

const customerTaxFields = {
  taxExempt: z.boolean(),
  taxExemptCertNumber: z.string().trim().max(120),
  taxExemptState: z.string().trim().max(60),
  // ISO date or ""/null; the route converts to a Date. null/"" clears it.
  taxExemptExpiresAt: dateInput.nullable(),
  paymentTerms: paymentTermsSchema,
};

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(60).default(""),
  address: z.string().trim().max(400).default(""),
  company: z.string().trim().max(160).default(""),
  notes: z.string().trim().max(1000).default(""),
  taxExempt: customerTaxFields.taxExempt.default(false),
  taxExemptCertNumber: customerTaxFields.taxExemptCertNumber.default(""),
  taxExemptState: customerTaxFields.taxExemptState.default(""),
  taxExemptExpiresAt: customerTaxFields.taxExemptExpiresAt.optional(),
  paymentTerms: customerTaxFields.paymentTerms.default(""),
});

export const customerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  address: z.string().trim().max(400).optional(),
  company: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
  taxExempt: customerTaxFields.taxExempt.optional(),
  taxExemptCertNumber: customerTaxFields.taxExemptCertNumber.optional(),
  taxExemptState: customerTaxFields.taxExemptState.optional(),
  taxExemptExpiresAt: customerTaxFields.taxExemptExpiresAt.optional(),
  paymentTerms: customerTaxFields.paymentTerms.optional(),
});

export const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  role: z.enum(["CASHIER", "MANAGER", "ADMIN"]),
  // The store this employee is assigned to. Its tax rate applies to their sales.
  storeId: z.string().trim().min(1).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(["CASHIER", "MANAGER", "ADMIN"]).optional(),
  active: z.boolean().optional(),
  // "" clears the assignment; a non-empty id sets it.
  storeId: z.string().trim().max(64).nullable().optional(),
});

export const storeCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  taxRateBps: z.number().int().min(0).max(100000).default(0),
  address: z.string().trim().max(400).default(""),
  phone: z.string().trim().max(60).default(""),
  email: z.string().trim().max(160).default(""),
  active: z.boolean().default(true),
});

export const storeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  taxRateBps: z.number().int().min(0).max(100000).optional(),
  address: z.string().trim().max(400).optional(),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(160).optional(),
  active: z.boolean().optional(),
});

export const companyUpdateSchema = z.object({
  name: z.string().trim().max(160).default(""),
  legalName: z.string().trim().max(160).default(""),
  taxId: z.string().trim().max(60).default(""),
  address: z.string().trim().max(400).default(""),
  phone: z.string().trim().max(60).default(""),
  email: z.string().trim().max(160).default(""),
  website: z.string().trim().max(160).default(""),
});

export const shiftOpenSchema = z.object({
  openingFloatCents: z.number().int().min(0).default(0),
});

export const shiftCloseSchema = z.object({
  closingCountCents: z.number().int().min(0),
});

export const purchaseOrderCreateSchema = z.object({
  vendor: z.string().trim().min(1).max(120),
  note: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  // Optional: pick specific products (and quantities) for this PO.
  // Omit to include every item from this vendor on the invoice.
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(999999),
      }),
    )
    .min(1)
    .optional(),
});

export const purchaseOrderUpdateSchema = z.object({
  status: z.enum(["OPEN", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(),
  note: z.string().trim().max(500).optional(),
});

// ---- Full purchase-order form (standalone entry / edit) ----

const PO_STATUS = z.enum(["OPEN", "CLOSED", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"]);

const poCategoryLineSchema = z.object({
  category: z.string().trim().max(200).default(""),
  description: z.string().trim().max(1000).default(""),
  amountCents: z.number().int().default(0),
  customerProject: z.string().trim().max(200).default(""),
  klass: z.string().trim().max(200).default(""),
});

const poItemLineSchema = z.object({
  productId: z.string().min(1).nullish(),
  productService: z.string().trim().max(300).default(""),
  sku: z.string().trim().max(120).default(""),
  description: z.string().trim().max(1000).default(""),
  quantity: z.number().int().min(0).default(0),
  rateCents: z.number().int().min(0).default(0),
  customerProject: z.string().trim().max(200).default(""),
  klass: z.string().trim().max(200).default(""),
});

// Accepts an ISO datetime or a plain "YYYY-MM-DD".
const dateish = z
  .string()
  .trim()
  .refine((s) => !s || !Number.isNaN(Date.parse(s)), "Invalid date");

export const purchaseOrderFormSchema = z.object({
  vendor: z.string().trim().min(1).max(120),
  status: PO_STATUS.default("OPEN"),
  poNumber: z.string().trim().min(1).max(60).optional(),
  email: z.string().trim().max(300).default(""),
  ccBcc: z.string().trim().max(300).default(""),
  mailingAddress: z.string().trim().max(1000).default(""),
  shipTo: z.string().trim().max(200).default(""),
  shippingAddress: z.string().trim().max(1000).default(""),
  poDate: dateish.optional(),
  dueDate: dateish.optional().nullable(),
  shipVia: z.string().trim().max(200).default(""),
  storeName: z.string().trim().max(200).default(""),
  permitNumber: z.string().trim().max(120).default(""),
  messageToCustomer: z.string().trim().max(1000).default(""),
  poRef: z.string().trim().max(200).default(""),
  salesRep: z.string().trim().max(200).default(""),
  mobileNumber: z.string().trim().max(60).default(""),
  tags: z.array(z.string().trim().max(60)).max(50).default([]),
  messageToVendor: z.string().trim().max(2000).default(""),
  memo: z.string().trim().max(2000).default(""),
  shippingCents: z.number().int().min(0).default(0),
  categoryLines: z.array(poCategoryLineSchema).default([]),
  itemLines: z.array(poItemLineSchema).default([]),
});

// PATCH: every field optional, no defaults — a `{ status }`-only call and a
// full-form save both go through here.
export const purchaseOrderPatchSchema = z.object({
  vendor: z.string().trim().min(1).max(120).optional(),
  status: PO_STATUS.optional(),
  poNumber: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().max(500).optional(),
  email: z.string().trim().max(300).optional(),
  ccBcc: z.string().trim().max(300).optional(),
  mailingAddress: z.string().trim().max(1000).optional(),
  shipTo: z.string().trim().max(200).optional(),
  shippingAddress: z.string().trim().max(1000).optional(),
  poDate: dateish.optional(),
  dueDate: dateish.optional().nullable(),
  shipVia: z.string().trim().max(200).optional(),
  storeName: z.string().trim().max(200).optional(),
  permitNumber: z.string().trim().max(120).optional(),
  messageToCustomer: z.string().trim().max(1000).optional(),
  poRef: z.string().trim().max(200).optional(),
  salesRep: z.string().trim().max(200).optional(),
  mobileNumber: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().max(60)).max(50).optional(),
  messageToVendor: z.string().trim().max(2000).optional(),
  memo: z.string().trim().max(2000).optional(),
  shippingCents: z.number().int().min(0).optional(),
  categoryLines: z.array(poCategoryLineSchema).optional(),
  itemLines: z.array(poItemLineSchema).optional(),
});

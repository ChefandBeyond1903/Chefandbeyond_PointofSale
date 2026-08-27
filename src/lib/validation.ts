import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().trim().max(64).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  description: z.string().trim().max(1000).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0).default(0),
  taxRateBps: z.number().int().min(0).max(100000).default(0),
  trackStock: z.boolean().default(true),
  stock: z.number().int().default(0),
  categoryId: z.string().trim().min(1).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  active: z.boolean().default(true),
});

export const productUpdateSchema = productCreateSchema.partial();

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const saleItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(9999),
  discountCents: z.number().int().min(0).default(0),
});

export const saleCreateSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  orderDiscountCents: z.number().int().min(0).default(0),
  paymentMethod: z.enum(["CASH", "CARD"]),
  tenderedCents: z.number().int().min(0).default(0),
  note: z.string().trim().max(500).optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
});

export const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  role: z.enum(["MANAGER", "CASHIER"]),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(["MANAGER", "CASHIER"]).optional(),
  active: z.boolean().optional(),
});

export const shiftOpenSchema = z.object({
  openingFloatCents: z.number().int().min(0).default(0),
});

export const shiftCloseSchema = z.object({
  closingCountCents: z.number().int().min(0),
});

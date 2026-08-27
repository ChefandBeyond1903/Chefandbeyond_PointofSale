// Shared shapes for API responses used by client components.

export type Role = "MANAGER" | "CASHIER";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  createdAt?: string;
  _count?: { products: number };
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  priceCents: number;
  costCents: number;
  taxRateBps: number;
  trackStock: boolean;
  stock: number;
  active: boolean;
  favorite: boolean;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  taxRateBps: number;
  lineTotalCents: number;
}

export interface Sale {
  id: string;
  number: number;
  status: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: "CASH" | "CARD";
  tenderedCents: number;
  changeCents: number;
  note: string | null;
  createdAt: string;
  cashier?: { id: string; name: string };
  items: SaleItem[];
}

export interface Shift {
  id: string;
  openingFloatCents: number;
  closingCountCents: number | null;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
}

export interface ShiftStats {
  saleCount: number;
  totalCents: number;
  cashSalesCents: number;
  expectedDrawerCents: number;
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  _count?: { sales: number };
}

export interface ReportSummary {
  range: { from: string; to: string };
  totals: {
    saleCount: number;
    grossCents: number;
    subtotalCents: number;
    taxCents: number;
    discountCents: number;
    itemsSold: number;
    averageSaleCents: number;
  };
  byPaymentMethod: { method: string; count: number; totalCents: number }[];
  topProducts: { productId: string; name: string; quantity: number; revenueCents: number }[];
  recentSales: {
    id: string;
    number: number;
    createdAt: string;
    cashier: string;
    paymentMethod: string;
    itemCount: number;
    totalCents: number;
  }[];
}

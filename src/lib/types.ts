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

export interface Vendor {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  createdAt?: string;
  productCount?: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  company: string;
  notes: string;
  createdAt?: string;
  _count?: { sales: number };
  sales?: { id: string; number: number; totalCents: number; createdAt: string }[];
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
  vendor: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  skuSnapshot: string;
  vendorSnapshot: string;
  unitPriceCents: number;
  unitCostCents: number;
  quantity: number;
  discountCents: number;
  taxRateBps: number;
  lineTotalCents: number;
}

export type PurchaseOrderStatus = "OPEN" | "CLOSED" | "SENT" | "RECEIVED" | "CANCELLED";

export interface PurchaseOrderItem {
  id: string;
  productId: string | null;
  nameSnapshot: string;
  skuSnapshot: string;
  description: string;
  quantity: number;
  unitCostCents: number;
  lineCostCents: number;
  customerProject: string;
  klass: string;
  sortOrder: number;
}

export interface PurchaseOrderCategoryLine {
  id: string;
  category: string;
  description: string;
  amountCents: number;
  customerProject: string;
  klass: string;
  sortOrder: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendor: string;
  status: PurchaseOrderStatus;
  subtotalCents: number;
  note: string | null;

  email: string;
  ccBcc: string;
  mailingAddress: string;
  shipTo: string;
  shippingAddress: string;
  poDate: string;
  dueDate: string | null;
  shipVia: string;
  storeName: string;
  permitNumber: string;
  messageToCustomer: string;
  poRef: string;
  salesRep: string;
  mobileNumber: string;
  tags: string; // JSON array string
  messageToVendor: string;
  memo: string;

  saleId: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string };
  sale?: { id: string; number: number; createdAt?: string } | null;
  items?: PurchaseOrderItem[];
  categoryLines?: PurchaseOrderCategoryLine[];
  _count?: { items: number };
}

/** One vendor's slice of an invoice, ready to become a PO. */
export interface InvoiceVendor {
  vendor: string;
  quantity: number;
  costCents: number;
  letter: string;
  poNumber: string;
  hasPo: boolean;
}

export interface InvoiceDetail {
  sale: Sale & { purchaseOrders: PurchaseOrder[] };
  vendors: InvoiceVendor[];
  unassignedQty: number;
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
  customer?: { id: string; name: string } | Customer | null;
  customerId?: string | null;
  customerNameSnapshot?: string;
  customerEmailSnapshot?: string;
  customerPhoneSnapshot?: string;
  customerAddressSnapshot?: string;
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
    customer: string;
    paymentMethod: string;
    itemCount: number;
    totalCents: number;
  }[];
}

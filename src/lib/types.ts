// Shared shapes for API responses used by client components.

export type Role = "CASHIER" | "MANAGER" | "ADMIN";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storeId?: string | null;
  storeName?: string | null;
  storeTaxRateBps?: number | null;
}

export interface Store {
  id: string;
  name: string;
  taxRateBps: number;
  address: string;
  phone: string;
  email: string;
  active: boolean;
  createdAt?: string;
  _count?: { users: number; sales: number };
}

export interface Company {
  name: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  website: string;
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
  freightMinimumCents: number;
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
  /** Omitted by the product list endpoint unless it's called with detail=1. */
  description?: string | null;
  priceCents: number;
  costCents: number;
  umrpCents: number;
  trackStock: boolean;
  /** On-hand at the requesting user's store (total across stores for an admin). */
  stock: number;
  active: boolean;
  favorite: boolean;
  vendor: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryRow {
  productId: string;
  name: string;
  sku: string;
  vendor: string;
  trackStock: boolean;
  active: boolean;
  byStore: Record<string, number>; // storeId -> quantity
  total: number;
}

export interface InventorySnapshot {
  stores: { id: string; name: string; active: boolean }[];
  rows: InventoryRow[];
  /** Store the caller may adjust ("" / null = admin, any store). */
  editableStoreId: string | null;
  canAdjust: boolean;
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

export type PurchaseOrderStatus =
  | "OPEN"
  | "CLOSED"
  | "SENT"
  | "PARTIAL"
  | "RECEIVED"
  | "CANCELLED";

export interface PurchaseOrderItem {
  id: string;
  productId: string | null;
  nameSnapshot: string;
  skuSnapshot: string;
  description: string;
  quantity: number;
  receivedQuantity: number;
  unitCostCents: number;
  lineCostCents: number;
  customerProject: string;
  klass: string;
  sortOrder: number;
}

export type BillStatus = "OPEN" | "PAID";

export interface BillItem {
  id: string;
  poItemId: string | null;
  productId: string | null;
  nameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitCostCents: number;
  lineCostCents: number;
}

export interface Bill {
  id: string;
  billNumber: string;
  vendor: string;
  billDate: string;
  dueDate: string | null;
  terms: string;
  memo: string;
  status: BillStatus;
  paidAt: string | null;
  subtotalCents: number;
  storeId: string | null;
  poId: string | null;
  createdAt: string;
  po?: { id: string; poNumber: string } | null;
  store?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  items?: BillItem[];
  _count?: { items: number };
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
  shippingCents: number;
  note: string | null;
  storeId?: string | null;

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
  listSubtotalCents: number;
  discountCents: number;
  taxCents: number;
  taxRateBps: number;
  totalCents: number;
  paymentMethod: "CASH" | "CARD";
  tenderedCents: number;
  changeCents: number;
  note: string | null;
  createdAt: string;
  storeId?: string | null;
  storeNameSnapshot?: string;
  storeAddressSnapshot?: string;
  storePhoneSnapshot?: string;
  storeEmailSnapshot?: string;
  cashier?: { id: string; name: string };
  salespersonId?: string | null;
  salesperson?: { id: string; name: string } | null;
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
  storeId: string | null;
  store?: { id: string; name: string; taxRateBps: number } | null;
  createdById?: string | null;
  createdBy?: { id: string; name: string } | null;
  _count?: { sales: number };
  /** Whether the requesting user is allowed to edit this row. */
  editable?: boolean;
}

export interface ProfitRow {
  key: string;
  label: string;
  saleCount: number;
  netCents: number; // ex-tax revenue after discounts
  costCents: number;
  profitCents: number;
  marginPct: number;
}

export interface ReportSummary {
  range: { from: string; to: string };
  scope: { allStores: boolean; storeId: string | null; storeName: string | null };
  stores: { id: string; name: string }[];
  /** Cashier view: money figures stripped, only top products + invoices. */
  limited: boolean;
  totals: {
    saleCount: number;
    grossCents: number;
    subtotalCents: number;
    taxCents: number;
    discountCents: number;
    costCents: number;
    profitCents: number;
    marginPct: number;
    itemsSold: number;
    averageSaleCents: number;
  };
  byStore: ProfitRow[];
  byStaff: ProfitRow[];
  byPaymentMethod: { method: string; count: number; totalCents: number }[];
  topProducts: { productId: string; name: string; quantity: number; revenueCents: number }[];
  recentSales: {
    id: string;
    number: number;
    createdAt: string;
    cashier: string;
    salesperson: string;
    store: string;
    customer: string;
    paymentMethod: string;
    itemCount: number;
    totalCents: number;
    profitCents: number;
  }[];
}

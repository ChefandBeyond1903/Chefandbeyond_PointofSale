"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { MoneyInput } from "@/components/MoneyInput";
import type { Customer, PurchaseOrder, PurchaseOrderStatus, Store, Vendor } from "@/lib/types";

const STATUSES: PurchaseOrderStatus[] = ["OPEN", "CLOSED", "SENT", "RECEIVED", "CANCELLED"];

type ItemRow = {
  key: string;
  productId: string | null;
  productService: string;
  sku: string;
  description: string;
  quantity: number;
  rateCents: number;
  customerProject: string;
  klass: string;
};

type ProductLite = {
  id: string;
  name: string;
  sku: string;
  costCents: number;
  description: string | null;
  vendor: string;
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

const blankItem = (): ItemRow => ({
  key: uid(),
  productId: null,
  productService: "",
  sku: "",
  description: "",
  quantity: 0,
  rateCents: 0,
  customerProject: "",
  klass: "",
});

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultPoNumber() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `CB-${mm}${dd}${String(d.getFullYear()).slice(-2)}`;
}

function toDateInput(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function PurchaseOrderForm({ id, readOnly = false }: { id?: string; readOnly?: boolean }) {
  const router = useRouter();
  const isEdit = !!id;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- form state ----
  const [vendor, setVendor] = useState("");
  const [status, setStatus] = useState<PurchaseOrderStatus>("OPEN");
  const [poNumber, setPoNumber] = useState(defaultPoNumber());
  const [email, setEmail] = useState("");
  const [ccBcc, setCcBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [mailingAddress, setMailingAddress] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [poDate, setPoDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [shipVia, setShipVia] = useState("");
  const [storeName, setStoreName] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [messageToVendor, setMessageToVendor] = useState("");
  const [memo, setMemo] = useState("");
  const [shippingCents, setShippingCents] = useState(0);
  const [itemLines, setItemLines] = useState<ItemRow[]>([blankItem(), blankItem()]);

  const [itemOpen, setItemOpen] = useState(true);

  const prevVendorRef = useRef<Vendor | null>(null);

  const applyPo = useCallback((po: PurchaseOrder) => {
    setVendor(po.vendor);
    setStatus(po.status);
    setPoNumber(po.poNumber);
    setEmail(po.email);
    setCcBcc(po.ccBcc);
    setShowCcBcc(!!po.ccBcc);
    setMailingAddress(po.mailingAddress);
    setShipTo(po.shipTo);
    setShippingAddress(po.shippingAddress);
    setPoDate(toDateInput(po.poDate) || todayISO());
    setDueDate(toDateInput(po.dueDate));
    setShipVia(po.shipVia);
    setStoreName(po.storeName);
    setPermitNumber(po.permitNumber);
    setMessageToVendor(po.messageToVendor);
    setMemo(po.memo);
    setShippingCents(po.shippingCents ?? 0);
    setItemLines(
      (po.items ?? []).map((l) => ({
        key: uid(),
        productId: l.productId,
        productService: l.nameSnapshot,
        sku: l.skuSnapshot,
        description: l.description,
        quantity: l.quantity,
        rateCents: l.unitCostCents,
        customerProject: l.customerProject,
        klass: l.klass,
      })),
    );
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [v, p, s, c] = await Promise.all([
          api<{ vendors: Vendor[] }>("/api/vendors"),
          api<{ products: ProductLite[] }>("/api/products?take=5000"),
          api<{ stores: Store[] }>("/api/stores"),
          api<{ customers: Customer[] }>("/api/customers"),
        ]);
        setVendors(v.vendors);
        setProducts(p.products);
        setStores(s.stores);
        setCustomers(c.customers);
        if (isEdit) {
          const res = await api<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${id}`);
          applyPo(res.purchaseOrder);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit, applyPo]);

  // Vendor selection auto-fills mailing address / email.
  function onVendorChange(name: string) {
    setVendor(name);
    const match = vendors.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
    const prev = prevVendorRef.current;
    if (match) {
      if (!mailingAddress || (prev && mailingAddress === prev.address)) {
        setMailingAddress(match.address);
      }
      if (!email || (prev && email === prev.email)) setEmail(match.email);
    }
    prevVendorRef.current = match ?? null;
  }

  function onProductPick(rowKey: string, name: string) {
    const match = products.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    setItemLines((rows) =>
      rows.map((r) =>
        r.key !== rowKey
          ? r
          : {
              ...r,
              productService: name,
              productId: match?.id ?? null,
              sku: match ? match.sku : r.sku,
              description: match?.description ?? r.description,
              rateCents: match ? match.costCents : r.rateCents,
              quantity: r.quantity || (match ? 1 : 0),
            },
      ),
    );
  }

  const itemTotal = useMemo(
    () => itemLines.reduce((s, l) => s + Math.round(l.quantity * l.rateCents), 0),
    [itemLines],
  );
  const grandTotal = itemTotal + shippingCents;

  // Pick a store or customer for "Ship to"; fill in their address (still editable).
  function onShipToPick(name: string) {
    setShipTo(name);
    const addr =
      stores.find((s) => s.name === name)?.address ||
      customers.find((c) => c.name === name)?.address ||
      "";
    if (addr) setShippingAddress(addr);
  }

  // Free-freight minimum for the chosen vendor. Ordering below it warns only.
  const selectedVendor = useMemo(
    () => vendors.find((v) => v.name.trim().toLowerCase() === vendor.trim().toLowerCase()) ?? null,
    [vendors, vendor],
  );
  const freightMinCents = selectedVendor?.freightMinimumCents ?? 0;
  const freightShortfallCents =
    freightMinCents > 0 && grandTotal < freightMinCents ? freightMinCents - grandTotal : 0;

  function buildPayload(overrideStatus?: PurchaseOrderStatus) {
    return {
      vendor: vendor.trim(),
      status: overrideStatus ?? status,
      poNumber: poNumber.trim() || undefined,
      email,
      ccBcc: showCcBcc ? ccBcc : "",
      mailingAddress,
      shipTo,
      shippingAddress,
      poDate: poDate || undefined,
      dueDate: dueDate || null,
      shipVia,
      storeName,
      permitNumber,
      messageToVendor,
      memo,
      shippingCents,
      // These header fields and the category-line section were removed from the
      // form; send empties so a save clears any legacy values.
      messageToCustomer: "",
      poRef: "",
      salesRep: "",
      mobileNumber: "",
      tags: [],
      categoryLines: [],
      itemLines: itemLines
        .filter((l) => l.productService || l.description || l.quantity || l.rateCents)
        .map((l) => ({
          productId: l.productId,
          productService: l.productService,
          sku: l.sku,
          description: l.description,
          quantity: l.quantity,
          rateCents: l.rateCents,
          customerProject: l.customerProject,
          klass: l.klass,
        })),
    };
  }

  async function save(send: boolean) {
    if (!vendor.trim()) {
      setError("Choose a vendor.");
      return;
    }
    if (
      freightShortfallCents > 0 &&
      !confirm(
        `This order is ${formatMoney(freightShortfallCents)} below ${selectedVendor?.name ?? "this vendor"}'s ` +
          `free-freight minimum of ${formatMoney(freightMinCents)}. Freight charges may apply.\n\n` +
          `Save the purchase order anyway?`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(send ? "SENT" : undefined);
      if (isEdit) {
        await api(`/api/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/purchase-orders", { method: "POST", body: JSON.stringify(payload) });
      }
      if (send) alert("Saved and marked as SENT. (Email delivery isn't configured yet.)");
      router.push("/purchase-orders");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
      setSaving(false);
    }
  }

  function clearForm() {
    if (!confirm("Clear the form?")) return;
    if (isEdit) {
      setLoading(true);
      api<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${id}`)
        .then((r) => applyPo(r.purchaseOrder))
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }
    setVendor("");
    setStatus("OPEN");
    setPoNumber(defaultPoNumber());
    setEmail("");
    setCcBcc("");
    setMailingAddress("");
    setShipTo("");
    setShippingAddress("");
    setPoDate(todayISO());
    setDueDate("");
    setShipVia("");
    setStoreName("");
    setPermitNumber("");
    setMessageToVendor("");
    setMemo("");
    setShippingCents(0);
    setItemLines([blankItem(), blankItem()]);
  }

  if (loading) {
    return <p className="p-6 text-sm text-zinc-500">Loading…</p>;
  }

  return (
    <div className="w-full flex-1 p-4 pb-24">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {isEdit ? `Purchase order ${poNumber}` : "New purchase order"}
        </h1>
        {readOnly && (
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500">
            View only
          </span>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <fieldset disabled={readOnly} className="contents">
      {/* fieldset[disabled] makes the whole PO read-only for cashiers */}

      {/* ============ HEADER ============ */}
      <section className="card mb-4 p-4">
        <div className="grid gap-4 md:grid-cols-[2fr_1fr] md:items-start">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Vendor *</label>
                <input
                  className="input"
                  list="po-vendors"
                  placeholder="Choose a vendor"
                  value={vendor}
                  onChange={(e) => onVendorChange(e.target.value)}
                />
                <datalist id="po-vendors">
                  {vendors.map((v) => (
                    <option key={v.id} value={v.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  placeholder="Email (Separate emails with a comma)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowCcBcc((v) => !v)}
                  className="mt-1 text-xs text-indigo-600"
                >
                  {showCcBcc ? "Hide Cc/Bcc" : "Cc/Bcc"}
                </button>
              </div>
            </div>

            {showCcBcc && (
              <div>
                <label className="label">Cc / Bcc</label>
                <input
                  className="input"
                  placeholder="Cc/Bcc (comma separated)"
                  value={ccBcc}
                  onChange={(e) => setCcBcc(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <label className="label mb-0 shrink-0 whitespace-nowrap">Purchase Order status</label>
              <select
                className="input h-8 w-auto min-w-40"
                value={status}
                onChange={(e) => setStatus(e.target.value as PurchaseOrderStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Amount</p>
            <p className="text-3xl font-bold">{formatMoney(grandTotal)}</p>
          </div>
        </div>

        {freightShortfallCents > 0 && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span className="font-medium">{formatMoney(freightShortfallCents)} under</span>{" "}
            {selectedVendor?.name}&rsquo;s free-freight minimum of{" "}
            {formatMoney(freightMinCents)}. Freight charges may apply — you can still save this
            order.
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div>
            <label className="label">Mailing address</label>
            <textarea
              className="input"
              rows={4}
              value={mailingAddress}
              onChange={(e) => setMailingAddress(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Ship to</label>
            <select
              className="input mb-2"
              value={shipTo}
              onChange={(e) => onShipToPick(e.target.value)}
            >
              <option value="">Select a store or customer…</option>
              {shipTo &&
                !stores.some((s) => s.name === shipTo) &&
                !customers.some((c) => c.name === shipTo) && (
                  <option value={shipTo}>{shipTo}</option>
                )}
              {stores.length > 0 && (
                <optgroup label="Stores">
                  {stores.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {customers.length > 0 && (
                <optgroup label="Customers">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <textarea
              className="input"
              rows={3}
              placeholder="Shipping address"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Purchase Order date</label>
              <input
                type="date"
                className="input"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Due date</label>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Ship Via</label>
              <input className="input" value={shipVia} onChange={(e) => setShipVia(e.target.value)} />
            </div>
            <div>
              <label className="label">PO no.</label>
              <input
                className="input"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Store</label>
              <input
                className="input"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Permit no.</label>
              <input
                className="input"
                value={permitNumber}
                onChange={(e) => setPermitNumber(e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ============ ITEM DETAILS ============ */}
      <LineSection
        title="Item details"
        open={itemOpen}
        onToggle={() => setItemOpen((v) => !v)}
        onAdd={() => setItemLines((r) => [...r, blankItem()])}
        onClear={() => setItemLines([])}
        footer={
          <div className="ml-auto w-full max-w-xs space-y-1.5 border-t border-zinc-200 pt-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Items</span>
              <span>{formatMoney(itemTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Shipping charge</span>
              <MoneyInput
                cents={shippingCents}
                onCentsChange={setShippingCents}
                className="input h-8 w-28 text-right"
              />
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200 pt-1.5 font-semibold">
              <span>Total</span>
              <span>{formatMoney(grandTotal)}</span>
            </div>
          </div>
        }
      >
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th className="w-8 py-1.5"></th>
              <th className="w-8 py-1.5">#</th>
              <th className="py-1.5">Product/Service</th>
              <th className="w-28 py-1.5">SKU</th>
              <th className="py-1.5">Description</th>
              <th className="w-20 py-1.5 text-right">Qty</th>
              <th className="w-28 py-1.5 text-right">Rate</th>
              <th className="w-28 py-1.5 text-right">Amount</th>
              <th className="py-1.5">Customer/Project</th>
              <th className="py-1.5">Class</th>
              <th className="w-16 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {itemLines.map((row, i) => {
              const amount = Math.round(row.quantity * row.rateCents);
              return (
                <tr
                  key={row.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const from = Number(e.dataTransfer.getData("text/plain"));
                    if (!Number.isNaN(from) && from !== i) setItemLines((r) => move(r, from, i));
                  }}
                  className="border-t border-zinc-100"
                >
                  <td
                    className="cursor-grab py-1 text-center text-zinc-300"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
                    title="Drag to reorder"
                  >
                    ⠿
                  </td>
                  <td className="py-1 text-zinc-400">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <input
                      className="input h-8"
                      list="po-products"
                      value={row.productService}
                      onChange={(e) => onProductPick(row.key, e.target.value)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="input h-8"
                      value={row.sku}
                      onChange={(e) =>
                        setItemLines((r) => r.map((x) => (x.key === row.key ? { ...x, sku: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="input h-8"
                      value={row.description}
                      onChange={(e) =>
                        setItemLines((r) =>
                          r.map((x) => (x.key === row.key ? { ...x, description: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="input h-8 text-right"
                      inputMode="numeric"
                      value={row.quantity || ""}
                      onChange={(e) =>
                        setItemLines((r) =>
                          r.map((x) =>
                            x.key === row.key
                              ? { ...x, quantity: parseInt(e.target.value.replace(/[^0-9]/g, ""), 10) || 0 }
                              : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <MoneyInput
                      cents={row.rateCents}
                      onCentsChange={(c) =>
                        setItemLines((r) => r.map((x) => (x.key === row.key ? { ...x, rateCents: c } : x)))
                      }
                      className="input h-8 text-right"
                    />
                  </td>
                  <td className="py-1 pr-2 text-right font-medium">{formatMoney(amount)}</td>
                  <td className="py-1 pr-2">
                    <input
                      className="input h-8"
                      value={row.customerProject}
                      onChange={(e) =>
                        setItemLines((r) =>
                          r.map((x) => (x.key === row.key ? { ...x, customerProject: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="input h-8"
                      value={row.klass}
                      onChange={(e) =>
                        setItemLines((r) => r.map((x) => (x.key === row.key ? { ...x, klass: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <button
                      type="button"
                      title="Copy row"
                      onClick={() =>
                        setItemLines((r) => [...r.slice(0, i + 1), { ...row, key: uid() }, ...r.slice(i + 1)])
                      }
                      className="px-1 text-zinc-400 hover:text-zinc-700"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      title="Delete row"
                      onClick={() => setItemLines((r) => r.filter((x) => x.key !== row.key))}
                      className="px-1 text-zinc-400 hover:text-red-600"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="po-products">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
      </LineSection>

      {/* ============ FOOTER ============ */}
      <section className="card mt-4 grid gap-4 p-4 md:grid-cols-3">
        <div>
          <label className="label">Your message to vendor</label>
          <textarea
            className="input"
            rows={4}
            value={messageToVendor}
            onChange={(e) => setMessageToVendor(e.target.value)}
          />
        </div>
        <div className="no-print">
          <label className="label">Memo</label>
          <textarea className="input" rows={4} value={memo} onChange={(e) => setMemo(e.target.value)} />
          <p className="mt-0.5 text-[11px] text-zinc-400">Internal only — not printed</p>
        </div>
        <div>
          <label className="label">Attachments</label>
          <div className="grid place-items-center rounded-md border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-400">
            File attachments aren&apos;t enabled yet.
            <br />
            Max file size: 20 MB
          </div>
        </div>
      </section>

      <p className="mt-3 text-center text-xs text-zinc-400">Privacy</p>
      </fieldset>

      {/* ============ ACTION BAR ============ */}
      {!readOnly && (
      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur">
        <div className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5">
          <button onClick={() => router.push("/purchase-orders")} className="btn-secondary">
            Cancel
          </button>
          <button onClick={clearForm} className="btn-ghost">
            Clear
          </button>
          <div className="mx-2 flex items-center gap-4 text-sm text-zinc-500">
            <button onClick={() => window.print()} className="hover:text-zinc-800">
              Print
            </button>
            <span className="cursor-not-allowed text-zinc-300" title="Not available">
              Make recurring
            </span>
          </div>
          <span className="ml-auto mr-2 text-sm text-zinc-500">
            Total <span className="font-semibold text-zinc-900">{formatMoney(grandTotal)}</span>
          </span>
          <button onClick={() => save(false)} disabled={saving} className="btn-secondary">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={() => save(true)} disabled={saving} className="btn-primary">
            Save and send
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

function LineSection({
  title,
  open,
  onToggle,
  onAdd,
  onClear,
  footer,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onClear: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card mb-4 p-4">
      <button
        type="button"
        onClick={onToggle}
        className="mb-2 flex w-full items-center gap-2 text-left font-semibold"
      >
        <span className="text-zinc-400">{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open && (
        <>
          <div className="overflow-x-auto">{children}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onAdd} className="btn-secondary h-8 text-xs">
              Add lines
            </button>
            <button type="button" onClick={onClear} className="btn-ghost h-8 text-xs">
              Clear all lines
            </button>
          </div>
          {footer}
        </>
      )}
    </section>
  );
}

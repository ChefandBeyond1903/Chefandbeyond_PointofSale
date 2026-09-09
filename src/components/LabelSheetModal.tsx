"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { code128Svg } from "@/lib/barcode";

type LabelProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  priceCents: number;
};

const SIZES = {
  "2.25x1.25": { label: '2¼" × 1¼"', w: "2.25in", h: "1.25in", cols: 3 },
  "3x1": { label: '3" × 1"', w: "3in", h: "1in", cols: 2 },
  "4x1.33": { label: '4" × 1⅓"', w: "4in", h: "1.33in", cols: 2 },
} as const;
type SizeKey = keyof typeof SIZES;

/** Bulk barcode-label printing for a set of selected products. */
export function LabelSheetModal({
  products,
  onClose,
}: {
  products: LabelProduct[];
  onClose: () => void;
}) {
  const [size, setSize] = useState<SizeKey>("2.25x1.25");
  const [copies, setCopies] = useState(1);
  const [useSku, setUseSku] = useState(false);
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  const codeFor = (p: LabelProduct) => (useSku ? p.sku : p.barcode || p.sku);

  const labels = useMemo(() => {
    const n = Math.max(1, Math.min(50, copies || 1));
    const out: { key: string; p: LabelProduct; code: string; svg: string }[] = [];
    for (const p of products) {
      const code = codeFor(p);
      const svg = code128Svg(code);
      for (let i = 0; i < n; i++) out.push({ key: `${p.id}-${i}`, p, code, svg });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, copies, useSku]);

  const s = SIZES[size];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Print labels <span className="font-normal text-zinc-400">· {products.length} products</span>
          </h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>

        {/* Options — hidden when printing */}
        <div className="no-print mb-4 flex flex-wrap items-end gap-4 rounded-md border border-zinc-200 p-3 text-sm">
          <label>
            <span className="mb-1 block text-xs text-zinc-500">Label size</span>
            <select
              className="input h-8"
              value={size}
              onChange={(e) => setSize(e.target.value as SizeKey)}
            >
              {Object.entries(SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-zinc-500">Copies each</span>
            <input
              type="number"
              min={1}
              max={50}
              className="input h-8 w-20"
              value={copies}
              onChange={(e) => setCopies(parseInt(e.target.value, 10) || 1)}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={useSku} onChange={(e) => setUseSku(e.target.checked)} />
            Encode SKU
            <span className="text-xs text-zinc-400">(else the barcode field, falling back to SKU)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Name
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showPrice}
              onChange={(e) => setShowPrice(e.target.checked)}
            />
            Price
          </label>
          <button onClick={() => window.print()} className="btn-primary ml-auto">
            Print {labels.length} labels
          </button>
        </div>

        {/* The sheet. Print CSS isolates #label-sheet (see globals.css). */}
        <div
          id="label-sheet"
          style={
            {
              "--label-w": s.w,
              "--label-h": s.h,
              "--label-cols": String(s.cols),
            } as React.CSSProperties
          }
        >
          <div className="cbpos-labels">
            {labels.map(({ key, p, code, svg }) => (
              <div key={key} className="cbpos-label">
                {showName && <div className="cbpos-label-name">{p.name}</div>}
                <div
                  className="cbpos-label-barcode"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <div className="cbpos-label-code">{code}</div>
                {showPrice && <div className="cbpos-label-price">{formatMoney(p.priceCents)}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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

type Template = {
  key: string;
  name: string;
  w: string; // label width
  h: string; // label height
  cols: number;
  perSheet: number;
  // Sheet margins to the first label + gaps between labels. When set, the
  // grid is positioned to line up with a real Avery sheet on US Letter.
  aligned?: { top: string; left: string; gapX: string; gapY: string };
};

const TEMPLATES: Template[] = [
  {
    key: "5160",
    name: 'Avery 5160 / 8160 — 1" × 2⅝" · 30 per sheet',
    w: "2.625in",
    h: "1in",
    cols: 3,
    perSheet: 30,
    aligned: { top: "0.5in", left: "0.1875in", gapX: "0.125in", gapY: "0in" },
  },
  {
    key: "5161",
    name: 'Avery 5161 / 8161 — 1" × 4" · 20 per sheet',
    w: "4in",
    h: "1in",
    cols: 2,
    perSheet: 20,
    aligned: { top: "0.5in", left: "0.15625in", gapX: "0.1875in", gapY: "0in" },
  },
  {
    key: "5162",
    name: 'Avery 5162 / 8162 — 1⅓" × 4" · 14 per sheet',
    w: "4in",
    h: "1.333in",
    cols: 2,
    perSheet: 14,
    aligned: { top: "0.833in", left: "0.15625in", gapX: "0.1875in", gapY: "0in" },
  },
  {
    key: "5163",
    name: 'Avery 5163 / 8163 — 2" × 4" · 10 per sheet',
    w: "4in",
    h: "2in",
    cols: 2,
    perSheet: 10,
    aligned: { top: "0.5in", left: "0.15625in", gapX: "0.1875in", gapY: "0in" },
  },
  {
    key: "5164",
    name: 'Avery 5164 / 8164 — 3⅓" × 4" · 6 per sheet',
    w: "4in",
    h: "3.333in",
    cols: 2,
    perSheet: 6,
    aligned: { top: "0.5in", left: "0.15625in", gapX: "0.1875in", gapY: "0in" },
  },
  {
    key: "5167",
    name: 'Avery 5167 / 8167 — ½" × 1¾" · 80 per sheet',
    w: "1.75in",
    h: "0.5in",
    cols: 4,
    perSheet: 80,
    aligned: { top: "0.5in", left: "0.3in", gapX: "0.3in", gapY: "0in" },
  },
  {
    key: "grid-3",
    name: 'Plain grid — 2¼" × 1¼", 3-up (any inkjet/laser stock)',
    w: "2.25in",
    h: "1.25in",
    cols: 3,
    perSheet: 30,
  },
  {
    key: "grid-2",
    name: 'Plain grid — 4" × 1⅓", 2-up',
    w: "4in",
    h: "1.333in",
    cols: 2,
    perSheet: 21,
  },
];

/** Bulk barcode-label printing for a set of selected products. */
export function LabelSheetModal({
  products,
  onClose,
}: {
  products: LabelProduct[];
  onClose: () => void;
}) {
  const [templateKey, setTemplateKey] = useState("5160");
  const [copies, setCopies] = useState(1);
  const [useSku, setUseSku] = useState(false);
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);

  const t = TEMPLATES.find((x) => x.key === templateKey) ?? TEMPLATES[0];
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

  const sheetVars = {
    "--label-w": t.w,
    "--label-h": t.h,
    "--label-cols": String(t.cols),
    "--sheet-top": t.aligned?.top ?? "0.2in",
    "--sheet-left": t.aligned?.left ?? "0",
    "--gap-x": t.aligned?.gapX ?? "0.1in",
    "--gap-y": t.aligned?.gapY ?? "0.1in",
  } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Print labels{" "}
            <span className="font-normal text-zinc-400">· {products.length} products</span>
          </h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>

        {/* Options — hidden when printing */}
        <div className="no-print mb-4 space-y-3 rounded-md border border-zinc-200 p-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Label template</span>
            <select
              className="input h-8"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
            >
              {TEMPLATES.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-4">
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
              Encode SKU{" "}
              <span className="text-xs text-zinc-400">(else the barcode field, then SKU)</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showName}
                onChange={(e) => setShowName(e.target.checked)}
              />
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
          {t.aligned ? (
            <p className="text-[11px] text-zinc-400">
              Print at 100% scale (no &ldquo;fit to page&rdquo;) on US Letter so the labels line up
              with the sheet. {t.perSheet} labels per sheet.
            </p>
          ) : (
            <p className="text-[11px] text-zinc-400">
              Generic grid — trims to whatever paper/label stock you feed the printer.
            </p>
          )}
        </div>

        {/* The sheet. Print CSS isolates #label-sheet (see globals.css). */}
        <div className="overflow-x-auto">
          <div id="label-sheet" style={sheetVars}>
            <div className={`cbpos-labels ${t.aligned ? "cbpos-labels-aligned" : ""}`}>
              {labels.map(({ key, p, code, svg }) => (
                <div key={key} className="cbpos-label">
                  {showName && <div className="cbpos-label-name">{p.name}</div>}
                  <div
                    className="cbpos-label-barcode"
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                  <div className="cbpos-label-code">{code}</div>
                  {showPrice && (
                    <div className="cbpos-label-price">{formatMoney(p.priceCents)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { taxOn } from "@/lib/money";

export interface PricedInput {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineDiscountCents: number;
}

export interface ComputedLine {
  productId: string;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number; // line discount + this line's share of the order discount
  taxRateBps: number;
  lineTotalCents: number; // net + tax
}

export interface ComputedSale {
  lines: ComputedLine[];
  subtotalCents: number; // sum of unitPrice * qty, before any discount
  discountCents: number; // total discounts (line + order)
  taxRateBps: number; // the store rate applied to every line
  taxCents: number;
  totalCents: number; // subtotal - discount + tax
}

/**
 * Authoritative money math for a sale. A single tax rate (the cashier's store
 * rate, in basis points) is charged on every line. The order-level discount is
 * spread across lines in proportion to each line's post-line-discount amount,
 * so tax is charged on what the customer actually pays.
 */
export function computeSale(
  inputs: PricedInput[],
  orderDiscountCents: number,
  taxRateBps: number,
): ComputedSale {
  const base = inputs.map((i) => i.unitPriceCents * i.quantity);
  const subtotalCents = base.reduce((a, b) => a + b, 0);

  const lineDiscount = inputs.map((i, idx) => clamp(i.lineDiscountCents, 0, base[idx]));
  const afterLine = base.map((b, idx) => b - lineDiscount[idx]);
  const sumAfterLine = afterLine.reduce((a, b) => a + b, 0);

  const orderDiscount = clamp(orderDiscountCents, 0, sumAfterLine);

  // Proportional allocation of the order discount, remainder on the last line.
  const orderShare = new Array(inputs.length).fill(0) as number[];
  if (orderDiscount > 0 && sumAfterLine > 0) {
    let allocated = 0;
    for (let i = 0; i < inputs.length; i++) {
      if (i === inputs.length - 1) {
        orderShare[i] = orderDiscount - allocated;
      } else {
        const share = Math.round((orderDiscount * afterLine[i]) / sumAfterLine);
        orderShare[i] = share;
        allocated += share;
      }
    }
  }

  const lines: ComputedLine[] = inputs.map((input, idx) => {
    const net = afterLine[idx] - orderShare[idx];
    const tax = taxOn(net, taxRateBps);
    return {
      productId: input.productId,
      nameSnapshot: input.name,
      unitPriceCents: input.unitPriceCents,
      quantity: input.quantity,
      discountCents: lineDiscount[idx] + orderShare[idx],
      taxRateBps,
      lineTotalCents: net + tax,
    };
  });

  const discountCents = lineDiscount.reduce((a, b) => a + b, 0) + orderDiscount;
  const taxCents = lines.reduce((sum, _l, idx) => {
    const net = afterLine[idx] - orderShare[idx];
    return sum + taxOn(net, taxRateBps);
  }, 0);
  const totalCents = subtotalCents - discountCents + taxCents;

  return { lines, subtotalCents, discountCents, taxRateBps, taxCents, totalCents };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// All money is integer cents. Never floats -- 0.1 + 0.2 problems show up on
// invoices as off-by-a-penny totals that shop owners do not forgive.

export type TotalsInput = {
  jobs: {
    approved: boolean;
    lineItems: { qty: number; priceCents: number; taxable: boolean }[];
  }[];
  discountPct: number;
  taxRate: number; // percent, e.g. 6.75
};

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

export function lineTotalCents(qty: number, priceCents: number): number {
  // qty can be fractional (1.5 hours of labor); the result cannot.
  return Math.round(qty * priceCents);
}

/**
 * Declined jobs contribute nothing. A customer who approves the brakes and
 * declines the struts pays for brakes only, and the invoice must say so.
 */
export function computeTotals({ jobs, discountPct, taxRate }: TotalsInput): Totals {
  let subtotalCents = 0;
  let taxableCents = 0;

  for (const job of jobs) {
    if (!job.approved) continue;
    for (const item of job.lineItems) {
      const line = lineTotalCents(item.qty, item.priceCents);
      subtotalCents += line;
      if (item.taxable) taxableCents += line;
    }
  }

  const discountCents = Math.round(subtotalCents * (discountPct / 100));

  // The discount comes off the taxable base proportionally, so a 10% discount
  // reduces tax by 10% too. Taxing the pre-discount amount overcharges.
  const taxableAfterDiscount =
    subtotalCents === 0
      ? 0
      : taxableCents - Math.round(taxableCents * (discountPct / 100));

  const taxCents = Math.round(taxableAfterDiscount * (taxRate / 100));
  const totalCents = subtotalCents - discountCents + taxCents;

  return { subtotalCents, discountCents, taxCents, totalCents };
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function parseDollarsToCents(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  return Math.round(Number.parseFloat(cleaned) * 100);
}

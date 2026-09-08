import { describe, expect, it } from "vitest";
import { computeTotals, lineTotalCents, formatCents, parseDollarsToCents } from "@/lib/money";

const job = (lineItems: { qty: number; priceCents: number; taxable: boolean }[], approved = true) => ({ approved, lineItems });

describe("lineTotalCents", () => {
  it("rounds fractional labour hours to whole cents", () => {
    // 1.5 hours at $125.00 = $187.50, not $187.00.
    expect(lineTotalCents(1.5, 12_500)).toBe(18_750);
  });

  it("never emits fractional cents", () => {
    // 0.33 x $99.99 = $32.9967
    expect(lineTotalCents(0.33, 9_999)).toBe(3_300);
    expect(Number.isInteger(lineTotalCents(0.33, 9_999))).toBe(true);
  });
});

describe("computeTotals", () => {
  it("sums parts and labour and taxes only what is taxable", () => {
    const t = computeTotals({
      jobs: [
        job([
          { qty: 1, priceCents: 8_900, taxable: true }, // pads
          { qty: 2, priceCents: 6_800, taxable: true }, // rotors
          { qty: 1.5, priceCents: 12_500, taxable: true }, // labour
          { qty: 1, priceCents: 1_500, taxable: false }, // shop supplies
        ]),
      ],
      discountPct: 0,
      taxRate: 7.75,
    });
    expect(t.subtotalCents).toBe(42_750);
    // 7.75% of the $412.50 taxable portion, not of $427.50.
    expect(t.taxCents).toBe(3_197);
    expect(t.totalCents).toBe(45_947);
  });

  it("excludes declined work entirely", () => {
    const withDeclined = computeTotals({
      jobs: [
        job([{ qty: 1, priceCents: 10_000, taxable: true }]),
        job([{ qty: 1, priceCents: 60_000, taxable: true }], false), // declined
      ],
      discountPct: 0,
      taxRate: 10,
    });
    expect(withDeclined.subtotalCents).toBe(10_000);
    expect(withDeclined.taxCents).toBe(1_000);
  });

  it("reduces tax proportionally with the discount", () => {
    // Taxing the pre-discount amount would overcharge the customer.
    const t = computeTotals({
      jobs: [job([{ qty: 1, priceCents: 100_000, taxable: true }])],
      discountPct: 10,
      taxRate: 10,
    });
    expect(t.discountCents).toBe(10_000);
    expect(t.taxCents).toBe(9_000); // 10% of $900, not of $1000
    expect(t.totalCents).toBe(99_000);
  });

  it("returns zeroes for an empty document rather than NaN", () => {
    const t = computeTotals({ jobs: [], discountPct: 10, taxRate: 7.75 });
    expect(t).toEqual({ subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 });
  });
});

describe("formatting", () => {
  it("formats and parses round-trip", () => {
    expect(formatCents(45_947)).toBe("$459.47");
    expect(formatCents(-500)).toBe("-$5.00");
    expect(formatCents(100_000_00)).toBe("$100,000.00");
    expect(parseDollarsToCents("$1,234.56")).toBe(123_456);
    expect(parseDollarsToCents("")).toBe(0);
  });
});

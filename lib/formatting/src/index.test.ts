import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIndianNumberFormats,
  formatCount,
  formatMoney,
  formatMoneyWhole,
} from "./index.ts";

test("formats rupees with Indian digit grouping", () => {
  assert.equal(formatMoney(100000), "₹1,00,000.00");
  assert.equal(formatMoney(13592000), "₹1,35,92,000.00");
  assert.equal(formatMoney(1352320560.2), "₹1,35,23,20,560.20");
  assert.equal(formatMoney(-1080007.94), "₹-10,80,007.94");
  assert.equal(formatMoney(0), "₹0.00");
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(undefined), "—");
});

test("supports whole rupees and grouped counts without changing the value", () => {
  assert.equal(formatMoneyWhole(13592000), "₹1,35,92,000");
  assert.equal(formatCount(100000), "1,00,000");
  assert.equal(formatCount(2026), "2,026");
});

test("formats worksheet cells without converting numbers to text", () => {
  const worksheet: Record<string, unknown> = {
    "!ref": "A1:C3",
    A1: { v: "MRP" },
    A2: { v: 13592000 },
    B1: { v: "Count" },
    B2: { v: 100000 },
    C1: { v: "Total" },
    C2: { f: "SUM(A2:B2)", v: 13692000 },
  };
  applyIndianNumberFormats(worksheet, { moneyColumns: [0], countColumns: [1] });
  assert.equal((worksheet.A2 as { v: unknown }).v, 13592000);
  assert.equal((worksheet.A2 as { z?: string }).z, "[$₹-en-IN]##,##,##0.00");
  assert.equal((worksheet.B2 as { v: unknown }).v, 100000);
  assert.equal((worksheet.B2 as { z?: string }).z, "##,##,##0");
  assert.equal((worksheet.C2 as { f?: string }).f, "SUM(A2:B2)");
  assert.equal((worksheet.C2 as { v?: unknown }).v, 13692000);
});
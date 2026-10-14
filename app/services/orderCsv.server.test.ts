import { describe, expect, it } from "vitest";
import { orderToCsv } from "./orderCsv.server";

const rows = (csv: string) => csv.trimEnd().split("\r\n");

describe("orderToCsv", () => {
  it("writes one row per line item under a header", () => {
    const csv = orderToCsv({
      id: 1,
      name: "#1001",
      line_items: [
        { sku: "A", title: "First", quantity: 1, price: "5.00" },
        { sku: "B", title: "Second", quantity: 2, price: "7.50" },
      ],
    });
    const lines = rows(csv);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("A,First,1,5.00");
    expect(lines[2]).toContain("B,Second,2,7.50");
  });

  it("still emits a row when there are no line items", () => {
    expect(rows(orderToCsv({ id: 1 }))).toHaveLength(2);
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = orderToCsv({
      id: 1,
      line_items: [{ title: 'Say "hi", ok\nbye' }],
    });
    expect(csv).toContain('"Say ""hi"", ok\nbye"');
  });

  it("neutralises spreadsheet formulas", () => {
    const csv = orderToCsv({
      id: 1,
      email: "=cmd|x",
      line_items: [{ title: "@SUM(1)" }, { title: "+SUM(1)" }],
    });
    expect(csv).toContain("'=cmd|x");
    expect(csv).toContain("'@SUM(1)");
    expect(csv).toContain("'+SUM(1)");
  });

  it("keeps phone numbers and negative-free numerics intact", () => {
    const csv = orderToCsv({
      id: 1,
      shipping_address: { phone: "+1 (234) 577-8899" },
    });
    expect(csv).toContain(",+1 (234) 577-8899,");
  });
});

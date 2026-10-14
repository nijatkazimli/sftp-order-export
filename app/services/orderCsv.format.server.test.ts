import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_SPEC,
  orderToCsv,
  parseColumnSpec,
  renderFilename,
  validateFilenameTemplate,
} from "./orderCsv.server";

const order = {
  id: 7571352387842,
  name: "#1001",
  created_at: "2026-10-14T13:02:28-04:00",
  email: "a@example.com",
  line_items: [{ sku: "SKU1", title: "Wax", quantity: 2, price: "5.00" }],
};

describe("parseColumnSpec", () => {
  it("treats blank input as all columns", () => {
    const result = parseColumnSpec("  ");
    expect("columns" in result && result.columns.length).toBe(
      DEFAULT_COLUMN_SPEC.split("\n").length,
    );
  });

  it("keeps order and supports renaming", () => {
    expect(parseColumnSpec("sku:Item Code\norder_name\r\nquantity")).toEqual({
      columns: [
        { key: "sku", header: "Item Code" },
        { key: "order_name", header: "order_name" },
        { key: "quantity", header: "quantity" },
      ],
    });
  });

  it("rejects unknown columns", () => {
    expect(parseColumnSpec("sku\nnope")).toEqual({
      error: 'Unknown column "nope"',
    });
  });

  it("rejects inherited object keys", () => {
    expect(parseColumnSpec("constructor")).toHaveProperty("error");
  });
});

describe("orderToCsv with columns", () => {
  it("emits only the selected columns with custom headers", () => {
    const parsed = parseColumnSpec("order_name:Order\nsku:Item Code\nquantity");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(orderToCsv(order, parsed.columns)).toBe(
      "Order,Item Code,quantity\r\n#1001,SKU1,2\r\n",
    );
  });
});

describe("validateFilenameTemplate", () => {
  it.each(["order-{order}.csv", "{order_id}_{datetime}.csv"])(
    "accepts %s",
    (template) => expect(validateFilenameTemplate(template)).toBeNull(),
  );

  it("requires a per-order placeholder", () => {
    expect(validateFilenameTemplate("orders-{date}.csv")).toMatch(/must include/);
  });

  it("rejects unknown placeholders", () => {
    expect(validateFilenameTemplate("{order}-{shop}.csv")).toMatch(/Unknown/);
  });

  it("reads the innermost placeholder when braces are nested", () => {
    expect(validateFilenameTemplate("{{order}}.csv")).toBeNull();
    expect(validateFilenameTemplate("{{shop}}-{order}.csv")).toMatch(/Unknown/);
  });

  it("handles many unclosed braces quickly", () => {
    const start = performance.now();
    expect(validateFilenameTemplate("{".repeat(100))).toMatch(/must include/);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("renderFilename", () => {
  it("fills placeholders and strips the # from order names", () => {
    expect(renderFilename("order-{order}.csv", order)).toBe("order-1001.csv");
    expect(renderFilename("{date}_{order_id}.csv", order)).toBe(
      "20261014_7571352387842.csv",
    );
    expect(renderFilename("{datetime}-{order}.csv", order)).toBe(
      "20261014130228-1001.csv",
    );
  });

  it("adds .csv when missing", () => {
    expect(renderFilename("po-{order}", order)).toBe("po-1001.csv");
  });

  it("neutralises path traversal and hidden-file names", () => {
    expect(renderFilename("../../{order}.csv", order)).toBe("_.._1001.csv");
    expect(renderFilename(".{order}.csv", order)).toBe("1001.csv");
  });
});

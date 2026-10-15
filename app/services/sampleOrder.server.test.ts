import { describe, expect, it } from "vitest";
import { COLUMN_KEYS, orderToCsv, parseColumnSpec, renderFilename } from "./orderCsv.server";
import { sampleOrder } from "./sampleOrder.server";

describe("sampleOrder", () => {
  it("fills every available column, so no preview column is blank", () => {
    const columns = parseColumnSpec(COLUMN_KEYS.join("\n"));
    if ("error" in columns) throw new Error(columns.error);
    const [header, ...rows] = orderToCsv(sampleOrder(), columns.columns).trimEnd().split("\r\n");

    expect(header.split(",")).toEqual(COLUMN_KEYS);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Quoted cells (note, tags) contain commas, so check cells by pattern instead of splitting.
      expect(row).not.toMatch(/(^|,),|,$/);
    }
  });

  it("is obviously fake and produces a recognisable test file name", () => {
    const order = sampleOrder(new Date("2030-01-15T10:30:00Z"));
    expect(order.email).toMatch(/@example\.com$/);
    expect(order.name).toBe("#TEST");
    expect(renderFilename("order-{order}.csv", order)).toBe("order-TEST.csv");
    expect(renderFilename("{date}-{order}.csv", order)).toBe("20300115-TEST.csv");
  });
});

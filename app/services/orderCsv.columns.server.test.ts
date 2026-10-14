import { describe, expect, it } from "vitest";
import {
  COLUMN_KEYS,
  DEFAULT_COLUMN_KEYS,
  orderToCsv,
  parseColumnSpec,
  type ShopifyOrderPayload,
} from "./orderCsv.server";

const ORIGINAL_COLUMNS = [
  "order_id",
  "order_name",
  "created_at",
  "email",
  "currency",
  "total_price",
  "financial_status",
  "ship_name",
  "ship_address1",
  "ship_address2",
  "ship_city",
  "ship_province",
  "ship_zip",
  "ship_country",
  "ship_phone",
  "sku",
  "item_title",
  "quantity",
  "unit_price",
];

const order: ShopifyOrderPayload = {
  id: 1,
  name: "#1001",
  phone: "+10000000",
  subtotal_price: "40.00",
  total_tax: "3.20",
  total_discounts: "5.00",
  total_shipping_price_set: { shop_money: { amount: "4.95" } },
  shipping_lines: [{ title: "Standard" }],
  discount_codes: [{ code: "SAVE5" }, { code: "VIP" }],
  payment_gateway_names: ["shopify_payments"],
  fulfillment_status: null,
  note: "Leave at door,\nring twice",
  tags: "wholesale, priority",
  customer: { first_name: "Ayumu", last_name: "Hirano", phone: null },
  shipping_address: { company: "ACME", province_code: "NC" },
  billing_address: {
    name: "Bill Payer",
    company: "ACME Billing",
    address1: "1 Main St",
    city: "Raleigh",
    province: "North Carolina",
    zip: "27601",
    country_code: "US",
    phone: "+1999",
  },
  line_items: [
    {
      id: 11,
      product_id: 22,
      variant_id: 33,
      variant_title: "Large",
      vendor: "Wax Co",
      total_discount: "1.00",
      grams: 250,
      requires_shipping: true,
      sku: "S1",
    },
  ],
};

function csvFor(spec: string) {
  const parsed = parseColumnSpec(spec);
  if ("error" in parsed) throw new Error(parsed.error);
  const [header, row] = orderToCsv(order, parsed.columns).trimEnd().split("\r\n");
  return { header, row };
}

describe("default columns", () => {
  it("stay exactly the original 19 so existing exports don't change shape", () => {
    expect(DEFAULT_COLUMN_KEYS).toEqual(ORIGINAL_COLUMNS);
    expect(orderToCsv({ id: 1 }).split("\r\n")[0]).toBe(
      ORIGINAL_COLUMNS.join(","),
    );
    expect(parseColumnSpec("")).toEqual({
      columns: ORIGINAL_COLUMNS.map((key) => ({ key, header: key })),
    });
  });

  it("leave the new columns available but opt-in", () => {
    const extra = COLUMN_KEYS.filter((k) => !ORIGINAL_COLUMNS.includes(k));
    expect(extra.length).toBeGreaterThan(20);
    expect(extra).toContain("subtotal_price");
    expect(extra).toContain("billing_address1");
  });
});

describe("opt-in columns", () => {
  it("reads order totals, shipping and payment details", () => {
    const { header, row } = csvFor(
      "subtotal_price\ntotal_tax\ntotal_discounts\nshipping_price\nshipping_method\ndiscount_codes\npayment_gateway\nfulfillment_status",
    );
    expect(header).toBe(
      "subtotal_price,total_tax,total_discounts,shipping_price,shipping_method,discount_codes,payment_gateway,fulfillment_status",
    );
    expect(row).toBe("40.00,3.20,5.00,4.95,Standard,SAVE5; VIP,shopify_payments,");
  });

  it("quotes notes and tags that contain commas or newlines", () => {
    const { row } = csvFor("note\ntags");
    expect(row).toBe('"Leave at door,\nring twice","wholesale, priority"');
  });

  it("builds the customer name and falls back to the order phone", () => {
    expect(csvFor("customer_name\ncustomer_phone").row).toBe(
      "Ayumu Hirano,+10000000",
    );
  });

  it("reads the billing address and shipping extras", () => {
    const { row } = csvFor(
      "billing_name\nbilling_company\nbilling_address1\nbilling_city\nbilling_province\nbilling_zip\nbilling_country\nbilling_phone\nship_company\nship_province_code",
    );
    expect(row).toBe(
      "Bill Payer,ACME Billing,1 Main St,Raleigh,North Carolina,27601,US,+1999,ACME,NC",
    );
  });

  it("reads per-item details, including booleans", () => {
    expect(
      csvFor(
        "line_item_id\nproduct_id\nvariant_id\nvariant_title\nvendor\nitem_discount\ngrams\nrequires_shipping",
      ).row,
    ).toBe("11,22,33,Large,Wax Co,1.00,250,true");
  });

  it("stays empty for orders without the optional data", () => {
    const parsed = parseColumnSpec("billing_name\ncustomer_name\nshipping_method\nnote");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(orderToCsv({ id: 2 }, parsed.columns).trimEnd().split("\r\n")[1]).toBe(
      ",,,",
    );
  });

  it("neutralises formulas in the new customer-controlled columns", () => {
    const evil: ShopifyOrderPayload = {
      id: 3,
      note: "=HYPERLINK(1)",
      tags: "@x",
      customer: { first_name: "+cmd", last_name: "x" },
    };
    const parsed = parseColumnSpec("note\ntags\ncustomer_name");
    if ("error" in parsed) throw new Error(parsed.error);
    expect(orderToCsv(evil, parsed.columns).trimEnd().split("\r\n")[1]).toBe(
      "'=HYPERLINK(1),'@x,'+cmd x",
    );
  });
});

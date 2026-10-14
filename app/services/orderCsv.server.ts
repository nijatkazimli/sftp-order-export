interface OrderLineItem {
  id?: number;
  sku?: string | null;
  title?: string | null;
  variant_title?: string | null;
  vendor?: string | null;
  product_id?: number | null;
  variant_id?: number | null;
  quantity?: number;
  price?: string;
  total_discount?: string;
  grams?: number;
  requires_shipping?: boolean;
}

interface OrderAddress {
  name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country_code?: string | null;
  phone?: string | null;
}

// Subset of the orders/create webhook payload.
export interface ShopifyOrderPayload {
  id: number;
  name?: string;
  created_at?: string;
  email?: string | null;
  phone?: string | null;
  currency?: string;
  total_price?: string;
  subtotal_price?: string;
  total_tax?: string;
  total_discounts?: string;
  total_shipping_price_set?: { shop_money?: { amount?: string } } | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  note?: string | null;
  tags?: string | null;
  payment_gateway_names?: string[];
  discount_codes?: { code?: string }[];
  shipping_lines?: { title?: string | null }[];
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
  shipping_address?: OrderAddress | null;
  billing_address?: OrderAddress | null;
  line_items?: OrderLineItem[];
}

interface Row {
  order: ShopifyOrderPayload;
  ship: OrderAddress;
  bill: OrderAddress;
  item: OrderLineItem;
}

type Cell = string | number | boolean | null | undefined;

const joined = (values: (string | null | undefined)[], separator: string) =>
  values.filter(Boolean).join(separator) || undefined;

const COLUMNS = {
  order_id: ({ order }) => order.id,
  order_name: ({ order }) => order.name,
  created_at: ({ order }) => order.created_at,
  email: ({ order }) => order.email,
  currency: ({ order }) => order.currency,
  total_price: ({ order }) => order.total_price,
  financial_status: ({ order }) => order.financial_status,
  ship_name: ({ ship }) => ship.name,
  ship_address1: ({ ship }) => ship.address1,
  ship_address2: ({ ship }) => ship.address2,
  ship_city: ({ ship }) => ship.city,
  ship_province: ({ ship }) => ship.province,
  ship_zip: ({ ship }) => ship.zip,
  ship_country: ({ ship }) => ship.country_code,
  ship_phone: ({ ship }) => ship.phone,
  sku: ({ item }) => item.sku,
  item_title: ({ item }) => item.title,
  quantity: ({ item }) => item.quantity,
  unit_price: ({ item }) => item.price,

  // Opt-in columns: not part of the default export.
  subtotal_price: ({ order }) => order.subtotal_price,
  total_tax: ({ order }) => order.total_tax,
  total_discounts: ({ order }) => order.total_discounts,
  shipping_price: ({ order }) =>
    order.total_shipping_price_set?.shop_money?.amount,
  shipping_method: ({ order }) => order.shipping_lines?.[0]?.title,
  discount_codes: ({ order }) =>
    joined(order.discount_codes?.map((d) => d.code) ?? [], "; "),
  payment_gateway: ({ order }) =>
    joined(order.payment_gateway_names ?? [], "; "),
  fulfillment_status: ({ order }) => order.fulfillment_status,
  note: ({ order }) => order.note,
  tags: ({ order }) => order.tags,
  customer_name: ({ order }) =>
    joined([order.customer?.first_name, order.customer?.last_name], " "),
  customer_phone: ({ order }) => order.customer?.phone ?? order.phone,
  ship_company: ({ ship }) => ship.company,
  ship_province_code: ({ ship }) => ship.province_code,
  billing_name: ({ bill }) => bill.name,
  billing_company: ({ bill }) => bill.company,
  billing_address1: ({ bill }) => bill.address1,
  billing_address2: ({ bill }) => bill.address2,
  billing_city: ({ bill }) => bill.city,
  billing_province: ({ bill }) => bill.province,
  billing_zip: ({ bill }) => bill.zip,
  billing_country: ({ bill }) => bill.country_code,
  billing_phone: ({ bill }) => bill.phone,
  line_item_id: ({ item }) => item.id,
  product_id: ({ item }) => item.product_id,
  variant_id: ({ item }) => item.variant_id,
  variant_title: ({ item }) => item.variant_title,
  vendor: ({ item }) => item.vendor,
  item_discount: ({ item }) => item.total_discount,
  grams: ({ item }) => item.grams,
  requires_shipping: ({ item }) => item.requires_shipping,
} satisfies Record<string, (row: Row) => Cell>;

export type ColumnKey = keyof typeof COLUMNS;
export const COLUMN_KEYS = Object.keys(COLUMNS) as ColumnKey[];

/** Used when a shop hasn't chosen columns; kept stable so existing exports never change shape. */
export const DEFAULT_COLUMN_KEYS = COLUMN_KEYS.slice(
  0,
  COLUMN_KEYS.indexOf("subtotal_price"),
);
export const DEFAULT_COLUMN_SPEC = DEFAULT_COLUMN_KEYS.join("\n");

export interface ColumnConfig {
  key: ColumnKey;
  header: string;
}

export const DEFAULT_FILENAME_TEMPLATE = "order-{order}.csv";
export const FILENAME_TOKENS = ["order", "order_id", "date", "datetime"];

const isColumnKey = (key: string): key is ColumnKey =>
  Object.hasOwn(COLUMNS, key);

/** One column per line: `key` or `key:Header`. Blank input means the default columns. */
export function parseColumnSpec(
  spec: string | null | undefined,
): { columns: ColumnConfig[] } | { error: string } {
  const columns: ColumnConfig[] = [];
  for (const line of (spec?.trim() ? spec : DEFAULT_COLUMN_SPEC).split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const sep = text.indexOf(":");
    const key = (sep === -1 ? text : text.slice(0, sep)).trim();
    const header = sep === -1 ? "" : text.slice(sep + 1).trim();
    if (!isColumnKey(key)) return { error: `Unknown column "${key}"` };
    columns.push({ key, header: header || key });
  }
  return columns.length
    ? { columns }
    : { error: "Select at least one column" };
}

export function validateFilenameTemplate(template: string): string | null {
  if (template.length > 100) return "File name is too long";
  // `[^{}]` stops at the next brace, so scanning stays linear on inputs like "{{{{{{".
  const tokens: string[] = template.match(/\{[^{}]*\}/g) ?? [];
  const unknown = tokens.find((t) => !FILENAME_TOKENS.includes(t.slice(1, -1)));
  if (unknown) return `Unknown placeholder ${unknown}`;
  // Without a per-order value every export would overwrite the same file.
  if (!tokens.includes("{order}") && !tokens.includes("{order_id}")) {
    return "File name must include {order} or {order_id}";
  }
  return null;
}

export function renderFilename(
  template: string,
  order: ShopifyOrderPayload,
): string {
  const created = order.created_at ?? new Date().toISOString();
  const values: Record<string, string> = {
    order: (order.name ?? String(order.id)).replace(/^#/, ""),
    order_id: String(order.id),
    date: created.slice(0, 10).replaceAll("-", ""),
    datetime: created.slice(0, 19).replaceAll(/\D/g, ""),
  };
  const name = template
    .replaceAll(/\{(\w+)\}/g, (_, token: string) => values[token] ?? "")
    .replaceAll(/[^\w.-]/g, "_")
    .replace(/^\.+/, "");
  return /\.csv$/i.test(name) ? name : `${name}.csv`;
}

function escapeCell(value: Cell): string {
  let text = String(value ?? "");
  // Prevent spreadsheet formula injection from customer-controlled fields.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?[\d\s().-]+$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const DEFAULT_COLUMNS: ColumnConfig[] = DEFAULT_COLUMN_KEYS.map((key) => ({
  key,
  header: key,
}));

/** One row per line item. */
export function orderToCsv(
  order: ShopifyOrderPayload,
  columns: ColumnConfig[] = DEFAULT_COLUMNS,
): string {
  const ship = order.shipping_address ?? {};
  const bill = order.billing_address ?? {};
  const items = order.line_items?.length ? order.line_items : [{}];

  const rows = items.map((item: OrderLineItem) =>
    columns
      .map(({ key }) => escapeCell(COLUMNS[key]({ order, ship, bill, item })))
      .join(","),
  );

  const header = columns.map(({ header }) => escapeCell(header)).join(",");
  return [header, ...rows].join("\r\n") + "\r\n";
}

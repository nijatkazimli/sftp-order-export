interface OrderLineItem {
  sku?: string | null;
  title?: string | null;
  quantity?: number;
  price?: string;
}

interface OrderAddress {
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
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
  currency?: string;
  total_price?: string;
  financial_status?: string | null;
  shipping_address?: OrderAddress | null;
  line_items?: OrderLineItem[];
}

interface Row {
  order: ShopifyOrderPayload;
  ship: OrderAddress;
  item: OrderLineItem;
}

type Cell = string | number | null | undefined;

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
} satisfies Record<string, (row: Row) => Cell>;

export type ColumnKey = keyof typeof COLUMNS;
export const COLUMN_KEYS = Object.keys(COLUMNS) as ColumnKey[];
export const DEFAULT_COLUMN_SPEC = COLUMN_KEYS.join("\n");

export interface ColumnConfig {
  key: ColumnKey;
  header: string;
}

export const DEFAULT_FILENAME_TEMPLATE = "order-{order}.csv";
export const FILENAME_TOKENS = ["order", "order_id", "date", "datetime"];

const isColumnKey = (key: string): key is ColumnKey =>
  Object.hasOwn(COLUMNS, key);

/** One column per line: `key` or `key:Header`. Blank input means all columns. */
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
  const tokens: string[] = template.match(/\{[^}]*\}/g) ?? [];
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

const DEFAULT_COLUMNS: ColumnConfig[] = COLUMN_KEYS.map((key) => ({
  key,
  header: key,
}));

/** One row per line item. */
export function orderToCsv(
  order: ShopifyOrderPayload,
  columns: ColumnConfig[] = DEFAULT_COLUMNS,
): string {
  const ship = order.shipping_address ?? {};
  const items = order.line_items?.length ? order.line_items : [{}];

  const rows = items.map((item: OrderLineItem) =>
    columns
      .map(({ key }) => escapeCell(COLUMNS[key]({ order, ship, item })))
      .join(","),
  );

  const header = columns.map(({ header }) => escapeCell(header)).join(",");
  return [header, ...rows].join("\r\n") + "\r\n";
}

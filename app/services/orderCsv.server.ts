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

const HEADERS = [
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

function escapeCell(value: string | number | null | undefined): string {
  let text = String(value ?? "");
  // Prevent spreadsheet formula injection from customer-controlled fields.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?[\d\s().-]+$/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One row per line item. */
export function orderToCsv(order: ShopifyOrderPayload): string {
  const ship = order.shipping_address ?? {};
  const items = order.line_items?.length ? order.line_items : [{}];

  const rows = items.map((item: OrderLineItem) =>
    [
      order.id,
      order.name,
      order.created_at,
      order.email,
      order.currency,
      order.total_price,
      order.financial_status,
      ship.name,
      ship.address1,
      ship.address2,
      ship.city,
      ship.province,
      ship.zip,
      ship.country_code,
      ship.phone,
      item.sku,
      item.title,
      item.quantity,
      item.price,
    ]
      .map(escapeCell)
      .join(","),
  );

  return [HEADERS.join(","), ...rows].join("\r\n") + "\r\n";
}

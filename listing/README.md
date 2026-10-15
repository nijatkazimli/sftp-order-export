# App Store listing

Copy and assets for the Shopify App Store listing. Character limits are Shopify's current ones; check them in the Partner Dashboard before submitting.

## Assets

- `app-icon-1200.png`: app icon, 1200 x 1200 px, square with no rounded corners (Shopify rounds it).
- Screenshots: not generated. Capture them from the embedded app in a dev store, 1600 x 900 px, no browser chrome. Use only the sample order `#TEST` or fake data; never a real shopper's details. Shots to take:
  1. Settings page with the connection section filled in (use a fake host) and "Connection verified".
  2. "Sample file" section showing the CSV preview.
  3. Column picker and file name template.
  4. "Recent exports" table with Exported, Retrying and Failed rows.
- Promo video: optional.

## Text

**App name** (30): `SFTP Order Export`

**App introduction** (100):
Send every new order to your SFTP server as a CSV file, automatically and with retries.

**Description** (500):
Warehouses, 3PLs and ERP systems often pick up orders from an SFTP folder. SFTP Order Export writes each order as a CSV file to your server as soon as it is created or paid. Choose the columns and file name, preview the file, and send a test. Failed uploads are retried for about two days, and you can see the status of every export in the app.

**Feature list** (80 each):
- Uploads each order as a CSV file to your own SFTP server
- Export when an order is created or when it is paid
- Choose, reorder and rename columns; set the file name
- Preview the file and send a test before real orders arrive
- Automatic retries and an export history

**Search terms:** SFTP, CSV export, order export, 3PL, warehouse, fulfillment, ERP

**Support:** the address in `SUPPORT_EMAIL`. Privacy policy `/privacy`, terms `/terms`.

## Claims to keep true

Do not claim more than the app does. As built:

- It exports orders only, not products, customers or inventory.
- It does not guarantee delivery or processing by the merchant's server (see the terms).
- Order contents are held only until sent (at most about two days); the history keeps order numbers and status for 90 days.
- Credentials are encrypted at rest and the server's host key is pinned on first connection.
- There is no fixed outbound IP address yet, so do not advertise IP allowlisting.

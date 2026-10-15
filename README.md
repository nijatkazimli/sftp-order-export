# SFTP Order Export

A Shopify embedded app that turns each new order into a CSV file and uploads it to the merchant's own SFTP server, for stores that work with warehouses or dropshippers that still take file drops.

## How it works

1. The merchant enters their SFTP details on the app's settings page and tests the connection.
2. Shopify sends an `orders/create` or `orders/paid` webhook (the merchant chooses which, so unpaid orders can be held back).
3. The app builds the CSV (one row per line item), names it from the merchant's file name template, stores it encrypted in a queue and replies to Shopify immediately. One export is queued per order, however many times Shopify delivers the webhook.
4. A background worker uploads the file. A failed upload is retried with increasing delays for up to 2 days, and the file is deleted as soon as it is delivered or retries run out. Each export is shown as Exported, Retrying or Failed in the "Recent exports" list.

The app keeps no copy of order data after delivery. Only the SFTP configuration and a small export history (order name, status, error) are kept.

## Features

- Password or private key authentication (optional passphrase). Secrets are encrypted at rest with AES-256-GCM.
- Test connection button that also checks the target directory exists.
- Preview of the exported file (using a made-up order) and a "Send test file" button that uploads it to the server. Sending needs an explicit confirmation, because a supplier's automation may process the file as a real order.
- Field-level validation messages on the settings form.
- Configurable file name (`{order}`, `{order_id}`, `{date}`, `{datetime}`) and CSV columns (choose, reorder and rename). The default export keeps the original 19 columns; further columns are opt-in: totals, tax, discounts, shipping price and method, discount codes, payment gateway, note, tags, customer name and phone, billing address, and per-item IDs, variant, vendor, discount, weight and shipping flag. The settings page lists every available column.
- Choose when to export: when an order is created or when it is paid.
- Queued, retried delivery: webhooks are answered at once, and uploads are retried with backoff for up to 2 days (the worker runs inside the app process and resumes after a restart).
- Export history with failure reasons, deleted automatically after 90 days.
- SSRF protection: hosts that resolve to private, loopback or link-local addresses are refused.
- Connection tests, test files and saves that probe the server are limited to 10 per minute per shop. The counter lives in the database, so it holds across restarts and several instances. Every SFTP operation (DNS, login and transfer) has an overall 60-second deadline, so a server that stalls can't tie up the worker.
- SSH host key pinning (trust on first use): the first key a server presents is remembered, and a changed key is refused until the settings are saved again. A saved password or key is only reused for the same host, port and username.
- Shopify access tokens are encrypted at rest, and credentials are bound to their shop so they can't be moved between rows.
- Mandatory Shopify compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`).

## Tech stack

React Router 7, TypeScript, Shopify Polaris web components, Prisma with PostgreSQL, `ssh2-sftp-client`, Vitest.

## Local development

Prerequisites: Node 22.12 or later, Docker, the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started), and a Shopify Partner account with a development store.

1. Install dependencies: `npm install`
2. Start Postgres:
   ```sh
   docker run -d --name sftp-export-pg --restart unless-stopped \
     -e POSTGRES_PASSWORD=<choose-a-password> -e POSTGRES_DB=sftp_export \
     -p 5432:5432 -v sftp-export-pgdata:/var/lib/postgresql/data postgres:16-alpine
   ```
3. Start a test SFTP server (user `foo`, upload directory `/upload`, port 2222):
   ```sh
   docker run -d -p 2222:22 atmoz/sftp foo:<choose-a-password>:::upload
   ```
4. Copy `.env.example` to `.env` and fill it in (see [Environment variables](#environment-variables)).
5. Run `npm run dev`. Press `p` to open the app in your development store.

In the settings page use host `localhost`, port `2222`, user `foo`, the password you chose, and target path `/upload`. Create an order in the store (mark it paid, since draft orders don't fire `orders/create`) and check `docker exec <container> ls /home/foo/upload`.

Note that `npm run dev` runs `prisma migrate deploy` against whatever `DATABASE_URL` points to.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app through the Shopify CLI with a tunnel |
| `npm test` | Run the Vitest tests. Set `TEST_DATABASE_URL` to a migrated Postgres database to also run the rate-limit SQL tests (CI does this) |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm run lint` | Run ESLint |
| `npm run build` | Production build |
| `npm run rotate-key` | Re-encrypt stored data with a new `ENCRYPTION_KEY` (see [Operations](#operations)) |
| `npx prisma migrate dev --name <name>` | Create and apply a migration locally |

### Developer scripts

Bash helpers in `scripts/`. The database scripts refuse to run unless `DATABASE_URL` points at localhost.

| Command | What it does |
|---|---|
| `npm run dev:up` | Start Colima if needed, Postgres and the test SFTP server, then apply migrations. Idempotent. Set `SFTP_TEST_PASSWORD` the first time to create the SFTP container |
| `npm run dev:down` | Stop the containers (data is kept); `scripts/dev-down.sh --colima` also stops Colima |
| `scripts/sftp.sh ls\|latest\|cat <file>\|clear` | Inspect or empty the test SFTP upload folder |
| `scripts/db.sh psql\|backup\|restore <file>\|reset` | Open psql, back up to `backups/`, restore, or drop and recreate the local database |
| `npm run check` | Typecheck, lint and test (`scripts/check.sh --build` also builds) |

### Git hooks

Tracked in `.githooks/`; install them once per clone with `npm run hooks:install` (sets a repo-local `core.hooksPath`; undo with `git config --local --unset core.hooksPath`). Each hook first runs the global hook of the same name, so company-wide checks such as the gitleaks scan still apply. Other global hooks (`commit-msg`, `post-*`) don't run in this repo while the override is active.

| Hook | Checks |
|---|---|
| `pre-commit` | Refuses `.env*` (except `.env.example`), `*.dump`, `*.sqlite` and `backups/`; requires a migration when `prisma/schema.prisma` changes and validates it (`SKIP_MIGRATION_CHECK=1` overrides); `bash -n` on staged shell scripts; ESLint on staged TypeScript |
| `pre-push` | Refuses non-fast-forward pushes to and deletion of `main` (`ALLOW_FORCE_PUSH=1` overrides); runs `scripts/check.sh` (`SKIP_PREPUSH_CHECKS=1` skips) |

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | all | PostgreSQL connection string |
| `ENCRYPTION_KEY` | all | 64 hex characters (`openssl rand -hex 32`); encrypts SFTP credentials and Shopify tokens |
| `ENCRYPTION_KEY_PREVIOUS` | during key rotation | The old key, so existing data stays readable until `npm run rotate-key` has re-encrypted it |
| `ALLOW_PRIVATE_SFTP_HOSTS` | development only | `true` allows `localhost` and private SFTP hosts; ignored when `NODE_ENV=production` |
| `LEGAL_ENTITY_NAME`, `SUPPORT_EMAIL`, `HOSTING_REGION`, `GOVERNING_LAW` | production | Operator details shown on the public `/privacy` and `/terms` pages; placeholders appear (and a warning is logged) until they are set |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | production | Provided by the Shopify CLI during development |

## Environments and protecting data

Keep development and production completely separate:

- **Separate Shopify apps.** The CLI rewrites an app's URLs on every `npm run dev`, so never develop against the production app. Create a second app for production and link it with `shopify app config link` (this creates `shopify.app.<name>.toml`).
- **Separate databases and keys.** Production uses its own database and its own `ENCRYPTION_KEY`. Never put production credentials in a local `.env`.
- **Migrations:** use `prisma migrate dev` locally and `prisma migrate deploy` in production. Never run `prisma migrate reset` or `prisma db push` against production.
- **Make schema changes additive.** Add nullable columns or columns with defaults. To remove or rename something, add the new column, deploy, and drop the old one in a later release.
- **Back up before risky migrations** (point-in-time recovery or `pg_dump`), and rehearse them on a restored copy.

## Deployment

`render.yaml` is a Render Blueprint for a Docker web service and a private Postgres database. Create a Blueprint from the repo, then set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` and `ENCRYPTION_KEY` in the dashboard. The container runs `prisma migrate deploy` on start. After the first deploy, update `application_url` and `redirect_urls` in the production `shopify.app*.toml` and run `shopify app deploy`.

Some SFTP servers only accept connections from allowlisted IP addresses. Check whether your merchants need a fixed outbound IP before choosing a host.

## Operations

Runbooks for the production database and `ENCRYPTION_KEY`. Treat the key like a password: keep it in a password manager, never in the repo, and use a different one in every environment.

### Backing up and restoring

- Turn on the database host's automatic backups (on Render, check what your Postgres plan includes) and also take your own dump before every risky migration and key rotation: `pg_dump -Fc "$DATABASE_URL" > backup.dump`.
- Dumps contain the encrypted SFTP credentials and Shopify tokens. They are only readable with the `ENCRYPTION_KEY` that was current when the dump was taken, so keep the key and the dump in different places, and keep every old key for as long as you keep dumps made under it.
- The privacy policy promises backups are kept no longer than 7 days, so delete your own dumps within that time.
- Rehearse a restore before you need one. Restore into a scratch database, never over production first: `pg_restore --clean --if-exists --no-owner -d "$SCRATCH_URL" backup.dump`, then point a local copy of the app at it with the matching key.
- Orders placed while the database was down or being restored are not exported (Shopify only retries a webhook for a limited time and there is no backfill). After a restore, compare the Orders list in Shopify admin with Recent exports for that window and re-send what is missing by hand.
- Exports still queued at the time of the dump are delivered once the restored app starts.

### Rotating ENCRYPTION_KEY

Do this on a schedule, and immediately if the key may have been exposed. The app keeps working throughout.

1. Take a backup (above) and generate a key: `openssl rand -hex 32`. Store it before you use it.
2. On the web service, set `ENCRYPTION_KEY` to the new key and `ENCRYPTION_KEY_PREVIOUS` to the old one, and redeploy. New writes use the new key; old data is still readable.
3. Run `npm run rotate-key` in a shell on the service. It re-encrypts SFTP credentials, queued export files and Shopify tokens, and prints `re-encrypted`, `already current` and `failed` counts. It is safe to re-run and to run while the app is serving traffic. Locally, export `DATABASE_URL` and both keys first; a `.env` file never overrides variables that are already set.
4. Run it again without the old key: `env -u ENCRYPTION_KEY_PREVIOUS npm run rotate-key`. It must report `failed: 0` and exit 0.
5. Remove `ENCRYPTION_KEY_PREVIOUS` from the service and redeploy. Keep the old key until you no longer keep dumps made under it.

If `failed` is not 0, the line says which row and why:

- `session ...`: the shop's token was unreadable. This only forces a re-login; delete the row or ignore it.
- `config ...`: the saved SFTP credential is unreadable. The merchant must enter it again on the settings page.
- `export job ...`: delivery of that one file will fail and show as failed in Recent exports. `changed while rotating, run again` means a write raced the script; just re-run it.

Rotating does not help if the key and a copy of the database were both stolen. In that case also tell merchants to change their SFTP passwords or keys.

If the key is lost for good, stored credentials and tokens are unrecoverable: merchants re-enter their SFTP settings and shops re-authenticate when they next open the app.

### Dependency updates

Dependabot opens weekly pull requests for npm packages, the Docker base image and GitHub Actions (`.github/dependabot.yml`). React Router, Prisma and Shopify packages are grouped so they update together. CI must pass before you merge. Also turn on Dependabot alerts and security updates in the repository's Code security settings, which a file can't do. Merging a base-image or dependency update means redeploying, so check Render has rebuilt the service afterwards.

## Data handled

The privacy policy and terms are served by the app at `/privacy` and `/terms` (use `<app url>/privacy` as the listing's privacy policy URL). They describe what the code does, so update `app/routes/privacy.tsx`, `app/routes/terms.tsx` and `LEGAL_LAST_UPDATED` in `app/legal.server.ts` whenever data handling changes, and have them reviewed by a lawyer before publishing.

Order name, email, shipping address, phone and line items are read from the webhook payload, written to the CSV and sent to the merchant's SFTP server. The finished file is held encrypted only until it is delivered (at most about 2 days if delivery keeps failing); nothing is kept afterwards. The app requires protected customer data access (name, email, phone, address) in the Partner Dashboard and only requests the `read_orders` scope.

## Project layout

| Path | Contents |
|---|---|
| `app/routes/app._index.tsx` | Settings page: loader, action, form, export history |
| `app/routes/webhooks.orders.create.tsx`, `webhooks.orders.paid.tsx` | Order webhooks; both hand off to `app/services/orderWebhook.server.ts` |
| `app/services/exportQueue.server.ts` | Queue: enqueue (one export per order), claim, deliver, retry |
| `app/services/exportWorker.server.ts` | In-process polling loop that runs due jobs |
| `app/routes/webhooks.compliance.tsx` | Mandatory compliance webhooks |
| `app/services/sftp.server.ts` | Connection test, upload, SSRF guard |
| `app/services/credentials.server.ts` | Password and private key encryption helpers |
| `app/services/orderCsv.server.ts` | CSV columns, file name templates, escaping |
| `app/utils/crypto.server.ts` | AES-256-GCM encrypt and decrypt |
| `app/services/rotateKeys.server.ts`, `scripts/rotate-key.ts` | Re-encryption after changing `ENCRYPTION_KEY` |
| `prisma/` | Schema and migrations |

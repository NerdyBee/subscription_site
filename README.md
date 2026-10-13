# Office Internet Portal

Subscription and customer-account portal for a Wi-Fi service sold to offices in a business complex.

- **Public site**: home, packages, how it works, support
- **Customer portal** (`/account`): subscription status and days remaining, buy/renew a package, pay by bank transfer and upload the receipt, receipts, Wi-Fi login, support tickets, notifications
- **Admin portal** (`/admin`): overview and revenue, confirm or reject transfers, customers (record cash/transfer payments, add free days, change plan, suspend, reset password), network access to-do list, subscriptions, invoices, packages, offices, support, settings (branding, bank accounts, WhatsApp, reminder days), staff, activity log

Stack: React + TypeScript + Vite + Tailwind (`client/`), Node + Express + TypeScript + Prisma (`server/`), MySQL (or MariaDB).

## Run locally

Needs Node 20+ and a MySQL server.

```bash
cp server/.env.example server/.env   # set DATABASE_URL, JWT secrets; uncomment CLIENT_ORIGIN; set NODE_ENV=development
npm install                          # also installs server/ and client/
npm run setup                        # applies migrations and seeds
npm run dev                          # API on :4000, site on http://localhost:5173
```

Seeding creates the first super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (in development, defaults to `admin@example.com` / `ChangeMe123!`). Change that password straight away under **Admin → My password**, then fill in **Admin → Settings** (name, complex, bank accounts, WhatsApp number) and **Admin → Packages** (prices).

## How payment works (V1)

1. The customer picks a package, which creates an invoice (e.g. `INV-000123`).
2. They transfer to the bank account shown, using the invoice number as the narration.
3. They tap **I have paid** and can attach a receipt screenshot.
4. The admin checks the bank account and taps **Confirm** under **Payments**. The subscription starts right away. If the customer renewed early, the new period is added after the current one ends.
5. Cash or direct payments can be recorded from the customer's page.

A background job runs every 10 minutes. It expires finished subscriptions and sends reminders before expiry (7/3/1 days by default, set in Settings).

## Network access

Each customer gets a Wi-Fi/hotspot username and password. In V1 the router is controlled by hand. When a payment is confirmed or a subscription expires, the account appears under **Admin → Network access → To do** ("turn ON" / "turn OFF"). After making the change on the router, the admin confirms it in the portal.

To automate this (V2), implement the `NetworkAdapter` interface in `server/src/network/adapter.ts` for the equipment in use (MikroTik RouterOS API/hotspot, RADIUS, UniFi, ...) and register it. `syncAccess()` already calls it whenever access should change.

## Deploy to shared hosting (cPanel)

Works on any cPanel host with **Setup Node.js App** (Node 20 or newer) and MySQL/MariaDB.

### 1. Build the upload package (on your computer)

```bash
npm run package
```

This produces `deploy/netportal.zip`: the compiled server, the built website, the database migrations and a runtime-only `package.json`. Nothing gets built on the host.

### 2. Create the database (cPanel → MySQL® Databases)

1. Create a database, e.g. `netportal` (cPanel prefixes it: `cpuser_netportal`).
2. Create a user with a strong password and add it to the database with **All Privileges**.

### 3. Upload the app (cPanel → File Manager)

Upload `netportal.zip` to your home folder (not inside `public_html`) and **Extract** it. You get `~/netportal/`.

### 4. Create the Node.js app (cPanel → Setup Node.js App → Create Application)

- **Node.js version**: 20 or newer
- **Application mode**: Production
- **Application root**: `netportal`
- **Application URL**: your domain or subdomain (e.g. `internet.yourdomain.com`). Use the root of a domain or subdomain, not a sub-path like `/portal`.
- **Application startup file**: `app.js`

Click **Create**, then add these **Environment variables** (or copy `.env.example` to `.env` in `~/netportal` and fill it in):

| Name | Value |
|---|---|
| `DATABASE_URL` | `mysql://cpuser_dbuser:PASSWORD@localhost:3306/cpuser_netportal` (URL-encode special characters in the password) |
| `NODE_ENV` | `production` |
| `TZ` | `Africa/Lagos` |
| `JWT_ACCESS_SECRET` | a long random string (32+ characters) |
| `JWT_REFRESH_SECRET` | a different long random string |
| `SEED_ADMIN_EMAIL` | the admin's login email |
| `SEED_ADMIN_PASSWORD` | the admin's password (8+ characters) |
| `CRON_SECRET` | another random string |

Then click **Run NPM Install**, and when it finishes, **Restart**.

On the first start the app creates its database tables, the super admin, starter packages and default settings. Open the site, log in at `/login`, and fill in **Admin → Settings** and **Admin → Packages**.

### 5. Schedule the expiry checks (cPanel → Cron Jobs)

Shared hosting stops idle apps, so add a cron job (every 10 minutes is fine) that calls the app:

```
*/10 * * * * curl -s "https://internet.yourdomain.com/api/cron?key=YOUR_CRON_SECRET" > /dev/null
```

This expires finished subscriptions, flags their Wi-Fi access for switching off, and sends expiry reminders.

### Updating

Run `npm run package` again, upload and extract the new zip over `~/netportal` (your `.env` is kept), click **Run NPM Install** if dependencies changed, then **Restart**. New database migrations are applied automatically on start.

### Backups

Everything, including uploaded payment receipts, is in the MySQL database. Back it up from cPanel → **Backup** or phpMyAdmin → **Export**.

### Troubleshooting

- **App doesn't start**: check `stderr.log` in `~/netportal` (or the log link in Setup Node.js App). A missing or wrong `DATABASE_URL` is the most common cause.
- **"No super admin yet" in the log**: set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, then restart.
- **Receipt upload fails on large files**: the host's MySQL `max_allowed_packet` may be below 5 MB. Ask the host to raise it, or customers can send smaller screenshots.

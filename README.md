# Office Internet Portal

Subscription and customer-account portal for a Wi-Fi service sold to offices in a business complex.

- **Public site**: home, packages, how it works, support
- **Customer portal** (`/account`): subscription status and days remaining, buy/renew a package, pay by bank transfer and upload the receipt, receipts, Wi-Fi login, support tickets, notifications
- **Admin portal** (`/admin`): overview and revenue, confirm or reject transfers, customers (record cash/transfer payments, add free days, change plan, suspend, reset password), network access to-do list, subscriptions, invoices, packages, offices, support, settings (branding, bank accounts, WhatsApp, reminder days), staff, activity log

Stack: React + TypeScript + Vite + Tailwind (`client/`), Node + Express + TypeScript + Prisma (`server/`), PostgreSQL.

## Run locally

```bash
cp server/.env.example server/.env   # then set DATABASE_URL and two long random JWT secrets
npm install
npm run setup                        # installs, migrates and seeds
npm run dev                          # API on :4000, site on http://localhost:5173
```

The seed creates the first super admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (default `admin@example.com` / `ChangeMe123!`). Change that password straight away under **Admin → My password**, then fill in **Admin → Settings** (name, complex, bank accounts, WhatsApp number) and **Admin → Packages** (prices).

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

## Deploy to Render

`render.yaml` is a Render Blueprint. It creates:

- **Web service `netportal`** (Frankfurt). One Node process serves the API and the built website and runs the expiry/reminder job.
- **Postgres `netportal-db`** (Frankfurt), wired to `DATABASE_URL` automatically.

Payment receipts are stored in the database, so no disk is needed.

Steps:

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In Render: **New → Blueprint**, then pick the repo.
3. When asked, enter `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (8+ characters). These become the first super admin. JWT secrets are generated for you.
4. Apply. Each deploy runs `npm run render-build`. On every start, `npm start` applies DB migrations and the idempotent seed, then starts the server.
5. Open the `.onrender.com` URL, log in at `/login`, and fill in **Admin → Settings** and **Admin → Packages**.

### Free vs paid

The Blueprint starts on **free** plans for testing:

- The free web service sleeps after about 15 minutes idle, and the next visit takes up to a minute. Expiry checks pause while it sleeps and catch up when it wakes. Customer dashboards always show the correct status regardless.
- The free database expires after a limited time. Don't keep real customers on it.

To go live, change `plan: free` to `plan: starter` for the web service and `plan: basic-256mb` for the database in `render.yaml` (or upgrade in the dashboard). Upgrading the database in place keeps its data.

Optional: add a custom domain under the web service's **Settings → Custom Domains**. Render provides HTTPS automatically.

## Production elsewhere

```bash
npm run build
NODE_ENV=production npm start   # migrates, seeds, then serves the API and the built site on PORT
```

Put it behind HTTPS (the session cookie is `secure` in production), set `CLIENT_ORIGIN` to the public URL, and back up the database (it also holds the payment receipts).

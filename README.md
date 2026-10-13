# Office Internet Portal

Subscription and customer-account portal for a Wi-Fi service sold to offices in a business complex.

- **Public site**: home, packages, how it works, support
- **Customer portal** (`/account`): subscription status and days remaining, buy/renew a package, pay by bank transfer and upload the receipt, receipts, Wi-Fi login, support tickets, notifications
- **Admin portal** (`/admin`): overview and revenue, confirm or reject transfers, customers (record cash/transfer payments, add free days, change plan, suspend, reset password), network access to-do list, subscriptions, invoices, packages, offices, support, settings (branding, bank accounts, WhatsApp, reminder days), staff, activity log

Stack: React + TypeScript + Vite + Tailwind website (`client/`, built to static files), plain PHP 8.1+ API with no Composer dependencies (`api/`), MySQL 5.7+ or MariaDB 10.3+. It runs on ordinary PHP shared hosting.

## Run locally

Needs PHP 8.1+ (with `pdo_mysql`), a MySQL server and Node 20+ (Node is only used to build the website).

```bash
cp api/config.sample.php api/config.php   # set the database, two JWT secrets, a seed admin; env => 'development'
npm install                               # also installs client/
npm run dev                               # PHP API on :8787, site on http://localhost:5173
```

The database tables, the first super admin (from `seed_admin_email` / `seed_admin_password`), starter packages and default settings are created automatically on the first request. Log in at `/login`, change the password under **Admin → My password**, then fill in **Admin → Settings** (name, complex, bank accounts, WhatsApp number) and **Admin → Packages** (prices).

`npm run lint` syntax-checks the PHP files.

## How payment works (V1)

1. The customer picks a package, which creates an invoice (e.g. `INV-000123`).
2. They transfer to the bank account shown, using the invoice number as the narration.
3. They tap **I have paid** and can attach a receipt screenshot.
4. The admin checks the bank account and taps **Confirm** under **Payments**. The subscription starts right away. If the customer renewed early, the new period is added after the current one ends.
5. Cash or direct payments can be recorded from the customer's page.

Every 10 minutes, finished subscriptions are expired and reminders are sent before expiry (7/3/1 days by default, set in Settings). A cPanel cron job triggers this; normal site traffic triggers it too as a fallback.

## Network access

Each customer gets a Wi-Fi/hotspot username and password. In V1 the router is controlled by hand. When a payment is confirmed or a subscription expires, the account appears under **Admin → Network access → To do** ("turn ON" / "turn OFF"). After making the change on the router, the admin confirms it in the portal.

To automate this (V2), implement the `NetworkAdapter` interface in `api/app/Services.php` for the equipment in use (MikroTik RouterOS API/hotspot, RADIUS, UniFi, ...) and return it from `Network::adapter()`. `Subscriptions::syncAccess()` already calls it whenever access should change.

## Deploy to PHP shared hosting (cPanel)

### 1. Build the upload package (on your computer)

```bash
npm run package
```

This produces `deploy/netportal.zip`. It contains the built website, the `api/` folder and the `.htaccess` rules. Nothing gets built on the server.

### 2. Check PHP (cPanel → Select PHP Version, or MultiPHP Manager)

Choose **PHP 8.1 or newer** for the domain and make sure the `pdo_mysql` extension is ticked. `mbstring` and `fileinfo` are recommended; they're usually on already.

### 3. Create the database (cPanel → MySQL® Databases)

1. Create a database, e.g. `netportal`. cPanel adds your account prefix: `cpuser_netportal`.
2. Create a user with a strong password.
3. Add the user to the database with **All Privileges**.

### 4. Upload (cPanel → File Manager)

1. Open the document root of the domain or subdomain the portal will live on (e.g. `public_html`, or the subdomain's folder). Use the root of a domain or subdomain, not a sub-folder like `/portal`.
2. Upload `netportal.zip` there and **Extract** it. You should see `index.html`, `assets/`, `api/` and `.htaccess`. Turn on **Settings → Show Hidden Files** to see `.htaccess`.
3. In `api/`, copy `config.sample.php` to `config.php` and **Edit** it:
   - `db`: the database name, user and password from step 3 (`host` stays `localhost`)
   - `jwt_access_secret` / `jwt_refresh_secret`: two different random strings, 32+ characters each
   - `cron_secret`: another random string
   - `seed_admin_email` / `seed_admin_password`: the first admin login (8+ character password)

### 5. Open the site

Visit `https://your-domain/api/health`. It should show `{"ok":true}`. The first request creates the tables, the admin, starter packages and settings. Then open the site, log in at `/login`, and fill in **Admin → Settings** and **Admin → Packages**. You can blank the seed password in `config.php` afterwards.

### 6. Schedule the expiry checks (cPanel → Cron Jobs)

Add a cron job every 10 minutes (`*/10 * * * *`) with either command:

```
curl -s "https://your-domain/api/cron?key=YOUR_CRON_SECRET" > /dev/null
```

```
php -q /home/CPANEL_USER/public_html/api/cron.php > /dev/null
```

If you skip this, the checks still run when people use the site, but the cron job makes them run on time.

### Updating

Run `npm run package`, upload the new zip and extract it over the old files. `api/config.php` isn't in the zip, so it's kept. New database migrations in `api/migrations/` are applied automatically on the next request.

### Backups

Everything, including uploaded payment receipts, is in the MySQL database. Back it up from cPanel → **Backup** or phpMyAdmin → **Export**.

### Troubleshooting

- **`/api/health` shows an error about `config.php`**: create `api/config.php` from `config.sample.php` (step 4).
- **"Something went wrong"**: set `'env' => 'development'` in `config.php` to see the real error, then set it back. PHP's `error_log` file in `api/` (or cPanel → Errors) also has details.
- **Pages other than the home page show "Not Found"**: the `.htaccess` file wasn't uploaded, or the host doesn't allow `.htaccess` rewrites (ask them to enable `mod_rewrite` / `AllowOverride`).
- **Logged out on every click / "Session expired"**: the host is stripping the `Authorization` header. `api/.htaccess` already passes it through; if it persists, ask the host to enable `CGIPassAuth`.
- **Receipt upload says the file is too large**: `api/.user.ini` raises PHP's upload limit to 6 MB. If the host ignores it, raise `upload_max_filesize` / `post_max_size` in cPanel → **Select PHP Version → Options**. MySQL's `max_allowed_packet` must also be above the file size (the host's default is usually fine).

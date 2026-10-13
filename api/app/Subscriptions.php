<?php

declare(strict_types=1);

final class Subscriptions
{
    public const SELECT = 'SELECT s.*, p.name AS plan_name, p.speed AS plan_speed, p.price_kobo AS plan_price_kobo, p.duration_days AS plan_duration_days
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id';

    /** The period covering $now, if any. */
    public static function current(string $customerId, ?DateTimeImmutable $now = null): ?array
    {
        $now = Clock::db($now ?? Clock::now());
        return Db::one(self::SELECT . " WHERE s.customer_id = ? AND s.status = 'ACTIVE' AND s.starts_at <= ? AND s.expires_at > ? ORDER BY s.expires_at DESC LIMIT 1", [$customerId, $now, $now]);
    }

    /** When paid-up time runs out, including renewals queued after the current period. */
    public static function coverageEnd(string $customerId, ?DateTimeImmutable $now = null): ?string
    {
        $v = Db::value("SELECT MAX(expires_at) FROM subscriptions WHERE customer_id = ? AND status = 'ACTIVE' AND expires_at > ?", [$customerId, Clock::db($now ?? Clock::now())]);
        return $v === null ? null : (string) $v;
    }

    /**
     * Marks an invoice paid and creates its subscription period. Call inside Db::tx().
     * Renewing while still active stacks the new period after the current one, so no paid days are lost.
     */
    public static function activateInvoice(string $invoiceId, ?string $actorId): array
    {
        $inv = Db::one('SELECT i.*, p.duration_days FROM invoices i JOIN plans p ON p.id = i.plan_id WHERE i.id = ? FOR UPDATE', [$invoiceId]);
        if (!$inv) throw HttpError::notFound('Invoice not found');
        if ($inv['status'] === 'PAID') throw HttpError::badRequest('Invoice is already paid');
        if ($inv['status'] === 'CANCELLED') throw HttpError::badRequest('Invoice was cancelled');

        $now = Clock::now();
        $end = self::coverageEnd($inv['customer_id'], $now);
        $startsAt = $end !== null && Clock::parse($end) > $now ? Clock::parse($end) : $now;
        $expiresAt = Clock::addDays($startsAt, (int) $inv['duration_days']);

        Db::update('invoices', ['status' => 'PAID', 'paid_at' => Clock::db($now), 'updated_at' => Clock::db($now)], 'id = ?', [$inv['id']]);
        $sub = [
            'id' => Db::id(),
            'customer_id' => $inv['customer_id'],
            'plan_id' => $inv['plan_id'],
            'invoice_id' => $inv['id'],
            'status' => 'ACTIVE',
            'starts_at' => Clock::db($startsAt),
            'expires_at' => Clock::db($expiresAt),
            'created_at' => Clock::db($now),
            'updated_at' => Clock::db($now),
        ];
        Db::insert('subscriptions', $sub);
        Audit::log($actorId, 'subscription.activate', 'Subscription', $sub['id'], ['invoice' => Fmt::invoiceNo((int) $inv['seq'])]);
        return $sub;
    }

    public static function ensureNetworkAccount(string $customerId): array
    {
        $existing = Db::one('SELECT * FROM network_accounts WHERE customer_id = ?', [$customerId]);
        if ($existing) return $existing;
        $seq = (int) Db::value('SELECT seq FROM customers WHERE id = ?', [$customerId]);
        Db::exec(
            'INSERT INTO network_accounts (id, customer_id, username, password, mac_addresses, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
            [Db::id(), $customerId, strtolower(str_replace('-', '', Fmt::accountNo($seq))), Fmt::randomPassword(), '[]', Clock::nowDb()],
        );
        return Db::one('SELECT * FROM network_accounts WHERE customer_id = ?', [$customerId]);
    }

    /** Recompute whether the customer should have internet and push it to the network adapter. */
    public static function syncAccess(string $customerId): array
    {
        $status = Db::value('SELECT status FROM customers WHERE id = ?', [$customerId]);
        $desired = $status === 'ACTIVE' && self::current($customerId) !== null;
        $account = self::ensureNetworkAccount($customerId);

        $applied = false;
        $adapter = Network::adapter();
        if ($adapter->automatic() && (bool) $account['enabled'] !== $desired) {
            try {
                $applied = $adapter->setAccess($account, $desired);
            } catch (Throwable $e) {
                error_log("[network] {$adapter->name()} failed for {$account['username']}: {$e->getMessage()}");
            }
        }
        $set = ['desired_enabled' => $desired, 'updated_at' => Clock::nowDb()];
        if ($applied) $set += ['enabled' => $desired, 'last_synced_at' => Clock::nowDb()];
        Db::update('network_accounts', $set, 'id = ?', [$account['id']]);
        return array_merge($account, ['desired_enabled' => (int) $desired], $applied ? ['enabled' => (int) $desired] : []);
    }

    /** Flip finished periods to EXPIRED and cut access. Safe to run repeatedly. */
    public static function expireDue(): int
    {
        $now = Clock::nowDb();
        $due = Db::all(
            "SELECT s.id, s.customer_id, s.expires_at, p.name AS plan_name, c.user_id
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN customers c ON c.id = s.customer_id
             WHERE s.status = 'ACTIVE' AND s.expires_at <= ?",
            [$now],
        );
        if (!$due) return 0;
        $ids = array_column($due, 'id');
        Db::exec("UPDATE subscriptions SET status = 'EXPIRED', updated_at = ? WHERE id IN (" . Db::in($ids) . ')', [$now, ...$ids]);

        $byCustomer = [];
        foreach ($due as $s) $byCustomer[$s['customer_id']] = $s;
        foreach ($byCustomer as $customerId => $s) {
            $account = self::syncAccess($customerId);
            if (!(int) $account['desired_enabled']) {
                Notify::user(
                    $s['user_id'],
                    'Your internet subscription has expired',
                    "Your {$s['plan_name']} plan expired on " . Clock::fmtDate($s['expires_at']) . '. Renew from your dashboard to reconnect.',
                    "expired:{$s['id']}",
                );
            }
        }
        return count($due);
    }

    /** One reminder per configured threshold (e.g. 7, 3 and 1 days before coverage ends). */
    public static function sendReminders(): int
    {
        $thresholds = array_values(array_unique(array_map('intval', Settings::get()['reminderDays'] ?? [])));
        if (!$thresholds) return 0;
        sort($thresholds);
        $max = end($thresholds);
        $now = Clock::now();

        $rows = Db::all(
            "SELECT s.customer_id, s.expires_at, p.name AS plan_name, c.user_id, c.status AS customer_status
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN customers c ON c.id = s.customer_id
             WHERE s.status = 'ACTIVE' AND s.expires_at > ? ORDER BY s.expires_at DESC",
            [Clock::db($now)],
        );
        $latest = [];
        foreach ($rows as $r) $latest[$r['customer_id']] ??= $r; // first row = latest end per customer

        $sent = 0;
        foreach ($latest as $r) {
            if ($r['customer_status'] !== 'ACTIVE') continue;
            $daysLeft = (int) ceil(Clock::msBetween($now, Clock::parse($r['expires_at'])) / Fmt::DAY_MS);
            if ($daysLeft > $max) continue;
            $threshold = 0;
            foreach ($thresholds as $t) {
                if ($daysLeft <= $t) { $threshold = $t; break; }
            }
            $created = Notify::user(
                $r['user_id'],
                $daysLeft <= 1 ? 'Your internet expires tomorrow' : "Your internet expires in $daysLeft days",
                "Your {$r['plan_name']} subscription ends on " . Clock::fmtDate($r['expires_at']) . '. Renew now to avoid disconnection.',
                "remind:{$r['customer_id']}:" . Clock::iso($r['expires_at']) . ":$threshold",
            );
            if ($created) $sent++;
        }
        return $sent;
    }
}

/** Background work: expiry + reminders. Triggered by cron and, as a fallback, by site traffic. */
final class Jobs
{
    private const INTERVAL_SECONDS = 600;

    public static function run(): array
    {
        try {
            $expired = Subscriptions::expireDue();
            $reminders = Subscriptions::sendReminders();
            Settings::put('jobs', ['lastRun' => Clock::now()->format(DATE_ATOM)]);
            return ['ok' => true, 'expired' => $expired, 'reminders' => $reminders];
        } catch (Throwable $e) {
            error_log('[jobs] failed: ' . $e->getMessage());
            return ['ok' => false, 'expired' => 0, 'reminders' => 0];
        }
    }

    /** Runs the jobs if they haven't run for 10 minutes and no other request is running them. */
    public static function runIfDue(): void
    {
        $raw = Db::value("SELECT value FROM settings WHERE setting_key = 'jobs'");
        $last = $raw ? (json_decode((string) $raw, true)['lastRun'] ?? null) : null;
        if ($last && time() - strtotime($last) < self::INTERVAL_SECONDS) return;
        if ((int) Db::value("SELECT GET_LOCK('netportal_jobs', 0)") !== 1) return;
        try {
            self::run();
        } finally {
            Db::value("SELECT RELEASE_LOCK('netportal_jobs')");
        }
    }
}

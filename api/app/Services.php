<?php

declare(strict_types=1);

final class Settings
{
    private const KEY = 'site';

    public static function defaults(): array
    {
        return [
            'brandName' => 'SkyLink Office Internet',
            'tagline' => 'Fast, dependable connectivity for every business in the complex. Pay monthly, no contracts.',
            'complexName' => 'Your Business Complex',
            'address' => '',
            'poweredBy' => 'Internet connectivity powered by Starlink',
            'supportPhone' => '',
            'supportEmail' => '',
            'whatsappNumber' => '',
            'bankAccounts' => [],
            'paymentInstructions' => 'Transfer the exact amount to the account below and use your invoice number as the narration/description. Then tap "I have paid" and upload your receipt screenshot. Your internet is switched on as soon as we confirm the payment.',
            'reminderDays' => [7, 3, 1],
        ];
    }

    public static function get(): array
    {
        $raw = Db::value('SELECT value FROM settings WHERE setting_key = ?', [self::KEY]);
        $stored = $raw ? json_decode((string) $raw, true) : [];
        return array_merge(self::defaults(), is_array($stored) ? $stored : []);
    }

    /** Validates the full settings object sent by the admin page and stores it. */
    public static function save(array $in): array
    {
        $out = [];
        foreach (['brandName' => [1, 120], 'tagline' => [0, 300], 'complexName' => [0, 120], 'address' => [0, 300], 'poweredBy' => [0, 200], 'supportPhone' => [0, 40], 'supportEmail' => [0, 191], 'whatsappNumber' => [0, 20], 'paymentInstructions' => [0, 2000]] as $k => [$min, $max]) {
            $out[$k] = V::str($in, $k, $min, $max, $min > 0) ?? '';
        }
        $out['bankAccounts'] = [];
        foreach (array_values(is_array($in['bankAccounts'] ?? null) ? $in['bankAccounts'] : []) as $i => $b) {
            if (!is_array($b)) V::fail("bankAccounts.$i", 'is invalid');
            $num = V::str($b, 'accountNumber', 1, 10);
            if (!preg_match('/^\d{10}$/', $num)) V::fail("bankAccounts.$i.accountNumber", 'must be 10 digits');
            $out['bankAccounts'][] = [
                'bankName' => V::str($b, 'bankName', 1, 80),
                'accountName' => V::str($b, 'accountName', 1, 120),
                'accountNumber' => $num,
            ];
        }
        $days = is_array($in['reminderDays'] ?? null) ? $in['reminderDays'] : [];
        $out['reminderDays'] = [];
        foreach (array_values($days) as $i => $d) {
            if (!is_int($d) || $d < 0 || $d > 60) V::fail("reminderDays.$i", 'must be a whole number from 0 to 60');
            $out['reminderDays'][] = $d;
        }
        self::put(self::KEY, $out);
        return $out;
    }

    public static function put(string $key, array $value): void
    {
        // Parameters repeated instead of VALUES(), which MySQL 8.0.20+ deprecates and MariaDB lacks an alternative for.
        $json = json_encode($value, JSON_UNESCAPED_UNICODE);
        $now = Clock::nowDb();
        Db::exec(
            'INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_at = ?',
            [$key, $json, $now, $json, $now],
        );
    }
}

final class Audit
{
    public static function log(?string $actorId, string $action, string $entity, ?string $entityId = null, ?array $meta = null): void
    {
        Db::insert('audit_logs', [
            'id' => Db::id(),
            'actor_id' => $actorId,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'meta' => $meta === null ? null : json_encode($meta, JSON_UNESCAPED_UNICODE),
            'created_at' => Clock::nowDb(),
        ]);
    }
}

final class Notify
{
    /**
     * In-app notification. With a $dedupeKey, repeat calls (e.g. the reminder job) do nothing.
     * Returns true when a notification was created.
     */
    public static function user(string $userId, string $title, string $body, ?string $dedupeKey = null): bool
    {
        $n = Db::exec(
            'INSERT INTO notifications (id, user_id, title, body, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
            [Db::id(), $userId, mb_substr($title, 0, 255), $body, $dedupeKey, Clock::nowDb()],
        );
        return $n > 0;
    }

    public static function staff(string $title, string $body): void
    {
        foreach (Db::all("SELECT id FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') AND is_active = 1") as $u) {
            self::user($u['id'], $title, $body);
        }
    }
}

/**
 * Bridge between the portal and the network equipment.
 *
 * V1 uses ManualAdapter: nothing is applied automatically, so `enabled` stays as the admin last
 * confirmed it and any mismatch with `desired_enabled` shows in Admin → Network access → To do.
 *
 * To automate (V2), implement this for the real gear (MikroTik RouterOS API, RADIUS, UniFi, ...)
 * and return it from Network::adapter(). setAccess() returns true when the device was updated.
 */
interface NetworkAdapter
{
    public function name(): string;
    public function automatic(): bool;
    public function setAccess(array $account, bool $enabled): bool;
}

final class ManualAdapter implements NetworkAdapter
{
    public function name(): string { return 'manual'; }
    public function automatic(): bool { return false; }
    public function setAccess(array $account, bool $enabled): bool { return false; }
}

final class Network
{
    private static ?NetworkAdapter $adapter = null;

    public static function adapter(): NetworkAdapter
    {
        return self::$adapter ??= new ManualAdapter();
    }
}

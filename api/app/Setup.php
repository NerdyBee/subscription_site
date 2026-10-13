<?php

declare(strict_types=1);

/**
 * Applies api/migrations/*.sql in order, once each, tracked in schema_migrations.
 * Runs on every request (one cheap query) so a deploy is just "upload files".
 */
final class Migrator
{
    public static function migrate(): bool
    {
        $files = glob(__DIR__ . '/../migrations/*.sql') ?: [];
        sort($files);
        $pending = array_diff(array_map(fn ($f) => basename($f, '.sql'), $files), self::applied());
        if (!$pending) return false;

        if ((int) Db::value("SELECT GET_LOCK('netportal_migrate', 60)") !== 1) {
            throw new RuntimeException('Could not get the migration lock');
        }
        try {
            Db::exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) NOT NULL, applied_at DATETIME(3) NOT NULL, PRIMARY KEY (version)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
            $done = self::applied(); // another request may have finished while we waited
            foreach ($files as $file) {
                $version = basename($file, '.sql');
                if (in_array($version, $done, true)) continue;
                foreach (self::statements((string) file_get_contents($file)) as $sql) {
                    Db::pdo()->exec($sql);
                }
                Db::insert('schema_migrations', ['version' => $version, 'applied_at' => Clock::nowDb()]);
                error_log("[setup] applied migration $version");
            }
        } finally {
            Db::value("SELECT RELEASE_LOCK('netportal_migrate')");
        }
        return true;
    }

    /** @return list<string> */
    private static function applied(): array
    {
        try {
            return array_column(Db::all('SELECT version FROM schema_migrations'), 'version');
        } catch (PDOException $e) {
            if ($e->getCode() === '42S02') return []; // table doesn't exist yet
            throw $e;
        }
    }

    /** Splits a .sql file into statements (no semicolons inside strings in our migrations). */
    private static function statements(string $sql): array
    {
        $sql = preg_replace('/^\s*--.*$/m', '', $sql);
        return array_values(array_filter(array_map('trim', preg_split('/;\s*(\r?\n|$)/', $sql)), fn ($s) => $s !== ''));
    }
}

/** Idempotent first-run data: the first super admin, starter packages and default settings. */
final class Seed
{
    public static function ensure(): void
    {
        $now = Clock::nowDb();
        if (!(int) Db::value("SELECT COUNT(*) FROM users WHERE role = 'SUPER_ADMIN'")) {
            $email = strtolower(trim((string) Config::get('seed_admin_email', '')));
            $password = (string) Config::get('seed_admin_password', '');
            if ($email === '' || strlen($password) < 8) {
                error_log('[setup] No super admin yet. Set seed_admin_email and seed_admin_password (8+ characters) in api/config.php.');
            } else {
                Db::insert('users', [
                    'id' => Db::id(), 'email' => $email, 'name' => 'Administrator', 'role' => 'SUPER_ADMIN',
                    'password_hash' => password_hash($password, PASSWORD_BCRYPT), 'is_active' => 1, 'token_version' => 0,
                    'created_at' => $now, 'updated_at' => $now,
                ]);
                error_log("[setup] created super admin $email");
            }
        }

        if (!(int) Db::value('SELECT COUNT(*) FROM plans')) {
            $plans = [
                ['Office Basic', 'Up to 25 Mbps', 'For small offices with a few staff.', 30, 20_000_00, ['Up to 5 devices', 'Email & browsing', 'WhatsApp support'], false, 1],
                ['Office Plus', 'Up to 50 Mbps', 'Video calls and cloud apps without the lag.', 30, 35_000_00, ['Up to 15 devices', 'Smooth video calls', 'Priority support'], true, 2],
                ['Business Pro', 'Up to 100 Mbps', 'Priority allocation for busy teams.', 30, 60_000_00, ['Unlimited devices', 'Priority bandwidth', 'Dedicated support line'], false, 3],
                ['Daily Pass', 'Up to 25 Mbps', 'Just need a day? Get online now.', 1, 2_000_00, ['Up to 3 devices'], false, 4],
            ];
            foreach ($plans as [$name, $speed, $desc, $days, $price, $features, $featured, $order]) {
                Db::insert('plans', [
                    'id' => Db::id(), 'name' => $name, 'speed' => $speed, 'description' => $desc, 'duration_days' => $days,
                    'price_kobo' => $price, 'features' => json_encode($features), 'is_active' => 1, 'is_featured' => (int) $featured,
                    'sort_order' => $order, 'created_at' => $now, 'updated_at' => $now,
                ]);
            }
        }

        if (!Db::value("SELECT COUNT(*) FROM settings WHERE setting_key = 'site'")) {
            Settings::put('site', Settings::defaults());
        }
    }
}

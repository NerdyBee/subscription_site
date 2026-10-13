<?php

declare(strict_types=1);

final class Config
{
    private static ?array $values = null;

    public static function load(string $file): void
    {
        if (!is_file($file)) {
            throw new RuntimeException('Missing api/config.php. Copy api/config.sample.php to api/config.php and fill it in.');
        }
        self::$values = require $file;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::$values[$key] ?? $default;
    }

    public static function isProd(): bool
    {
        return self::get('env', 'production') !== 'development';
    }
}

/** Time helpers. Everything is stored in UTC; display uses the configured timezone. */
final class Clock
{
    private static ?DateTimeImmutable $frozen = null;

    public static function now(): DateTimeImmutable
    {
        return self::$frozen ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }

    /** DateTime → DATETIME(3) string in UTC. */
    public static function db(DateTimeInterface $d): string
    {
        return DateTimeImmutable::createFromInterface($d)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
    }

    public static function nowDb(): string
    {
        return self::db(self::now());
    }

    public static function parse(string $dbValue): DateTimeImmutable
    {
        return new DateTimeImmutable($dbValue, new DateTimeZone('UTC'));
    }

    /** DATETIME string → ISO 8601 (what the browser expects), or null. */
    public static function iso(?string $dbValue): ?string
    {
        return $dbValue === null ? null : self::parse($dbValue)->format('Y-m-d\TH:i:s.v\Z');
    }

    public static function addDays(DateTimeImmutable $d, int $days): DateTimeImmutable
    {
        return $d->modify(($days >= 0 ? '+' : '') . $days . ' days');
    }

    public static function local(): DateTimeZone
    {
        return new DateTimeZone((string) Config::get('timezone', 'Africa/Lagos'));
    }

    /** e.g. "06 Nov 2026" in local time. */
    public static function fmtDate(DateTimeInterface|string $d): string
    {
        $dt = is_string($d) ? self::parse($d) : DateTimeImmutable::createFromInterface($d);
        return $dt->setTimezone(self::local())->format('d M Y');
    }

    public static function msBetween(DateTimeInterface $a, DateTimeInterface $b): float
    {
        return ((float) $b->format('U.u') - (float) $a->format('U.u')) * 1000;
    }
}

final class Fmt
{
    public const DAY_MS = 86_400_000;

    public static function accountNo(int $seq): string { return 'NET-' . str_pad((string) $seq, 5, '0', STR_PAD_LEFT); }
    public static function invoiceNo(int $seq): string { return 'INV-' . str_pad((string) $seq, 6, '0', STR_PAD_LEFT); }
    public static function ticketNo(int $seq): string { return 'TKT-' . str_pad((string) $seq, 5, '0', STR_PAD_LEFT); }

    public static function naira(int $kobo): string
    {
        $n = $kobo / 100;
        return '₦' . number_format($n, fmod($n, 1.0) == 0.0 ? 0 : 2);
    }

    /** JSON text column holding a list of strings. */
    public static function stringList(?string $json): array
    {
        $v = $json ? json_decode($json, true) : [];
        return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
    }

    public static function randomPassword(int $length = 8): string
    {
        $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
        $out = '';
        for ($i = 0; $i < $length; $i++) $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        return $out;
    }

    /** Readable temporary password for staff/customer resets. */
    public static function tempPassword(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(6)), '+/', '-_'), '=');
    }
}

/**
 * Input validation. Each method reads $in[$key], checks it, and throws a 400 with a message the
 * site shows to the user ("field: problem").
 */
final class V
{
    /** Required (or optional) trimmed string. Optional fields return null when missing or ''. */
    public static function str(array $in, string $key, int $min = 0, int $max = 1000, bool $required = true): ?string
    {
        $v = $in[$key] ?? null;
        if ($v === null || (is_string($v) && trim($v) === '')) {
            if ($required) self::fail($key, $min > 0 ? 'is required' : 'is required');
            return null;
        }
        if (!is_string($v) && !is_int($v) && !is_float($v)) self::fail($key, 'must be text');
        $v = trim((string) $v);
        $len = mb_strlen($v);
        if ($len < $min) self::fail($key, "must be at least $min characters");
        if ($len > $max) self::fail($key, "must be at most $max characters");
        return $v;
    }

    public static function opt(array $in, string $key, int $max = 1000): ?string
    {
        return self::str($in, $key, 0, $max, false);
    }

    /** True when the key was sent at all (for partial updates). */
    public static function has(array $in, string $key): bool
    {
        return array_key_exists($key, $in);
    }

    public static function email(array $in, string $key): string
    {
        $v = strtolower((string) self::str($in, $key, 3, 191));
        if (!filter_var($v, FILTER_VALIDATE_EMAIL)) self::fail($key, 'must be a valid email address');
        return $v;
    }

    public static function password(array $in, string $key): string
    {
        $v = $in[$key] ?? '';
        if (!is_string($v) || mb_strlen($v) < 8) self::fail($key, 'must be at least 8 characters');
        if (mb_strlen($v) > 100) self::fail($key, 'must be at most 100 characters');
        return $v;
    }

    public static function int(array $in, string $key, int $min, int $max, ?int $default = null): int
    {
        $v = $in[$key] ?? null;
        if ($v === null || $v === '') {
            if ($default !== null) return $default;
            self::fail($key, 'is required');
        }
        if (!is_numeric($v) || (float) $v != (int) $v) self::fail($key, 'must be a whole number');
        $v = (int) $v;
        if ($v < $min || $v > $max) self::fail($key, "must be between $min and $max");
        return $v;
    }

    /** Naira amount (number or numeric string) → kobo. */
    public static function nairaToKobo(array $in, string $key, bool $required = true): ?int
    {
        $v = $in[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) self::fail($key, 'is required');
            return null;
        }
        if (!is_numeric($v) || (float) $v < 0) self::fail($key, 'must be a positive amount');
        return (int) round((float) $v * 100);
    }

    public static function bool(array $in, string $key, ?bool $default = null): ?bool
    {
        $v = $in[$key] ?? null;
        if ($v === null) return $default;
        if (is_bool($v)) return $v;
        if (in_array($v, [1, '1', 'true', 'on'], true)) return true;
        if (in_array($v, [0, '0', 'false', 'off', ''], true)) return false;
        self::fail($key, 'must be true or false');
    }

    /** @param list<string> $allowed */
    public static function enum(array $in, string $key, array $allowed, bool $required = true): ?string
    {
        $v = $in[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) self::fail($key, 'is required');
            return null;
        }
        if (!in_array($v, $allowed, true)) self::fail($key, 'must be one of ' . implode(', ', $allowed));
        return $v;
    }

    /** List of strings, each trimmed and checked. */
    public static function stringList(array $in, string $key, int $maxItems, int $maxLen, ?string $pattern = null, string $patternMsg = 'is invalid'): array
    {
        $v = $in[$key] ?? [];
        if (!is_array($v)) self::fail($key, 'must be a list');
        if (count($v) > $maxItems) self::fail($key, "must have at most $maxItems items");
        $out = [];
        foreach (array_values($v) as $i => $item) {
            if (!is_string($item) || ($item = trim($item)) === '') self::fail("$key.$i", 'must not be empty');
            if (mb_strlen($item) > $maxLen) self::fail("$key.$i", "must be at most $maxLen characters");
            if ($pattern && !preg_match($pattern, $item)) self::fail("$key.$i", $patternMsg);
            $out[] = $item;
        }
        return $out;
    }

    public static function fail(string $key, string $message): never
    {
        throw HttpError::badRequest("$key: $message");
    }
}

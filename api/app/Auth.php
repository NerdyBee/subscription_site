<?php

declare(strict_types=1);

/**
 * Short-lived access token (HS256 JWT, sent as a Bearer header) plus a 30-day refresh token in an
 * httpOnly cookie scoped to /api/auth. Bumping users.token_version revokes every refresh token.
 */
final class Auth
{
    private const ACCESS_TTL = 15 * 60;
    private const REFRESH_TTL = 30 * 24 * 60 * 60;
    public const REFRESH_COOKIE = 'np_refresh';

    public static function signAccess(array $info): string
    {
        return self::sign(
            ['userId' => $info['userId'], 'role' => $info['role'], 'customerId' => $info['customerId'], 'exp' => time() + self::ACCESS_TTL],
            (string) Config::get('jwt_access_secret'),
        );
    }

    public static function setRefreshCookie(array $user): void
    {
        $token = self::sign(
            ['sub' => $user['id'], 'v' => (int) $user['token_version'], 'exp' => time() + self::REFRESH_TTL],
            (string) Config::get('jwt_refresh_secret'),
        );
        setcookie(self::REFRESH_COOKIE, $token, [
            'expires' => time() + self::REFRESH_TTL,
            'path' => '/api/auth',
            'secure' => self::isHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    public static function clearRefreshCookie(): void
    {
        setcookie(self::REFRESH_COOKIE, '', ['expires' => time() - 3600, 'path' => '/api/auth', 'secure' => self::isHttps(), 'httponly' => true, 'samesite' => 'Lax']);
    }

    /** @return array{sub: string, v: int}|null */
    public static function verifyRefresh(string $token): ?array
    {
        $p = self::verify($token, (string) Config::get('jwt_refresh_secret'));
        return $p && isset($p['sub'], $p['v']) ? $p : null;
    }

    public static function infoFor(string $userId): array
    {
        $u = Db::one('SELECT u.id, u.role, c.id AS customer_id FROM users u LEFT JOIN customers c ON c.user_id = u.id WHERE u.id = ?', [$userId]);
        if (!$u) throw HttpError::unauthorized();
        return ['userId' => $u['id'], 'role' => $u['role'], 'customerId' => $u['customer_id']];
    }

    // ---- Route guards --------------------------------------------------------------------

    public static function require(Request $req): void
    {
        $header = $req->header('Authorization') ?? '';
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
        if ($token === '') throw HttpError::unauthorized();
        $p = self::verify($token, (string) Config::get('jwt_access_secret'));
        if (!$p || !isset($p['userId'], $p['role'])) throw HttpError::unauthorized('Session expired');
        $req->auth = ['userId' => $p['userId'], 'role' => $p['role'], 'customerId' => $p['customerId'] ?? null];
    }

    public static function requireStaff(Request $req): void
    {
        self::require($req);
        if (!self::isStaff($req->auth['role'])) throw HttpError::forbidden();
    }

    public static function requireSuperAdmin(Request $req): void
    {
        self::require($req);
        if ($req->auth['role'] !== 'SUPER_ADMIN') throw HttpError::forbidden();
    }

    public static function requireCustomer(Request $req): void
    {
        self::require($req);
        if (!$req->auth['customerId']) throw HttpError::forbidden('Customer account required');
    }

    public static function isStaff(string $role): bool
    {
        return $role === 'ADMIN' || $role === 'SUPER_ADMIN';
    }

    // ---- JWT (HS256) ---------------------------------------------------------------------

    private static function sign(array $payload, string $secret): string
    {
        self::assertSecret($secret);
        $payload['iat'] = time();
        $h = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $p = self::b64(json_encode($payload));
        return "$h.$p." . self::b64(hash_hmac('sha256', "$h.$p", $secret, true));
    }

    private static function verify(string $token, string $secret): ?array
    {
        self::assertSecret($secret);
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;
        [$h, $p, $s] = $parts;
        $expected = self::b64(hash_hmac('sha256', "$h.$p", $secret, true));
        if (!hash_equals($expected, $s)) return null;
        $header = json_decode(self::unb64($h), true);
        if (($header['alg'] ?? '') !== 'HS256') return null;
        $payload = json_decode(self::unb64($p), true);
        if (!is_array($payload) || ($payload['exp'] ?? 0) < time()) return null;
        return $payload;
    }

    private static function assertSecret(string $secret): void
    {
        if (strlen($secret) < 32) throw new RuntimeException('JWT secrets in api/config.php must be at least 32 characters');
    }

    private static function b64(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    private static function unb64(string $s): string
    {
        return (string) base64_decode(strtr($s, '-_', '+/'));
    }

    public static function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
            || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
    }
}

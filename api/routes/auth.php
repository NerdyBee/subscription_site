<?php

declare(strict_types=1);

/** Session payload returned by login/register/refresh. */
function auth_session(string $userId): array
{
    $u = Db::one('SELECT u.*, c.id AS customer_id, c.company_name, c.seq FROM users u LEFT JOIN customers c ON c.user_id = u.id WHERE u.id = ?', [$userId]);
    return [
        'accessToken' => Auth::signAccess(Auth::infoFor($userId)),
        'user' => [
            'id' => $u['id'],
            'email' => $u['email'],
            'name' => $u['name'],
            'role' => $u['role'],
            'customerId' => $u['customer_id'],
            'companyName' => $u['company_name'],
            'accountNo' => $u['customer_id'] ? Fmt::accountNo((int) $u['seq']) : null,
        ],
    ];
}

return function (Router $r): void {
    $r->post('/auth/register', function (Request $req) {
        $b = $req->body;
        $companyName = V::str($b, 'companyName', 2, 120);
        $contactName = V::str($b, 'contactName', 2, 120);
        $email = V::email($b, 'email');
        $phone = V::str($b, 'phone', 7, 20);
        $officeUnit = V::opt($b, 'officeUnit', 40);
        $password = V::password($b, 'password');

        if (Db::value('SELECT id FROM users WHERE email = ?', [$email])) {
            throw HttpError::badRequest('An account with this email already exists. Try logging in.');
        }

        $userId = Db::id();
        $customerId = Db::id();
        $now = Clock::nowDb();
        Db::tx(function () use ($userId, $customerId, $now, $companyName, $contactName, $email, $phone, $officeUnit, $password) {
            $officeId = null;
            if ($officeUnit) {
                $officeId = Db::value('SELECT id FROM offices WHERE unit = ?', [$officeUnit]);
                if (!$officeId) {
                    $officeId = Db::id();
                    Db::insert('offices', ['id' => $officeId, 'unit' => $officeUnit, 'created_at' => $now]);
                }
            }
            Db::insert('users', [
                'id' => $userId, 'email' => $email, 'name' => $contactName, 'phone' => $phone,
                'password_hash' => password_hash($password, PASSWORD_BCRYPT), 'role' => 'CUSTOMER',
                'created_at' => $now, 'updated_at' => $now,
            ]);
            Db::insert('customers', [
                'id' => $customerId, 'user_id' => $userId, 'company_name' => $companyName, 'contact_name' => $contactName,
                'phone' => $phone, 'whatsapp' => $phone, 'office_id' => $officeId, 'created_at' => $now, 'updated_at' => $now,
            ]);
        });
        Audit::log($userId, 'customer.register', 'Customer', $customerId);
        Notify::staff('New customer registered', $companyName . ($officeUnit ? " ($officeUnit)" : '') . ' just signed up.');

        Auth::setRefreshCookie(['id' => $userId, 'token_version' => 0]);
        return Response::created(auth_session($userId));
    });

    $r->post('/auth/login', function (Request $req) {
        $email = strtolower(trim((string) ($req->body['email'] ?? '')));
        $password = (string) ($req->body['password'] ?? '');
        $user = $email !== '' ? Db::one('SELECT * FROM users WHERE email = ?', [$email]) : null;
        if (!$user || !password_verify($password, $user['password_hash'])) {
            throw HttpError::unauthorized('Incorrect email or password');
        }
        if (!(int) $user['is_active']) throw HttpError::unauthorized('This account has been disabled. Please contact support.');
        Db::update('users', ['last_login_at' => Clock::nowDb()], 'id = ?', [$user['id']]);
        Auth::setRefreshCookie($user);
        return auth_session($user['id']);
    });

    $r->post('/auth/refresh', function () {
        $token = $_COOKIE[Auth::REFRESH_COOKIE] ?? '';
        if ($token === '') return new Response(null, 204); // not signed in: a normal state, not an error
        $p = Auth::verifyRefresh($token);
        $user = $p ? Db::one('SELECT * FROM users WHERE id = ?', [$p['sub']]) : null;
        if (!$user || !(int) $user['is_active'] || (int) $user['token_version'] !== (int) $p['v']) {
            Auth::clearRefreshCookie();
            throw HttpError::unauthorized('Session expired');
        }
        Auth::setRefreshCookie($user);
        return auth_session($user['id']);
    });

    $r->post('/auth/logout', function () {
        Auth::clearRefreshCookie();
        return ['ok' => true];
    });

    $r->get('/auth/me', fn (Request $req) => auth_session($req->auth['userId'])['user'], [Auth::class, 'require']);

    $r->post('/auth/change-password', function (Request $req) {
        $current = (string) ($req->body['currentPassword'] ?? '');
        $new = V::password($req->body, 'newPassword');
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$req->auth['userId']]);
        if (!password_verify($current, $user['password_hash'])) throw HttpError::badRequest('Current password is incorrect');
        // Bumping token_version signs out every other device.
        Db::update('users', ['password_hash' => password_hash($new, PASSWORD_BCRYPT), 'token_version' => (int) $user['token_version'] + 1, 'updated_at' => Clock::nowDb()], 'id = ?', [$user['id']]);
        Audit::log($user['id'], 'user.change_password', 'User', $user['id']);
        Auth::setRefreshCookie(['id' => $user['id'], 'token_version' => (int) $user['token_version'] + 1]);
        return ['ok' => true];
    }, [Auth::class, 'require']);
};

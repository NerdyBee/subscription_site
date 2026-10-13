<?php

declare(strict_types=1);

return function (Router $r): void {
    $r->get('/notifications', function (Request $req) {
        $uid = $req->auth['userId'];
        $items = Db::all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [$uid]);
        return [
            'unread' => (int) Db::value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [$uid]),
            'items' => array_map(fn ($n) => [
                'id' => $n['id'],
                'title' => $n['title'],
                'body' => $n['body'],
                'readAt' => Clock::iso($n['read_at']),
                'createdAt' => Clock::iso($n['created_at']),
            ], $items),
        ];
    }, [Auth::class, 'require']);

    $r->post('/notifications/read-all', function (Request $req) {
        Db::exec('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [Clock::nowDb(), $req->auth['userId']]);
        return ['ok' => true];
    }, [Auth::class, 'require']);

    // Payment receipts are private: only staff or the customer who uploaded them.
    $r->get('/payments/{id}/proof', function (Request $req) {
        $p = Db::one('SELECT pay.customer_id, pr.mime, pr.data FROM payments pay JOIN payment_proofs pr ON pr.payment_id = pay.id WHERE pay.id = ?', [$req->param('id')]);
        $allowed = $p && (Auth::isStaff($req->auth['role']) || $p['customer_id'] === $req->auth['customerId']);
        if (!$allowed) throw HttpError::notFound('Receipt not found');
        return new FileResponse((string) $p['data'], $p['mime']);
    }, [Auth::class, 'require']);
};

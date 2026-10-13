<?php

declare(strict_types=1);

/** Validated receipt upload from $_FILES['proof'], or null when none was sent. */
function read_proof_upload(): ?array
{
    $f = $_FILES['proof'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
    if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
        // The host's PHP limit is below ours (see api/.user.ini); tell the customer the real limit.
        throw HttpError::badRequest('Receipt is too large for this server (max ' . ini_get('upload_max_filesize') . 'B). Please send a smaller screenshot.');
    }
    if ($f['size'] > 5 * 1024 * 1024) throw HttpError::badRequest('Receipt must be under 5 MB');
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw HttpError::badRequest('The receipt upload failed. Please try again.');
    $mime = function_exists('finfo_open') ? (string) finfo_file(finfo_open(FILEINFO_MIME_TYPE), $f['tmp_name']) : (string) $f['type'];
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], true)) {
        throw HttpError::badRequest('Receipt must be a JPG, PNG, WEBP image or a PDF');
    }
    return ['mime' => $mime, 'data' => (string) file_get_contents($f['tmp_name'])];
}

return function (Router $r): void {
    $r->guard('/me', [Auth::class, 'requireCustomer']);
    $cid = fn (Request $req): string => $req->auth['customerId'];

    $r->get('/me/overview', fn (Request $req) => Views::customerOverview($cid($req)));

    $r->patch('/me/profile', function (Request $req) use ($cid) {
        $b = $req->body;
        $contactName = V::str($b, 'contactName', 2, 120);
        $phone = V::str($b, 'phone', 7, 20);
        $whatsapp = V::opt($b, 'whatsapp', 20);
        $now = Clock::nowDb();
        Db::update('customers', ['contact_name' => $contactName, 'phone' => $phone, 'whatsapp' => $whatsapp, 'updated_at' => $now], 'id = ?', [$cid($req)]);
        Db::update('users', ['name' => $contactName, 'phone' => $phone, 'updated_at' => $now], 'id = ?', [$req->auth['userId']]);
        return Views::customerOverview($cid($req));
    });

    $r->get('/me/subscriptions', fn (Request $req) => array_map(
        [Views::class, 'subscription'],
        Db::all(Subscriptions::SELECT . ' WHERE s.customer_id = ? ORDER BY s.starts_at DESC', [$cid($req)]),
    ));

    // ---- Invoices & payments ------------------------------------------------------------

    $r->get('/me/invoices', function (Request $req) use ($cid) {
        $invoices = Db::all(Views::INVOICE_SELECT . ' WHERE i.customer_id = ? ORDER BY i.created_at DESC', [$cid($req)]);
        $payments = [];
        if ($invoices) {
            $ids = array_column($invoices, 'id');
            foreach (Db::all('SELECT * FROM payments WHERE invoice_id IN (' . Db::in($ids) . ') ORDER BY created_at DESC', $ids) as $p) {
                $payments[$p['invoice_id']][] = $p;
            }
        }
        return array_map(fn ($i) => Views::invoice($i, $payments[$i['id']] ?? []), $invoices);
    });

    $r->get('/me/invoices/{id}', function (Request $req) use ($cid) {
        $i = Db::one(Views::INVOICE_SELECT . ' WHERE i.id = ? AND i.customer_id = ?', [$req->param('id'), $cid($req)]);
        if (!$i) throw HttpError::notFound('Invoice not found');
        $payments = Db::all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC', [$i['id']]);
        $sub = Db::one('SELECT starts_at, expires_at FROM subscriptions WHERE invoice_id = ?', [$i['id']]);
        return Views::invoice($i, $payments) + [
            'subscription' => $sub ? ['startsAt' => Clock::iso($sub['starts_at']), 'expiresAt' => Clock::iso($sub['expires_at'])] : null,
        ];
    });

    $r->post('/me/invoices', function (Request $req) use ($cid) {
        $planId = V::str($req->body, 'planId', 1, 40);
        $customer = Db::one('SELECT * FROM customers WHERE id = ?', [$cid($req)]);
        if ($customer['status'] === 'SUSPENDED') throw HttpError::badRequest('Your account is suspended. Please contact support.');
        $plan = Db::one('SELECT * FROM plans WHERE id = ? AND is_active = 1', [$planId]);
        if (!$plan) throw HttpError::notFound('That package is no longer available');

        // Only one open invoice at a time keeps the admin queue clean; picking another plan replaces it.
        $open = Db::one(Views::INVOICE_SELECT . " WHERE i.customer_id = ? AND i.status IN ('UNPAID','PENDING_VERIFICATION') ORDER BY i.created_at DESC LIMIT 1", [$customer['id']]);
        if ($open && $open['status'] === 'PENDING_VERIFICATION') {
            throw HttpError::badRequest("We're still confirming your payment for " . Fmt::invoiceNo((int) $open['seq']) . '. Please wait for it to be verified.');
        }
        if ($open && $open['plan_id'] === $plan['id'] && (int) $open['amount_kobo'] === (int) $plan['price_kobo']) {
            return Views::invoice($open);
        }
        $now = Clock::nowDb();
        if ($open) Db::update('invoices', ['status' => 'CANCELLED', 'updated_at' => $now], 'id = ?', [$open['id']]);

        $id = Db::id();
        Db::insert('invoices', ['id' => $id, 'customer_id' => $customer['id'], 'plan_id' => $plan['id'], 'amount_kobo' => (int) $plan['price_kobo'], 'status' => 'UNPAID', 'created_at' => $now, 'updated_at' => $now]);
        Audit::log($req->auth['userId'], 'invoice.create', 'Invoice', $id, ['plan' => $plan['name']]);
        return Response::created(Views::invoice(Db::one(Views::INVOICE_SELECT . ' WHERE i.id = ?', [$id])));
    });

    $r->post('/me/invoices/{id}/cancel', function (Request $req) use ($cid) {
        $i = Db::one('SELECT * FROM invoices WHERE id = ? AND customer_id = ?', [$req->param('id'), $cid($req)]);
        if (!$i) throw HttpError::notFound('Invoice not found');
        if ($i['status'] !== 'UNPAID') throw HttpError::badRequest('Only unpaid invoices can be cancelled');
        Db::update('invoices', ['status' => 'CANCELLED', 'updated_at' => Clock::nowDb()], 'id = ?', [$i['id']]);
        return ['ok' => true];
    });

    $r->post('/me/invoices/{id}/payments', function (Request $req) use ($cid) {
        $b = $req->body;
        $senderName = V::str($b, 'senderName', 2, 120);
        $senderBank = V::opt($b, 'senderBank', 80);
        $transferRef = V::opt($b, 'transferRef', 120);
        $note = V::opt($b, 'note', 500);
        $proof = read_proof_upload();

        $inv = Db::one(
            'SELECT i.*, c.company_name, p.name AS plan_name FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN plans p ON p.id = i.plan_id WHERE i.id = ? AND i.customer_id = ?',
            [$req->param('id'), $cid($req)],
        );
        if (!$inv) throw HttpError::notFound('Invoice not found');
        if ($inv['status'] !== 'UNPAID') throw HttpError::badRequest('This invoice is not awaiting payment');

        $id = Db::id();
        $now = Clock::nowDb();
        $payment = [
            'id' => $id, 'invoice_id' => $inv['id'], 'customer_id' => $inv['customer_id'], 'amount_kobo' => (int) $inv['amount_kobo'],
            'method' => 'BANK_TRANSFER', 'status' => 'PENDING', 'sender_name' => $senderName, 'sender_bank' => $senderBank,
            'transfer_ref' => $transferRef, 'note' => $note, 'proof_mime' => $proof['mime'] ?? null, 'created_at' => $now,
        ];
        Db::tx(function () use ($payment, $proof, $inv, $now, $req) {
            Db::insert('payments', $payment);
            if ($proof) Db::insert('payment_proofs', ['payment_id' => $payment['id'], 'mime' => $proof['mime'], 'data' => $proof['data'], 'created_at' => $now]);
            Db::update('invoices', ['status' => 'PENDING_VERIFICATION', 'updated_at' => $now], 'id = ?', [$inv['id']]);
            Audit::log($req->auth['userId'], 'payment.submit', 'Payment', $payment['id'], ['invoice' => Fmt::invoiceNo((int) $inv['seq'])]);
        });

        Notify::staff(
            'Payment awaiting confirmation',
            "{$inv['company_name']} says they paid " . Fmt::naira((int) $inv['amount_kobo']) . " for {$inv['plan_name']} (" . Fmt::invoiceNo((int) $inv['seq']) . ').',
        );
        return Response::created(Views::payment($payment + ['reject_reason' => null, 'reviewed_at' => null]));
    });

    $r->get('/me/payments', fn (Request $req) => array_map(
        [Views::class, 'payment'],
        Db::all(Views::PAYMENT_SELECT . ' WHERE pay.customer_id = ? ORDER BY pay.created_at DESC', [$cid($req)]),
    ));

    // ---- Support ------------------------------------------------------------------------

    $r->get('/me/tickets', fn (Request $req) => array_map(
        [Views::class, 'ticket'],
        Db::all('SELECT * FROM support_tickets WHERE customer_id = ? ORDER BY updated_at DESC', [$cid($req)]),
    ));

    $r->post('/me/tickets', function (Request $req) use ($cid) {
        $subject = V::str($req->body, 'subject', 3, 150);
        $body = V::str($req->body, 'body', 3, 4000);
        $customer = Db::one('SELECT * FROM customers WHERE id = ?', [$cid($req)]);
        $id = Db::id();
        $now = Clock::nowDb();
        Db::tx(function () use ($id, $customer, $subject, $body, $now, $req) {
            Db::insert('support_tickets', ['id' => $id, 'customer_id' => $customer['id'], 'subject' => $subject, 'status' => 'OPEN', 'created_at' => $now, 'updated_at' => $now]);
            Db::insert('ticket_messages', ['id' => Db::id(), 'ticket_id' => $id, 'author_id' => $req->auth['userId'], 'body' => $body, 'created_at' => $now]);
        });
        Notify::staff('New support request', "{$customer['company_name']}: $subject");
        return Response::created(Views::ticket(Db::one('SELECT * FROM support_tickets WHERE id = ?', [$id])));
    });

    $r->get('/me/tickets/{id}', function (Request $req) use ($cid) {
        $t = Db::one('SELECT * FROM support_tickets WHERE id = ? AND customer_id = ?', [$req->param('id'), $cid($req)]);
        if (!$t) throw HttpError::notFound('Ticket not found');
        return Views::ticketDetail($t);
    });

    $r->post('/me/tickets/{id}/messages', function (Request $req) use ($cid) {
        $body = V::str($req->body, 'body', 1, 4000);
        $t = Db::one('SELECT t.*, c.company_name FROM support_tickets t JOIN customers c ON c.id = t.customer_id WHERE t.id = ? AND t.customer_id = ?', [$req->param('id'), $cid($req)]);
        if (!$t) throw HttpError::notFound('Ticket not found');
        $now = Clock::nowDb();
        Db::tx(function () use ($t, $body, $now, $req) {
            Db::insert('ticket_messages', ['id' => Db::id(), 'ticket_id' => $t['id'], 'author_id' => $req->auth['userId'], 'body' => $body, 'created_at' => $now]);
            $status = in_array($t['status'], ['RESOLVED', 'CLOSED'], true) ? 'OPEN' : $t['status'];
            Db::update('support_tickets', ['status' => $status, 'updated_at' => $now], 'id = ?', [$t['id']]);
        });
        Notify::staff('Support reply', "{$t['company_name']} replied on \"{$t['subject']}\"");
        return Response::created(['ok' => true]);
    });
};

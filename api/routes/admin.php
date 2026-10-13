<?php

declare(strict_types=1);

const EXPIRING_DAYS = 7;

/**
 * Service status for every customer at once (bulk version of Views::customerOverview's logic).
 * @return array<string, array{status: string, planName: ?string, coverageEnd: ?string, daysRemaining: int, officeId: ?string}>
 */
function service_status_index(): array
{
    $now = Clock::now();
    $live = [];
    foreach (Db::all("SELECT s.customer_id, s.starts_at, s.expires_at, p.name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'ACTIVE' AND s.expires_at > ?", [Clock::db($now)]) as $s) {
        $live[$s['customer_id']][] = $s;
    }
    $had = array_flip(array_column(Db::all('SELECT DISTINCT customer_id FROM subscriptions'), 'customer_id'));

    $index = [];
    foreach (Db::all('SELECT id, status, office_id FROM customers') as $c) {
        $current = null;
        $end = null;
        foreach ($live[$c['id']] ?? [] as $s) {
            if (!$current && Clock::parse($s['starts_at']) <= $now) $current = $s;
            if (!$end || $s['expires_at'] > $end) $end = $s['expires_at'];
        }
        $days = $end ? max(0, (int) ceil(Clock::msBetween($now, Clock::parse($end)) / Fmt::DAY_MS)) : 0;
        $status = match (true) {
            $c['status'] === 'SUSPENDED' => 'SUSPENDED',
            $current !== null => $days <= EXPIRING_DAYS ? 'EXPIRING' : 'ACTIVE',
            isset($had[$c['id']]) => 'EXPIRED',
            default => 'NO_SUBSCRIPTION',
        };
        $index[$c['id']] = [
            'status' => $status,
            'planName' => $current['name'] ?? null,
            'coverageEnd' => Clock::iso($end),
            'daysRemaining' => $days,
            'officeId' => $c['office_id'],
        ];
    }
    return $index;
}

function customer_or_404(string $id): array
{
    $c = Db::one('SELECT * FROM customers WHERE id = ?', [$id]);
    if (!$c) throw HttpError::notFound('Customer not found');
    return $c;
}

function plan_input(array $b): array
{
    $description = V::opt($b, 'description', 300);
    return [
        'name' => V::str($b, 'name', 2, 60),
        'description' => $description,
        'speed' => V::str($b, 'speed', 1, 60),
        'duration_days' => V::int($b, 'durationDays', 1, 366),
        'price_kobo' => V::nairaToKobo($b, 'price'),
        'features' => json_encode(V::stringList($b, 'features', 12, 100), JSON_UNESCAPED_UNICODE),
        'is_active' => V::bool($b, 'isActive', true),
        'is_featured' => V::bool($b, 'isFeatured', false),
        'sort_order' => V::int($b, 'sortOrder', -100000, 100000, 0),
    ];
}

function office_input(array $b): array
{
    return [
        'unit' => V::str($b, 'unit', 1, 40),
        'floor' => V::opt($b, 'floor', 40),
        'block' => V::opt($b, 'block', 40),
        'notes' => V::opt($b, 'notes', 500),
    ];
}

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

return function (Router $r): void {
    $r->guard('/admin', [Auth::class, 'requireStaff']);
    $actor = fn (Request $req): string => $req->auth['userId'];

    // ======================================================================================
    // Dashboard
    // ======================================================================================

    $r->get('/admin/stats', function () {
        $index = service_status_index();
        $counts = ['ACTIVE' => 0, 'EXPIRING' => 0, 'EXPIRED' => 0, 'SUSPENDED' => 0, 'NO_SUBSCRIPTION' => 0];
        $offices = [];
        foreach ($index as $v) {
            $counts[$v['status']]++;
            if (in_array($v['status'], ['ACTIVE', 'EXPIRING'], true) && $v['officeId']) $offices[$v['officeId']] = true;
        }

        // Revenue grouped by local calendar month, last 6 months.
        $local = Clock::now()->setTimezone(Clock::local());
        $firstOfMonth = $local->setDate((int) $local->format('Y'), (int) $local->format('n'), 1)->setTime(0, 0);
        $months = [];
        for ($i = 5; $i >= 0; $i--) {
            $start = $firstOfMonth->modify("-$i months");
            $months[] = ['start' => $start, 'end' => $start->modify('+1 month')];
        }
        $paid = Db::all("SELECT amount_kobo, paid_at FROM invoices WHERE status = 'PAID' AND paid_at >= ?", [Clock::db($months[0]['start'])]);
        $revenueByMonth = array_map(function ($m) use ($paid) {
            $total = 0;
            foreach ($paid as $inv) {
                $at = Clock::parse($inv['paid_at']);
                if ($at >= $m['start'] && $at < $m['end']) $total += (int) $inv['amount_kobo'];
            }
            return ['month' => $m['start']->format('Y-m'), 'totalKobo' => $total];
        }, $months);

        $recent = Db::all(
            'SELECT pay.*, i.seq AS invoice_seq, pl.name AS plan_name, c.company_name, c.seq AS customer_seq
             FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN plans pl ON pl.id = i.plan_id JOIN customers c ON c.id = pay.customer_id
             ORDER BY pay.created_at DESC LIMIT 8',
        );

        return [
            'customers' => ['total' => count($index)] + $counts,
            'activeSubscribers' => $counts['ACTIVE'] + $counts['EXPIRING'],
            'officesConnected' => count($offices),
            'revenueThisMonthKobo' => $revenueByMonth[5]['totalKobo'],
            'revenueByMonth' => $revenueByMonth,
            'pendingPayments' => (int) Db::value("SELECT COUNT(*) FROM payments WHERE status = 'PENDING'"),
            'unpaidInvoices' => (int) Db::value("SELECT COUNT(*) FROM invoices WHERE status = 'UNPAID'"),
            'openTickets' => (int) Db::value("SELECT COUNT(*) FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS')"),
            'networkTodo' => (int) Db::value('SELECT COUNT(*) FROM network_accounts WHERE desired_enabled <> enabled'),
            'recentPayments' => array_map(fn ($p) => Views::payment($p) + [
                'customer' => Views::customerRef($p['customer_id'], $p['company_name'], (int) $p['customer_seq']),
            ], $recent),
        ];
    });

    $r->post('/admin/jobs/run', function (Request $req) use ($actor) {
        $res = Jobs::run();
        Audit::log($actor($req), 'jobs.run', 'System', null, ['expired' => $res['expired'], 'reminders' => $res['reminders']]);
        return ['expired' => $res['expired'], 'reminders' => $res['reminders']];
    });

    $r->get('/admin/audit', fn () => array_map(fn ($a) => [
        'id' => $a['id'],
        'action' => $a['action'],
        'entity' => $a['entity'],
        'entityId' => $a['entity_id'],
        'meta' => $a['meta'] ? json_decode($a['meta'], true) : null,
        'createdAt' => Clock::iso($a['created_at']),
        'actor' => $a['actor_name'] ? ['name' => $a['actor_name'], 'email' => $a['actor_email'], 'role' => $a['actor_role']] : null,
    ], Db::all('SELECT a.*, u.name AS actor_name, u.email AS actor_email, u.role AS actor_role FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200')));

    // ======================================================================================
    // Customers
    // ======================================================================================

    $r->get('/admin/customers', function (Request $req) {
        $q = $req->q('q');
        $status = $req->q('status');
        $where = '';
        $params = [];
        if ($q !== '') {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $conds = ['c.company_name LIKE ?', 'c.contact_name LIKE ?', 'c.phone LIKE ?', 'u.email LIKE ?', 'o.unit LIKE ?'];
            $params = array_fill(0, 5, $like);
            $digits = preg_replace('/^net-?/i', '', $q);
            if (ctype_digit($digits)) {
                $conds[] = 'c.seq = ?';
                $params[] = (int) $digits;
            }
            $where = ' WHERE ' . implode(' OR ', $conds);
        }
        $rows = Db::all(
            'SELECT c.*, u.email, o.unit AS office_unit, o.floor AS office_floor, o.block AS office_block, n.enabled AS net_enabled, n.desired_enabled AS net_desired
             FROM customers c JOIN users u ON u.id = c.user_id LEFT JOIN offices o ON o.id = c.office_id LEFT JOIN network_accounts n ON n.customer_id = c.id'
            . $where . ' ORDER BY c.company_name ASC',
            $params,
        );
        $index = service_status_index();
        $out = [];
        foreach ($rows as $c) {
            $service = $index[$c['id']];
            if ($status !== '' && $service['status'] !== $status) continue;
            $out[] = Views::customer($c) + [
                'service' => $service,
                'network' => $c['net_enabled'] === null ? null : ['enabled' => (bool) $c['net_enabled'], 'desiredEnabled' => (bool) $c['net_desired']],
            ];
        }
        return $out;
    });

    $r->post('/admin/customers', function (Request $req) use ($actor) {
        $b = $req->body;
        $companyName = V::str($b, 'companyName', 2, 120);
        $contactName = V::str($b, 'contactName', 2, 120);
        $email = V::email($b, 'email');
        $phone = V::str($b, 'phone', 7, 20);
        $whatsapp = V::opt($b, 'whatsapp', 20);
        $officeId = V::opt($b, 'officeId', 40);
        $notes = V::opt($b, 'notes', 2000);
        if (Db::value('SELECT id FROM users WHERE email = ?', [$email])) throw new HttpError(409, 'Already exists: email');

        $password = Fmt::tempPassword();
        $userId = Db::id();
        $customerId = Db::id();
        $now = Clock::nowDb();
        Db::tx(function () use ($userId, $customerId, $now, $email, $contactName, $phone, $password, $companyName, $whatsapp, $officeId, $notes) {
            Db::insert('users', ['id' => $userId, 'email' => $email, 'name' => $contactName, 'phone' => $phone, 'password_hash' => password_hash($password, PASSWORD_BCRYPT), 'role' => 'CUSTOMER', 'created_at' => $now, 'updated_at' => $now]);
            Db::insert('customers', ['id' => $customerId, 'user_id' => $userId, 'company_name' => $companyName, 'contact_name' => $contactName, 'phone' => $phone, 'whatsapp' => $whatsapp ?? $phone, 'office_id' => $officeId, 'notes' => $notes, 'created_at' => $now, 'updated_at' => $now]);
        });
        Audit::log($actor($req), 'customer.create', 'Customer', $customerId, ['email' => $email]);
        return Response::created(['id' => $customerId, 'tempPassword' => $password]);
    });

    $r->get('/admin/customers/{id}', function (Request $req) {
        $id = $req->param('id');
        $overview = Views::customerOverview($id);
        $invoices = Db::all(Views::INVOICE_SELECT . ' WHERE i.customer_id = ? ORDER BY i.created_at DESC', [$id]);
        return $overview + [
            'lastLoginAt' => Clock::iso(Db::value('SELECT u.last_login_at FROM customers c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [$id])),
            'subscriptions' => array_map([Views::class, 'subscription'], Db::all(Subscriptions::SELECT . ' WHERE s.customer_id = ? ORDER BY s.starts_at DESC', [$id])),
            'invoices' => array_map(fn ($i) => Views::invoice($i), $invoices),
            'payments' => array_map([Views::class, 'payment'], Db::all(Views::PAYMENT_SELECT . ' WHERE pay.customer_id = ? ORDER BY pay.created_at DESC', [$id])),
            'tickets' => array_map([Views::class, 'ticket'], Db::all('SELECT * FROM support_tickets WHERE customer_id = ? ORDER BY updated_at DESC', [$id])),
        ];
    });

    $r->patch('/admin/customers/{id}', function (Request $req) use ($actor) {
        $c = customer_or_404($req->param('id'));
        $b = $req->body;
        $set = [];
        if (V::has($b, 'companyName')) $set['company_name'] = V::str($b, 'companyName', 2, 120);
        if (V::has($b, 'contactName')) $set['contact_name'] = V::str($b, 'contactName', 2, 120);
        if (V::has($b, 'phone')) $set['phone'] = V::str($b, 'phone', 7, 20);
        if (V::has($b, 'whatsapp')) $set['whatsapp'] = V::opt($b, 'whatsapp', 20);
        if (V::has($b, 'officeId')) $set['office_id'] = V::opt($b, 'officeId', 40);
        if (V::has($b, 'notes')) $set['notes'] = V::opt($b, 'notes', 2000);
        if ($set) {
            $now = Clock::nowDb();
            Db::update('customers', $set + ['updated_at' => $now], 'id = ?', [$c['id']]);
            $userSet = array_filter(['name' => $set['contact_name'] ?? null, 'phone' => $set['phone'] ?? null]);
            if ($userSet) Db::update('users', $userSet + ['updated_at' => $now], 'id = ?', [$c['user_id']]);
        }
        Audit::log($actor($req), 'customer.update', 'Customer', $c['id'], $b);
        return ['ok' => true];
    });

    $r->post('/admin/customers/{id}/suspend', function (Request $req) use ($actor) {
        $c = customer_or_404($req->param('id'));
        $reason = V::opt($req->body, 'reason', 500);
        Db::update('customers', ['status' => 'SUSPENDED', 'updated_at' => Clock::nowDb()], 'id = ?', [$c['id']]);
        Subscriptions::syncAccess($c['id']);
        Audit::log($actor($req), 'customer.suspend', 'Customer', $c['id'], ['reason' => $reason]);
        Notify::user($c['user_id'], 'Your service has been suspended', $reason ?: 'Please contact support for details.');
        return ['ok' => true];
    });

    $r->post('/admin/customers/{id}/reactivate', function (Request $req) use ($actor) {
        $c = customer_or_404($req->param('id'));
        Db::update('customers', ['status' => 'ACTIVE', 'updated_at' => Clock::nowDb()], 'id = ?', [$c['id']]);
        Subscriptions::syncAccess($c['id']);
        Audit::log($actor($req), 'customer.reactivate', 'Customer', $c['id']);
        Notify::user($c['user_id'], 'Your service has been restored', 'Your account is active again.');
        return ['ok' => true];
    });

    $r->post('/admin/customers/{id}/reset-password', function (Request $req) use ($actor) {
        $c = customer_or_404($req->param('id'));
        $password = Fmt::tempPassword();
        Db::exec('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', [password_hash($password, PASSWORD_BCRYPT), Clock::nowDb(), $c['user_id']]);
        Audit::log($actor($req), 'customer.reset_password', 'Customer', $c['id']);
        return ['tempPassword' => $password];
    });

    // Free days (outage compensation, goodwill). Extends the latest period, or starts one.
    $r->post('/admin/customers/{id}/extend', function (Request $req) use ($actor) {
        $c = customer_or_404($req->param('id'));
        $days = V::int($req->body, 'days', 1, 366);
        $reason = V::str($req->body, 'reason', 2, 500);
        $planId = V::opt($req->body, 'planId', 40);
        $now = Clock::now();
        $latest = Db::one("SELECT * FROM subscriptions WHERE customer_id = ? AND status = 'ACTIVE' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1", [$c['id'], Clock::db($now)]);
        if ($latest) {
            $expiresAt = Clock::addDays(Clock::parse($latest['expires_at']), $days);
            Db::update('subscriptions', ['expires_at' => Clock::db($expiresAt), 'updated_at' => Clock::db($now)], 'id = ?', [$latest['id']]);
        } else {
            $planId ??= Db::value('SELECT plan_id FROM subscriptions WHERE customer_id = ? ORDER BY expires_at DESC LIMIT 1', [$c['id']]);
            if (!$planId) throw HttpError::badRequest('Choose a package for this customer’s first subscription');
            $expiresAt = Clock::addDays($now, $days);
            Db::insert('subscriptions', ['id' => Db::id(), 'customer_id' => $c['id'], 'plan_id' => $planId, 'status' => 'ACTIVE', 'starts_at' => Clock::db($now), 'expires_at' => Clock::db($expiresAt), 'created_at' => Clock::db($now), 'updated_at' => Clock::db($now)]);
        }
        Subscriptions::syncAccess($c['id']);
        Audit::log($actor($req), 'subscription.extend', 'Customer', $c['id'], ['days' => $days, 'reason' => $reason]);
        Notify::user($c['user_id'], "$days day" . ($days > 1 ? 's' : '') . ' added to your subscription', 'Your internet now runs until ' . Clock::fmtDate($expiresAt) . ". $reason");
        return ['ok' => true, 'expiresAt' => Clock::iso(Clock::db($expiresAt))];
    });

    // Switch the plan of the running period (e.g. an immediate upgrade). Billing is handled separately.
    $r->post('/admin/customers/{id}/change-plan', function (Request $req) use ($actor) {
        $planId = V::str($req->body, 'planId', 1, 40);
        $plan = Db::one('SELECT * FROM plans WHERE id = ?', [$planId]);
        if (!$plan) throw HttpError::notFound('Package not found');
        $current = Subscriptions::current($req->param('id'));
        if (!$current) throw HttpError::badRequest('This customer has no running subscription. Record a payment instead.');
        Db::update('subscriptions', ['plan_id' => $planId, 'updated_at' => Clock::nowDb()], 'id = ?', [$current['id']]);
        Audit::log($actor($req), 'subscription.change_plan', 'Subscription', $current['id'], ['from' => $current['plan_name'], 'to' => $plan['name']]);
        return ['ok' => true];
    });

    // Payment received outside the portal (cash, direct transfer). Activates immediately.
    $r->post('/admin/customers/{id}/record-payment', function (Request $req) use ($actor) {
        $c = customer_or_404($req->param('id'));
        $b = $req->body;
        $invoiceId = V::opt($b, 'invoiceId', 40);
        $planId = V::opt($b, 'planId', 40);
        $amount = V::nairaToKobo($b, 'amount', false);
        $method = V::enum($b, 'method', ['BANK_TRANSFER', 'CASH', 'POS', 'OTHER']);
        $transferRef = V::opt($b, 'transferRef', 120);
        $note = V::opt($b, 'note', 500);
        $uid = $actor($req);

        [$invoice, $sub] = Db::tx(function () use ($c, $invoiceId, $planId, $amount, $method, $transferRef, $note, $uid) {
            $now = Clock::nowDb();
            if ($invoiceId) {
                $invoice = Db::one('SELECT * FROM invoices WHERE id = ? AND customer_id = ? FOR UPDATE', [$invoiceId, $c['id']]);
                if (!$invoice) throw HttpError::notFound('Invoice not found');
                if (in_array($invoice['status'], ['PAID', 'CANCELLED'], true)) throw HttpError::badRequest('Invoice is not open');
                // Any receipt the customer uploaded for it is superseded by this confirmation.
                Db::exec("UPDATE payments SET status = 'APPROVED', reviewed_by_id = ?, reviewed_at = ? WHERE invoice_id = ? AND status = 'PENDING'", [$uid, $now, $invoice['id']]);
            } else {
                if (!$planId) throw HttpError::badRequest('Choose a package');
                $plan = Db::one('SELECT * FROM plans WHERE id = ?', [$planId]);
                if (!$plan) throw HttpError::notFound('Package not found');
                // A fresh payment replaces whatever the customer had left open.
                Db::exec("UPDATE invoices SET status = 'CANCELLED', updated_at = ? WHERE customer_id = ? AND status = 'UNPAID'", [$now, $c['id']]);
                $invoice = ['id' => Db::id(), 'customer_id' => $c['id'], 'plan_id' => $plan['id'], 'amount_kobo' => $amount ?? (int) $plan['price_kobo'], 'status' => 'UNPAID', 'created_at' => $now, 'updated_at' => $now];
                Db::insert('invoices', $invoice);
            }
            if (!(int) Db::value("SELECT COUNT(*) FROM payments WHERE invoice_id = ? AND status = 'APPROVED'", [$invoice['id']])) {
                Db::insert('payments', [
                    'id' => Db::id(), 'invoice_id' => $invoice['id'], 'customer_id' => $c['id'], 'amount_kobo' => $amount ?? (int) $invoice['amount_kobo'],
                    'method' => $method, 'status' => 'APPROVED', 'transfer_ref' => $transferRef, 'note' => $note,
                    'recorded_by_id' => $uid, 'reviewed_by_id' => $uid, 'reviewed_at' => $now, 'created_at' => $now,
                ]);
            }
            $sub = Subscriptions::activateInvoice($invoice['id'], $uid);
            Audit::log($uid, 'payment.record', 'Invoice', $invoice['id'], ['method' => $method]);
            return [Db::one(Views::INVOICE_SELECT . ' WHERE i.id = ?', [$invoice['id']]), $sub];
        });

        Subscriptions::syncAccess($c['id']);
        Notify::user(
            $c['user_id'],
            'Payment received — thank you!',
            'We received ' . Fmt::naira((int) $invoice['amount_kobo']) . " for {$invoice['plan_name']} (" . Fmt::invoiceNo((int) $invoice['seq']) . '). Your internet runs until ' . Clock::fmtDate($sub['expires_at']) . '.',
        );
        return ['ok' => true, 'expiresAt' => Clock::iso($sub['expires_at'])];
    });

    $r->post('/admin/customers/{id}/subscriptions/{subId}/cancel', function (Request $req) use ($actor) {
        $sub = Db::one('SELECT * FROM subscriptions WHERE id = ? AND customer_id = ?', [$req->param('subId'), $req->param('id')]);
        if (!$sub) throw HttpError::notFound('Subscription not found');
        Db::update('subscriptions', ['status' => 'CANCELLED', 'updated_at' => Clock::nowDb()], 'id = ?', [$sub['id']]);
        Subscriptions::syncAccess($sub['customer_id']);
        Audit::log($actor($req), 'subscription.cancel', 'Subscription', $sub['id']);
        return ['ok' => true, 'coverageEnd' => Clock::iso(Subscriptions::coverageEnd($sub['customer_id']))];
    });

    // ======================================================================================
    // Packages
    // ======================================================================================

    $r->get('/admin/plans', fn () => array_map(
        fn ($p) => Views::plan($p) + ['subscriptionCount' => (int) $p['sub_count']],
        Db::all('SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id) AS sub_count FROM plans p ORDER BY p.sort_order ASC, p.price_kobo ASC'),
    ));

    $r->post('/admin/plans', function (Request $req) use ($actor) {
        $now = Clock::nowDb();
        $row = ['id' => Db::id()] + plan_input($req->body) + ['created_at' => $now, 'updated_at' => $now];
        Db::insert('plans', $row);
        Audit::log($actor($req), 'plan.create', 'Plan', $row['id'], ['name' => $row['name']]);
        return Response::created(Views::plan(Db::one('SELECT * FROM plans WHERE id = ?', [$row['id']])));
    });

    $r->put('/admin/plans/{id}', function (Request $req) use ($actor) {
        $id = $req->param('id');
        if (!Db::value('SELECT id FROM plans WHERE id = ?', [$id])) throw HttpError::notFound('Package not found');
        $data = plan_input($req->body);
        Db::update('plans', $data + ['updated_at' => Clock::nowDb()], 'id = ?', [$id]);
        Audit::log($actor($req), 'plan.update', 'Plan', $id, ['name' => $data['name']]);
        return Views::plan(Db::one('SELECT * FROM plans WHERE id = ?', [$id]));
    });

    $r->delete('/admin/plans/{id}', function (Request $req) use ($actor) {
        $id = $req->param('id');
        if ((int) Db::value('SELECT COUNT(*) FROM invoices WHERE plan_id = ?', [$id]) || (int) Db::value('SELECT COUNT(*) FROM subscriptions WHERE plan_id = ?', [$id])) {
            throw HttpError::badRequest('This package has invoices. Hide it instead of deleting it.');
        }
        if (!Db::exec('DELETE FROM plans WHERE id = ?', [$id])) throw HttpError::notFound('Package not found');
        Audit::log($actor($req), 'plan.delete', 'Plan', $id);
        return ['ok' => true];
    });

    // ======================================================================================
    // Payments, invoices, subscriptions
    // ======================================================================================

    $r->get('/admin/payments', function (Request $req) {
        $status = V::enum($req->query, 'status', ['PENDING', 'APPROVED', 'REJECTED'], false);
        $rows = Db::all(
            'SELECT pay.*, i.seq AS invoice_seq, pl.name AS plan_name, c.company_name, c.seq AS customer_seq
             FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN plans pl ON pl.id = i.plan_id JOIN customers c ON c.id = pay.customer_id'
            . ($status ? ' WHERE pay.status = ?' : '') . ' ORDER BY pay.created_at ' . ($status === 'PENDING' ? 'ASC' : 'DESC') . ' LIMIT 300',
            $status ? [$status] : [],
        );
        return array_map(fn ($p) => Views::payment($p) + ['customer' => Views::customerRef($p['customer_id'], $p['company_name'], (int) $p['customer_seq'])], $rows);
    });

    $r->post('/admin/payments/{id}/approve', function (Request $req) use ($actor) {
        $uid = $actor($req);
        [$payment, $sub] = Db::tx(function () use ($req, $uid) {
            $p = Db::one(
                'SELECT pay.*, i.seq AS invoice_seq, pl.name AS plan_name, c.user_id FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN plans pl ON pl.id = i.plan_id JOIN customers c ON c.id = pay.customer_id WHERE pay.id = ? FOR UPDATE',
                [$req->param('id')],
            );
            if (!$p) throw HttpError::notFound('Payment not found');
            if ($p['status'] !== 'PENDING') throw HttpError::badRequest('This payment has already been reviewed');
            Db::update('payments', ['status' => 'APPROVED', 'reviewed_by_id' => $uid, 'reviewed_at' => Clock::nowDb()], 'id = ?', [$p['id']]);
            $sub = Subscriptions::activateInvoice($p['invoice_id'], $uid);
            Audit::log($uid, 'payment.approve', 'Payment', $p['id'], ['invoice' => Fmt::invoiceNo((int) $p['invoice_seq'])]);
            return [$p, $sub];
        });
        Subscriptions::syncAccess($payment['customer_id']);
        Notify::user(
            $payment['user_id'],
            'Payment confirmed — you’re connected!',
            'We confirmed ' . Fmt::naira((int) $payment['amount_kobo']) . " for {$payment['plan_name']}. Your subscription runs " . Clock::fmtDate($sub['starts_at']) . ' – ' . Clock::fmtDate($sub['expires_at']) . '.',
        );
        return ['ok' => true];
    });

    $r->post('/admin/payments/{id}/reject', function (Request $req) use ($actor) {
        $reason = V::str($req->body, 'reason', 3, 500);
        $p = Db::one('SELECT pay.*, i.seq AS invoice_seq, c.user_id FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN customers c ON c.id = pay.customer_id WHERE pay.id = ?', [$req->param('id')]);
        if (!$p) throw HttpError::notFound('Payment not found');
        if ($p['status'] !== 'PENDING') throw HttpError::badRequest('This payment has already been reviewed');
        $now = Clock::nowDb();
        Db::tx(function () use ($p, $reason, $now, $req, $actor) {
            Db::update('payments', ['status' => 'REJECTED', 'reject_reason' => $reason, 'reviewed_by_id' => $actor($req), 'reviewed_at' => $now], 'id = ?', [$p['id']]);
            Db::update('invoices', ['status' => 'UNPAID', 'updated_at' => $now], 'id = ?', [$p['invoice_id']]);
        });
        Audit::log($actor($req), 'payment.reject', 'Payment', $p['id'], ['reason' => $reason]);
        Notify::user($p['user_id'], 'We could not confirm your payment', Fmt::invoiceNo((int) $p['invoice_seq']) . ": $reason. You can submit the payment details again from your dashboard.");
        return ['ok' => true];
    });

    $r->get('/admin/invoices', function (Request $req) {
        $status = V::enum($req->query, 'status', ['UNPAID', 'PENDING_VERIFICATION', 'PAID', 'CANCELLED'], false);
        $rows = Db::all(
            'SELECT i.*, p.name AS plan_name, p.speed AS plan_speed, p.duration_days AS plan_duration_days, c.company_name, c.seq AS customer_seq
             FROM invoices i JOIN plans p ON p.id = i.plan_id JOIN customers c ON c.id = i.customer_id'
            . ($status ? ' WHERE i.status = ?' : '') . ' ORDER BY i.created_at DESC LIMIT 300',
            $status ? [$status] : [],
        );
        return array_map(fn ($i) => Views::invoice($i) + ['customer' => Views::customerRef($i['customer_id'], $i['company_name'], (int) $i['customer_seq'])], $rows);
    });

    $r->post('/admin/invoices/{id}/cancel', function (Request $req) use ($actor) {
        $inv = Db::one('SELECT * FROM invoices WHERE id = ?', [$req->param('id')]);
        if (!$inv) throw HttpError::notFound('Invoice not found');
        if ($inv['status'] === 'PAID') throw HttpError::badRequest('Paid invoices cannot be cancelled');
        $now = Clock::nowDb();
        Db::tx(function () use ($inv, $now, $req, $actor) {
            Db::update('invoices', ['status' => 'CANCELLED', 'updated_at' => $now], 'id = ?', [$inv['id']]);
            Db::exec("UPDATE payments SET status = 'REJECTED', reject_reason = 'Invoice cancelled', reviewed_by_id = ?, reviewed_at = ? WHERE invoice_id = ? AND status = 'PENDING'", [$actor($req), $now, $inv['id']]);
        });
        Audit::log($actor($req), 'invoice.cancel', 'Invoice', $inv['id']);
        return ['ok' => true];
    });

    $r->get('/admin/subscriptions', function (Request $req) {
        $filter = $req->q('filter', 'active');
        $now = Clock::now();
        $soon = Clock::addDays($now, 7);
        [$where, $params, $order] = match ($filter) {
            'expiring' => ["s.status = 'ACTIVE' AND s.expires_at > ? AND s.expires_at <= ?", [Clock::db($now), Clock::db($soon)], 'ASC'],
            'expired' => ["s.status = 'EXPIRED'", [], 'DESC'],
            'all' => ['1 = 1', [], 'DESC'],
            default => ["s.status = 'ACTIVE' AND s.expires_at > ?", [Clock::db($now)], 'ASC'],
        };
        $rows = Db::all(
            'SELECT s.*, p.name AS plan_name, p.speed AS plan_speed, p.price_kobo AS plan_price_kobo, p.duration_days AS plan_duration_days, c.company_name, c.seq AS customer_seq
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN customers c ON c.id = s.customer_id WHERE ' . $where . " ORDER BY s.expires_at $order LIMIT 300",
            $params,
        );
        return array_map(fn ($s) => Views::subscription($s) + ['customer' => Views::customerRef($s['customer_id'], $s['company_name'], (int) $s['customer_seq'])], $rows);
    });

    // ======================================================================================
    // Network access
    // ======================================================================================

    $r->get('/admin/network', function (Request $req) {
        // Make sure every customer has an access account so nobody is missing from the list.
        foreach (Db::all('SELECT c.id FROM customers c LEFT JOIN network_accounts n ON n.customer_id = c.id WHERE n.id IS NULL') as $c) {
            Subscriptions::syncAccess($c['id']);
        }
        $todoOnly = $req->q('todo') === '1';
        $rows = Db::all(
            'SELECT n.*, c.company_name, c.seq AS customer_seq, o.unit AS office_unit
             FROM network_accounts n JOIN customers c ON c.id = n.customer_id LEFT JOIN offices o ON o.id = c.office_id'
            . ($todoOnly ? ' WHERE n.enabled <> n.desired_enabled' : '') . ' ORDER BY c.company_name ASC',
        );
        $adapter = Network::adapter();
        return [
            'adapter' => ['name' => $adapter->name(), 'automatic' => $adapter->automatic()],
            'accounts' => array_map(fn ($a) => [
                'id' => $a['id'],
                'username' => $a['username'],
                'password' => $a['password'],
                'macAddresses' => Fmt::stringList($a['mac_addresses']),
                'enabled' => (bool) $a['enabled'],
                'desiredEnabled' => (bool) $a['desired_enabled'],
                'lastSyncedAt' => Clock::iso($a['last_synced_at']),
                'notes' => $a['notes'],
                'customer' => Views::customerRef($a['customer_id'], $a['company_name'], (int) $a['customer_seq']) + ['office' => $a['office_unit']],
            ], $rows),
        ];
    });

    // The admin confirms what they did on the router (or edits the access credentials).
    $r->patch('/admin/network/{id}', function (Request $req) use ($actor) {
        $id = $req->param('id');
        if (!Db::value('SELECT id FROM network_accounts WHERE id = ?', [$id])) throw HttpError::notFound();
        $b = $req->body;
        $set = [];
        if (V::has($b, 'enabled')) $set += ['enabled' => V::bool($b, 'enabled'), 'last_synced_at' => Clock::nowDb()];
        if (V::has($b, 'username')) $set['username'] = V::str($b, 'username', 3, 60);
        if (V::has($b, 'password')) $set['password'] = V::str($b, 'password', 4, 60);
        if (V::has($b, 'macAddresses')) $set['mac_addresses'] = json_encode(V::stringList($b, 'macAddresses', 20, 17, '/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/', 'invalid MAC address'));
        if (V::has($b, 'notes')) $set['notes'] = V::opt($b, 'notes', 1000);
        Db::update('network_accounts', $set + ['updated_at' => Clock::nowDb()], 'id = ?', [$id]);
        Audit::log($actor($req), 'network.update', 'NetworkAccount', $id, $b);
        return ['ok' => true];
    });

    $r->post('/admin/network/customer/{customerId}/regenerate', function (Request $req) use ($actor) {
        $account = Subscriptions::ensureNetworkAccount(customer_or_404($req->param('customerId'))['id']);
        $password = Fmt::randomPassword();
        Db::update('network_accounts', ['password' => $password, 'updated_at' => Clock::nowDb()], 'id = ?', [$account['id']]);
        Audit::log($actor($req), 'network.reset_password', 'NetworkAccount', $account['id']);
        return ['password' => $password];
    });

    // ======================================================================================
    // Offices
    // ======================================================================================

    $r->get('/admin/offices', function () {
        $byOffice = [];
        foreach (Db::all('SELECT id, company_name, seq, office_id FROM customers WHERE office_id IS NOT NULL ORDER BY company_name') as $c) {
            $byOffice[$c['office_id']][] = Views::customerRef($c['id'], $c['company_name'], (int) $c['seq']);
        }
        return array_map(fn ($o) => [
            'id' => $o['id'],
            'unit' => $o['unit'],
            'floor' => $o['floor'],
            'block' => $o['block'],
            'notes' => $o['notes'],
            'createdAt' => Clock::iso($o['created_at']),
            'customers' => $byOffice[$o['id']] ?? [],
        ], Db::all('SELECT * FROM offices ORDER BY unit ASC'));
    });

    $r->post('/admin/offices', function (Request $req) use ($actor) {
        $row = ['id' => Db::id()] + office_input($req->body) + ['created_at' => Clock::nowDb()];
        Db::insert('offices', $row);
        Audit::log($actor($req), 'office.create', 'Office', $row['id'], ['unit' => $row['unit']]);
        return Response::created($row);
    });

    $r->put('/admin/offices/{id}', function (Request $req) use ($actor) {
        $id = $req->param('id');
        if (!Db::value('SELECT id FROM offices WHERE id = ?', [$id])) throw HttpError::notFound('Office not found');
        $data = office_input($req->body);
        Db::update('offices', $data, 'id = ?', [$id]);
        Audit::log($actor($req), 'office.update', 'Office', $id, ['unit' => $data['unit']]);
        return ['id' => $id] + $data;
    });

    $r->delete('/admin/offices/{id}', function (Request $req) use ($actor) {
        if (!Db::exec('DELETE FROM offices WHERE id = ?', [$req->param('id')])) throw HttpError::notFound('Office not found');
        Audit::log($actor($req), 'office.delete', 'Office', $req->param('id'));
        return ['ok' => true];
    });

    // ======================================================================================
    // Support tickets
    // ======================================================================================

    $ticketSelect = 'SELECT t.*, c.company_name AS customer_company, c.seq AS customer_seq, c.user_id AS customer_user_id FROM support_tickets t JOIN customers c ON c.id = t.customer_id';

    $r->get('/admin/tickets', function (Request $req) use ($ticketSelect) {
        $status = V::enum($req->query, 'status', TICKET_STATUSES, false);
        return array_map(
            [Views::class, 'ticket'],
            Db::all($ticketSelect . ($status ? ' WHERE t.status = ?' : '') . ' ORDER BY t.updated_at DESC LIMIT 300', $status ? [$status] : []),
        );
    });

    $r->get('/admin/tickets/{id}', function (Request $req) use ($ticketSelect) {
        $t = Db::one($ticketSelect . ' WHERE t.id = ?', [$req->param('id')]);
        if (!$t) throw HttpError::notFound('Ticket not found');
        return Views::ticketDetail($t);
    });

    $r->post('/admin/tickets/{id}/messages', function (Request $req) use ($ticketSelect) {
        $body = V::str($req->body, 'body', 1, 4000);
        $status = V::enum($req->body, 'status', TICKET_STATUSES, false);
        $t = Db::one($ticketSelect . ' WHERE t.id = ?', [$req->param('id')]);
        if (!$t) throw HttpError::notFound('Ticket not found');
        $now = Clock::nowDb();
        Db::tx(function () use ($t, $body, $status, $now, $req) {
            Db::insert('ticket_messages', ['id' => Db::id(), 'ticket_id' => $t['id'], 'author_id' => $req->auth['userId'], 'body' => $body, 'created_at' => $now]);
            Db::update('support_tickets', ['status' => $status ?? ($t['status'] === 'OPEN' ? 'IN_PROGRESS' : $t['status']), 'updated_at' => $now], 'id = ?', [$t['id']]);
        });
        Notify::user($t['customer_user_id'], "Support replied: {$t['subject']}", mb_substr($body, 0, 200));
        return Response::created(['ok' => true]);
    });

    $r->patch('/admin/tickets/{id}', function (Request $req) use ($actor) {
        $status = V::enum($req->body, 'status', TICKET_STATUSES);
        if (!Db::update('support_tickets', ['status' => $status, 'updated_at' => Clock::nowDb()], 'id = ?', [$req->param('id')])) {
            if (!Db::value('SELECT id FROM support_tickets WHERE id = ?', [$req->param('id')])) throw HttpError::notFound('Ticket not found');
        }
        Audit::log($actor($req), 'ticket.status', 'SupportTicket', $req->param('id'), ['status' => $status]);
        return ['ok' => true];
    });

    // ======================================================================================
    // Settings & staff
    // ======================================================================================

    $r->get('/admin/settings', fn () => Settings::get());

    $r->put('/admin/settings', function (Request $req) use ($actor) {
        $saved = Settings::save($req->body);
        Audit::log($actor($req), 'settings.update', 'Setting', 'site');
        return $saved;
    }, [Auth::class, 'requireSuperAdmin']);

    $r->get('/admin/staff', fn () => array_map(fn ($u) => [
        'id' => $u['id'],
        'name' => $u['name'],
        'email' => $u['email'],
        'role' => $u['role'],
        'isActive' => (bool) $u['is_active'],
        'lastLoginAt' => Clock::iso($u['last_login_at']),
        'createdAt' => Clock::iso($u['created_at']),
    ], Db::all("SELECT * FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') ORDER BY created_at ASC")), [Auth::class, 'requireSuperAdmin']);

    $r->post('/admin/staff', function (Request $req) use ($actor) {
        $name = V::str($req->body, 'name', 2, 120);
        $email = V::email($req->body, 'email');
        $role = V::enum($req->body, 'role', ['ADMIN', 'SUPER_ADMIN']);
        if (Db::value('SELECT id FROM users WHERE email = ?', [$email])) throw new HttpError(409, 'Already exists: email');
        $password = Fmt::tempPassword();
        $id = Db::id();
        $now = Clock::nowDb();
        Db::insert('users', ['id' => $id, 'email' => $email, 'name' => $name, 'role' => $role, 'password_hash' => password_hash($password, PASSWORD_BCRYPT), 'created_at' => $now, 'updated_at' => $now]);
        Audit::log($actor($req), 'staff.create', 'User', $id, ['email' => $email, 'role' => $role]);
        return Response::created(['id' => $id, 'tempPassword' => $password]);
    }, [Auth::class, 'requireSuperAdmin']);

    $r->patch('/admin/staff/{id}', function (Request $req) use ($actor) {
        $id = $req->param('id');
        if ($id === $actor($req)) throw HttpError::badRequest('You cannot change your own access');
        $user = Db::one('SELECT * FROM users WHERE id = ?', [$id]);
        if (!$user || $user['role'] === 'CUSTOMER') throw HttpError::notFound('Staff member not found');
        $set = [];
        if (V::has($req->body, 'isActive')) $set['is_active'] = V::bool($req->body, 'isActive');
        if (V::has($req->body, 'role')) $set['role'] = V::enum($req->body, 'role', ['ADMIN', 'SUPER_ADMIN']);
        if (($set['is_active'] ?? null) === false) $set['token_version'] = (int) $user['token_version'] + 1;
        if ($set) Db::update('users', $set + ['updated_at' => Clock::nowDb()], 'id = ?', [$id]);
        Audit::log($actor($req), 'staff.update', 'User', $id, $req->body);
        return ['ok' => true];
    }, [Auth::class, 'requireSuperAdmin']);
};

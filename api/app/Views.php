<?php

declare(strict_types=1);

/** JSON shapes sent to the website. Kept in one place so customer and admin views agree. */
final class Views
{
    public const CUSTOMER_SELECT = 'SELECT c.*, u.email, o.unit AS office_unit, o.floor AS office_floor, o.block AS office_block
        FROM customers c JOIN users u ON u.id = c.user_id LEFT JOIN offices o ON o.id = c.office_id';

    public const PAYMENT_SELECT = 'SELECT pay.*, i.seq AS invoice_seq, pl.name AS plan_name
        FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN plans pl ON pl.id = i.plan_id';

    public const INVOICE_SELECT = 'SELECT i.*, p.name AS plan_name, p.speed AS plan_speed, p.duration_days AS plan_duration_days
        FROM invoices i JOIN plans p ON p.id = i.plan_id';

    public static function plan(array $p): array
    {
        return [
            'id' => $p['id'],
            'name' => $p['name'],
            'description' => $p['description'],
            'speed' => $p['speed'],
            'durationDays' => (int) $p['duration_days'],
            'priceKobo' => (int) $p['price_kobo'],
            'features' => Fmt::stringList($p['features']),
            'isActive' => (bool) $p['is_active'],
            'isFeatured' => (bool) $p['is_featured'],
            'sortOrder' => (int) $p['sort_order'],
        ];
    }

    public static function customerRef(string $id, string $companyName, int $seq): array
    {
        return ['id' => $id, 'companyName' => $companyName, 'accountNo' => Fmt::accountNo($seq)];
    }

    public static function customer(array $c): array
    {
        return [
            'id' => $c['id'],
            'accountNo' => Fmt::accountNo((int) $c['seq']),
            'companyName' => $c['company_name'],
            'contactName' => $c['contact_name'],
            'phone' => $c['phone'],
            'whatsapp' => $c['whatsapp'],
            'email' => $c['email'] ?? null,
            'status' => $c['status'],
            'notes' => $c['notes'],
            'office' => $c['office_id'] ? [
                'id' => $c['office_id'],
                'unit' => $c['office_unit'] ?? null,
                'floor' => $c['office_floor'] ?? null,
                'block' => $c['office_block'] ?? null,
            ] : null,
            'createdAt' => Clock::iso($c['created_at']),
        ];
    }

    /** Row from Subscriptions::SELECT. */
    public static function subscription(array $s): array
    {
        return [
            'id' => $s['id'],
            'status' => $s['status'],
            'startsAt' => Clock::iso($s['starts_at']),
            'expiresAt' => Clock::iso($s['expires_at']),
            'plan' => self::subscriptionPlan($s),
            'invoiceId' => $s['invoice_id'],
            'createdAt' => Clock::iso($s['created_at']),
        ];
    }

    public static function subscriptionPlan(array $s): array
    {
        return [
            'id' => $s['plan_id'],
            'name' => $s['plan_name'],
            'speed' => $s['plan_speed'],
            'priceKobo' => (int) $s['plan_price_kobo'],
            'durationDays' => (int) $s['plan_duration_days'],
        ];
    }

    /** Row from PAYMENT_SELECT (or a bare payments row). */
    public static function payment(array $p): array
    {
        return [
            'id' => $p['id'],
            'invoiceId' => $p['invoice_id'],
            'invoiceNo' => isset($p['invoice_seq']) ? Fmt::invoiceNo((int) $p['invoice_seq']) : null,
            'planName' => $p['plan_name'] ?? null,
            'amountKobo' => (int) $p['amount_kobo'],
            'method' => $p['method'],
            'status' => $p['status'],
            'senderName' => $p['sender_name'],
            'senderBank' => $p['sender_bank'],
            'transferRef' => $p['transfer_ref'],
            'hasProof' => !empty($p['proof_mime']),
            'note' => $p['note'],
            'rejectReason' => $p['reject_reason'],
            'reviewedAt' => Clock::iso($p['reviewed_at']),
            'createdAt' => Clock::iso($p['created_at']),
        ];
    }

    /** Row from INVOICE_SELECT; $payments are bare payment rows. */
    public static function invoice(array $i, ?array $payments = null): array
    {
        $out = [
            'id' => $i['id'],
            'number' => Fmt::invoiceNo((int) $i['seq']),
            'status' => $i['status'],
            'amountKobo' => (int) $i['amount_kobo'],
            'plan' => [
                'id' => $i['plan_id'],
                'name' => $i['plan_name'],
                'speed' => $i['plan_speed'],
                'durationDays' => (int) $i['plan_duration_days'],
            ],
            'paidAt' => Clock::iso($i['paid_at']),
            'createdAt' => Clock::iso($i['created_at']),
        ];
        if ($payments !== null) $out['payments'] = array_map([self::class, 'payment'], $payments);
        return $out;
    }

    public static function ticket(array $t): array
    {
        $out = [
            'id' => $t['id'],
            'number' => Fmt::ticketNo((int) $t['seq']),
            'subject' => $t['subject'],
            'status' => $t['status'],
            'createdAt' => Clock::iso($t['created_at']),
            'updatedAt' => Clock::iso($t['updated_at']),
        ];
        if (isset($t['customer_company'])) {
            $out['customer'] = self::customerRef($t['customer_id'], $t['customer_company'], (int) $t['customer_seq']);
        }
        return $out;
    }

    /** Ticket with its conversation. */
    public static function ticketDetail(array $t): array
    {
        $messages = Db::all(
            'SELECT m.id, m.body, m.created_at, u.name AS author_name, u.role AS author_role
             FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at ASC',
            [$t['id']],
        );
        return self::ticket($t) + ['messages' => array_map(fn ($m) => [
            'id' => $m['id'],
            'body' => $m['body'],
            'createdAt' => Clock::iso($m['created_at']),
            'authorName' => $m['author_name'],
            'fromStaff' => $m['author_role'] !== 'CUSTOMER',
        ], $messages)];
    }

    /** Everything the customer dashboard (and the admin's customer page header) needs. */
    public static function customerOverview(string $customerId): array
    {
        $c = Db::one(self::CUSTOMER_SELECT . ' WHERE c.id = ?', [$customerId]);
        if (!$c) throw HttpError::notFound('Customer not found');

        $now = Clock::now();
        $nowDb = Clock::db($now);
        $current = Subscriptions::current($customerId, $now);
        $end = Subscriptions::coverageEnd($customerId, $now);
        $upcoming = Db::all(Subscriptions::SELECT . " WHERE s.customer_id = ? AND s.status = 'ACTIVE' AND s.starts_at > ? ORDER BY s.starts_at ASC", [$customerId, $nowDb]);
        $last = Db::one(Subscriptions::SELECT . ' WHERE s.customer_id = ? ORDER BY s.expires_at DESC LIMIT 1', [$customerId]);
        $recent = Db::all(self::PAYMENT_SELECT . ' WHERE pay.customer_id = ? ORDER BY pay.created_at DESC LIMIT 5', [$customerId]);
        $open = Db::one(self::INVOICE_SELECT . " WHERE i.customer_id = ? AND i.status IN ('UNPAID','PENDING_VERIFICATION') ORDER BY i.created_at DESC LIMIT 1", [$customerId]);
        $network = Db::one('SELECT * FROM network_accounts WHERE customer_id = ?', [$customerId]);

        $daysRemaining = $end ? max(0, (int) ceil(Clock::msBetween($now, Clock::parse($end)) / Fmt::DAY_MS)) : 0;
        $serviceStatus = $c['status'] === 'SUSPENDED' ? 'SUSPENDED' : ($current ? 'ACTIVE' : ($last ? 'EXPIRED' : 'NO_SUBSCRIPTION'));

        return [
            'customer' => self::customer($c),
            'serviceStatus' => $serviceStatus,
            'current' => $current ? self::subscription($current) : null,
            'lastPlan' => $last ? self::subscriptionPlan($last) : null,
            'coverageEnd' => Clock::iso($end),
            'daysRemaining' => $daysRemaining,
            'upcoming' => array_map([self::class, 'subscription'], $upcoming),
            'network' => $network ? [
                'username' => $network['username'],
                'password' => $network['password'],
                'enabled' => (bool) $network['enabled'],
                'desiredEnabled' => (bool) $network['desired_enabled'],
            ] : null,
            'recentPayments' => array_map([self::class, 'payment'], $recent),
            'openInvoice' => $open ? self::invoice($open) : null,
        ];
    }
}

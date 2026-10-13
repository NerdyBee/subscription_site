<?php

declare(strict_types=1);

return function (Router $r): void {
    // Also finishes first-run setup (e.g. creates the super admin after config.php was filled in).
    $r->get('/health', function () {
        Seed::ensure();
        return ['ok' => true];
    });

    // For a cPanel cron job:  curl -s "https://your-site/api/cron?key=CRON_SECRET"
    $r->get('/cron', function (Request $req) {
        $secret = (string) Config::get('cron_secret', '');
        if ($secret === '' || !hash_equals($secret, $req->q('key'))) throw HttpError::notFound();
        Seed::ensure();
        return Jobs::run();
    });
};

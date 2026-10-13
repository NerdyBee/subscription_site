<?php

// Alternative to the cron URL for hosts where cron runs PHP directly:
//   php /home/USER/public_html/api/cron.php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/app/bootstrap.php';

Migrator::migrate();
Seed::ensure();
echo json_encode(Jobs::run()), PHP_EOL;

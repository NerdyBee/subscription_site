<?php
// Copy this file to config.php (same folder) and fill it in. config.php is never served to browsers.
return [
    // MySQL. On cPanel the database and user names carry your account prefix, e.g. "cpuser_netportal".
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'netportal',
        'user' => 'netportal_user',
        'pass' => 'change-me',
    ],

    // Two different long random strings (32+ characters). Changing them signs everyone out.
    'jwt_access_secret' => 'generate-a-long-random-string',
    'jwt_refresh_secret' => 'generate-another-long-random-string',

    // Secret for the cron URL: https://your-site/api/cron?key=THIS_VALUE ('' disables that URL).
    'cron_secret' => '',

    // First super admin. Created automatically while no super admin exists; you can blank these after.
    'seed_admin_email' => '',
    'seed_admin_password' => '',

    // 'production' hides error details; 'development' shows them.
    'env' => 'production',

    // Used to format dates in notifications and to group revenue by month.
    'timezone' => 'Africa/Lagos',
];

<?php

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');
date_default_timezone_set('UTC');

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'This app needs PHP 8.1 or newer (cPanel → Select PHP Version). Current: ' . PHP_VERSION]);
    exit;
}

// Minimal fallbacks for hosts without the mbstring extension.
if (!function_exists('mb_strlen')) {
    function mb_strlen(string $s): int { return function_exists('iconv_strlen') ? (int) iconv_strlen($s, 'UTF-8') : strlen($s); }
    function mb_substr(string $s, int $start, ?int $length = null): string { return function_exists('iconv_substr') ? (string) iconv_substr($s, $start, $length ?? PHP_INT_MAX, 'UTF-8') : substr($s, $start, $length); }
}

foreach (['Http', 'Support', 'Db', 'Auth', 'Services', 'Subscriptions', 'Views', 'Setup'] as $file) {
    require __DIR__ . "/$file.php";
}

Config::load(__DIR__ . '/../config.php');

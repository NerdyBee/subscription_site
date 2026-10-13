<?php

// Front controller: every /api/* request is routed here by api/.htaccess.

declare(strict_types=1);

$started = false;
try {
    require __DIR__ . '/app/bootstrap.php';
    $started = true;

    $router = new Router();
    foreach (['auth', 'public', 'customer', 'common', 'admin', 'system'] as $file) {
        (require __DIR__ . "/routes/$file.php")($router);
    }

    $req = Request::fromGlobals();
    // A request larger than post_max_size arrives with an empty body; say so instead of "field is required".
    $limit = ini_parse_quantity_compat((string) ini_get('post_max_size'));
    if ($limit > 0 && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) {
        throw new HttpError(413, 'The upload is too large. Please use a smaller file (under 5 MB).');
    }

    if (Migrator::migrate()) Seed::ensure();
    $res = $router->dispatch($req);

    if ($res instanceof FileResponse) {
        header('Content-Type: ' . $res->mime);
        header('Content-Length: ' . strlen($res->bytes));
        header('Cache-Control: private, max-age=3600');
        header('X-Content-Type-Options: nosniff');
        echo $res->bytes;
    } else {
        send_json($res->data, $res->status);
    }
} catch (HttpError $e) {
    send_json(['error' => $e->getMessage()], $e->status);
} catch (PDOException $e) {
    if (($e->errorInfo[1] ?? null) === 1062) {
        // Unique key violation, e.g. "Duplicate entry 'Suite B14' for key 'offices_unit'".
        $field = preg_match("/for key '(?:[^.']*\\.)?[a-z]+_([a-z_]+)'/", $e->getMessage(), $m) ? $m[1] : '';
        send_json(['error' => 'Already exists' . ($field ? ": $field" : '')], 409);
    } else {
        error_log('[api] ' . $e->getMessage());
        send_json(['error' => Config::isProd() ? 'Something went wrong' : $e->getMessage()], 500);
    }
} catch (Throwable $e) {
    error_log('[api] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $detail = !$started || !Config::isProd();
    send_json(['error' => $detail ? $e->getMessage() : 'Something went wrong'], 500);
}

// Background work after the response is sent (so the visitor doesn't wait), as a fallback for cron.
if ($started) {
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
    try {
        Jobs::runIfDue();
    } catch (Throwable $e) {
        error_log('[jobs] ' . $e->getMessage());
    }
}

/** "8M" → bytes (ini_parse_quantity only exists from PHP 8.2). */
function ini_parse_quantity_compat(string $v): int
{
    $v = trim($v);
    if ($v === '') return 0;
    $n = (int) $v;
    return match (strtolower(substr($v, -1))) {
        'g' => $n * 1024 ** 3,
        'm' => $n * 1024 ** 2,
        'k' => $n * 1024,
        default => $n,
    };
}

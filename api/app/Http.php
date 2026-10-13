<?php

declare(strict_types=1);

final class HttpError extends Exception
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }

    public static function badRequest(string $m): self { return new self(400, $m); }
    public static function unauthorized(string $m = 'Unauthorized'): self { return new self(401, $m); }
    public static function forbidden(string $m = 'Forbidden'): self { return new self(403, $m); }
    public static function notFound(string $m = 'Not found'): self { return new self(404, $m); }
}

final class Request
{
    public string $method;
    /** Path below /api, e.g. "/admin/customers/abc". */
    public string $path;
    public array $query;
    public array $body;
    /** @var array<string, string> */
    public array $params = [];
    /** Set by Auth::require(): ['userId' => ..., 'role' => ..., 'customerId' => ...] */
    public ?array $auth = null;

    public static function fromGlobals(): self
    {
        $r = new self();
        $r->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        // Everything after the first "/api" segment, so the app works whatever folder it is in.
        $r->path = preg_match('#/api(/.*)?$#', $uri, $m) ? ($m[1] ?? '/') : '/';
        $r->path = rtrim($r->path, '/') ?: '/';
        $r->query = $_GET;
        $r->body = [];
        $type = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
        if (str_contains($type, 'application/json')) {
            $raw = file_get_contents('php://input') ?: '';
            if ($raw !== '') {
                $decoded = json_decode($raw, true);
                if (!is_array($decoded)) throw HttpError::badRequest('Invalid JSON body');
                $r->body = $decoded;
            }
        } elseif ($_POST) {
            $r->body = $_POST;
        }
        return $r;
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        if (isset($_SERVER[$key])) return $_SERVER[$key];
        // Apache/CGI setups move Authorization around; see api/.htaccess.
        if ($key === 'HTTP_AUTHORIZATION') {
            if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
            if (function_exists('getallheaders')) {
                foreach (getallheaders() as $k => $v) {
                    if (strcasecmp($k, 'Authorization') === 0) return $v;
                }
            }
        }
        return null;
    }

    public function param(string $name): string
    {
        return $this->params[$name] ?? '';
    }

    public function q(string $name, string $default = ''): string
    {
        $v = $this->query[$name] ?? $default;
        return is_string($v) ? trim($v) : $default;
    }
}

final class Response
{
    public function __construct(public mixed $data, public int $status = 200)
    {
    }

    public static function created(mixed $data): self
    {
        return new self($data, 201);
    }
}

/** Raw bytes (e.g. a receipt image) instead of JSON. */
final class FileResponse
{
    public function __construct(public string $bytes, public string $mime)
    {
    }
}

final class Router
{
    /** @var list<array{string, string, callable, list<callable>}> */
    private array $routes = [];
    private array $prefixMiddleware = [];

    /** Middleware for every route whose path starts with $prefix. */
    public function guard(string $prefix, callable ...$mw): void
    {
        $this->prefixMiddleware[] = [$prefix, $mw];
    }

    public function get(string $p, callable $h, callable ...$mw): void { $this->add('GET', $p, $h, $mw); }
    public function post(string $p, callable $h, callable ...$mw): void { $this->add('POST', $p, $h, $mw); }
    public function put(string $p, callable $h, callable ...$mw): void { $this->add('PUT', $p, $h, $mw); }
    public function patch(string $p, callable $h, callable ...$mw): void { $this->add('PATCH', $p, $h, $mw); }
    public function delete(string $p, callable $h, callable ...$mw): void { $this->add('DELETE', $p, $h, $mw); }

    private function add(string $method, string $pattern, callable $handler, array $mw): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';
        $this->routes[] = [$method, $regex, $handler, $mw];
    }

    public function dispatch(Request $req): Response|FileResponse
    {
        foreach ($this->routes as [$method, $regex, $handler, $mw]) {
            if ($method !== $req->method || !preg_match($regex, $req->path, $m)) continue;
            $req->params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
            foreach ($this->prefixMiddleware as [$prefix, $list]) {
                if ($req->path === $prefix || str_starts_with($req->path, $prefix . '/')) {
                    foreach ($list as $fn) $fn($req);
                }
            }
            foreach ($mw as $fn) $fn($req);
            $result = $handler($req);
            return $result instanceof Response || $result instanceof FileResponse ? $result : new Response($result);
        }
        throw HttpError::notFound();
    }
}

/** Sends a JSON response. */
function send_json(mixed $data, int $status = 200): void
{
    http_response_code($status);
    header('Cache-Control: no-store');
    if ($status === 204) return;
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

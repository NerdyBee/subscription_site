<?php

declare(strict_types=1);

/** Thin PDO wrapper. All queries use bound parameters. */
final class Db
{
    private static ?PDO $pdo = null;
    private static int $txDepth = 0;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $c = Config::get('db');
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], (int) ($c['port'] ?? 3306), $c['name']);
            self::$pdo = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]);
            // Every DATETIME is stored and compared in UTC.
            self::$pdo->exec("SET time_zone = '+00:00'");
        }
        return self::$pdo;
    }

    /** @return list<array<string, mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute(self::normalize($params));
        return $st->fetchAll();
    }

    /** @return array<string, mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute(self::normalize($params));
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function value(string $sql, array $params = []): mixed
    {
        $st = self::pdo()->prepare($sql);
        $st->execute(self::normalize($params));
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    /** Runs a statement and returns the affected row count. */
    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute(self::normalize($params));
        return $st->rowCount();
    }

    public static function insert(string $table, array $row): void
    {
        $cols = array_keys($row);
        $sql = sprintf(
            'INSERT INTO `%s` (%s) VALUES (%s)',
            $table,
            implode(', ', array_map(fn ($c) => "`$c`", $cols)),
            implode(', ', array_fill(0, count($cols), '?')),
        );
        self::exec($sql, array_values($row));
    }

    /** UPDATE `$table` SET ... WHERE $where. Returns affected rows. */
    public static function update(string $table, array $set, string $where, array $params = []): int
    {
        if (!$set) return 0;
        $parts = array_map(fn ($c) => "`$c` = ?", array_keys($set));
        return self::exec(sprintf('UPDATE `%s` SET %s WHERE %s', $table, implode(', ', $parts), $where), [...array_values($set), ...$params]);
    }

    /** Runs $fn in a transaction (nested calls join the outer one). */
    public static function tx(callable $fn): mixed
    {
        $pdo = self::pdo();
        if (self::$txDepth > 0) {
            return $fn();
        }
        self::$txDepth++;
        $pdo->beginTransaction();
        try {
            $result = $fn();
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        } finally {
            self::$txDepth--;
        }
    }

    /** Random 24-character id (not guessable, unlike auto-increment). */
    public static function id(): string
    {
        return bin2hex(random_bytes(12));
    }

    /** IN (?, ?, ...) placeholder list. */
    public static function in(array $values): string
    {
        return implode(', ', array_fill(0, max(1, count($values)), '?'));
    }

    private static function normalize(array $params): array
    {
        return array_map(fn ($v) => is_bool($v) ? (int) $v : $v, array_values($params));
    }
}

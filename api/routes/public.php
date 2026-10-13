<?php

declare(strict_types=1);

return function (Router $r): void {
    $r->get('/public/site', fn () => Settings::get());

    $r->get('/public/plans', fn () => array_map(
        [Views::class, 'plan'],
        Db::all('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order ASC, price_kobo ASC'),
    ));
};

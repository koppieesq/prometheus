# Sizing

Limits are enforced per container with `mem_limit`. Numbers below are **estimates from configuration,
not measurements**; check reality with `prm <site> stats` and tune.

## Per-site presets (`prm new --size`)

- **small**: db buffer pool 128M (limit 384m), php-fpm 6 workers (limit 640m), nginx 96m
- **medium**: db 384M (limit 768m), php 12 workers (limit 1280m)
- **large**: db 1G (limit 1536m), php 24 workers, `dynamic` pm (limit 2560m)

Rules of thumb:
- php limit ~ `PHP_FPM_MAX_CHILDREN` x 100 MB (Drupal) or x 40-60 MB (lean frameworks).
- db limit ~ buffer pool + 200-250 MB overhead. Buffer pool should hold your hot working set.
- Limits are ceilings, not reservations. The *sum* of limits may exceed host RAM (that's the point of
  ondemand pools), but then rely on swap and watch for OOM kills.

## Host guidance

- **2 GB VPS**: edge + 1 small site. Add 2 GB swap (bootstrap does).
- **4 GB VPS**: edge + ~3 small sites, or 1 medium + 1 small.
- **8 GB VPS**: edge + ~6 small, or 2 medium + 2 small.
- Optional services add: valkey 96m, cron 384m (it runs a PHP process), ws 128m.

## Quick wins before buying a bigger box

1. Keep the microcache on, and enable Drupal's page cache + valkey (`cache` profile).
2. `PHP_OPCACHE_VALIDATE=0` (default) and restart php on deploy.
3. Lower `PHP_FPM_MAX_CHILDREN` rather than letting workers swap.
4. Put the DB on fast disk; keep `innodb_buffer_pool_size` honest.

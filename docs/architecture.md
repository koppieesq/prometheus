# Architecture and decisions

## Shape

- **edge** (one per host): Caddy. Owns 80/443. Routes by hostname to `<site>-web:80` over the external
  docker network `edge`. Handles Let's Encrypt, HTTP/3, compression (zstd/gzip), HSTS and other headers.
- **site stack** (one per site, own compose project): `web` (nginx) -> `php` (php-fpm) -> `db` (MariaDB).
  Only `web` joins `edge`. `php` and `db` live on the site's private network and cannot be reached from
  other sites.
- **profiles**: `cache` (valkey), `cron` (periodic command), `ws` (Node websocket). Tooling containers
  (`tools`: composer/drush, `node`: npm) exist only for `prm <site> composer|drush|npm`.

## Decisions

**Caddy at the edge, nginx per site.** Two proxies sounds redundant, but they do different jobs. The
shared edge gives you automatic TLS and one place to add sites without touching any stack; nginx stays
inside each stack because it is the "N" in LEMP, because PHP/Drupal nginx configs are battle-tested, and
because it lets a stack run standalone (e.g. in DDEV or CI) without Caddy. Cost: one extra local hop.

**Compression and TLS only at the edge.** nginx does not gzip; Caddy encodes once.

**Code bind-mounted, not baked.** `sites/<name>/app` is mounted read-only. Deploys are a git pull and
`prm <site> deploy`, and the same layout works for dev. If you prefer immutable images, build your own
from `images/php`, set `PHP_IMAGE`-style overrides in `compose.override.yaml` in the site dir, and drop
the app mount; the compose file does not force either.

**Uploads are the only writable path.** `FILES_PATH` (relative to the app dir) is a separate bind mount
(`sites/<name>/files`). That mount target must exist inside the read-only app mount, which is why
`prm <site> up` creates it first. If you run `docker compose` by hand, create it yourself.

**php-fpm `ondemand` by default.** Idle sites hold almost no PHP workers, which is what lets many sites
share a small host. Busy sites switch to `dynamic`/`static` via `PHP_FPM_PM`.

**Per-site MariaDB, not one shared server.** Isolation, simple backups and independent upgrades, at the
cost of ~100-250 MB resident per instance (`performance_schema` is off to help). A shared-database mode
is a reasonable future addition for hosts with many tiny sites.

**Microcache for anonymous GETs.** 5-second fastcgi cache, bypassed for any session cookie or
Authorization header. `MICROCACHE_ZONE=off` disables it. It is cheap insurance against traffic spikes
on API endpoints. Check `X-Micro-Cache` response headers when debugging.

**Secrets as files.** `db_password` / `db_root_password` are Docker secrets. Apps read
`DB_PASSWORD_FILE` (see `examples/hello`). Add your own the same way.

**Runtime config for SPAs.** `headless`/`spa` templates serve `/config.js` rendered from env, so one
frontend build works for every deployment (no baked-in URLs; a lesson from the CRA-era `REACT_APP_*`).

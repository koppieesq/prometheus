# Operations

## Backups

```sh
bin/prm blog backup                # sites/blog/backups/db-<ts>.sql.gz + files-<ts>.tar.gz, keeps newest 14
PRM_YES=1 bin/prm blog restore sites/blog/backups/db-<ts>.sql.gz
```

Nightly via systemd (adjust the path in the unit if you didn't clone to `/opt/prometheus`):

```sh
sudo cp scripts/systemd/prm-backup@.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now prm-backup@blog.timer
```

A static site (`--type static`) has no database: its backup is `backups/app-<ts>.tar.gz`, the whole of
`app/`, with the same retention. There is nothing to restore into; unpack it over `app/`.

A python site's backup is `backups/data-<ts>.tar.gz`: its `data/` directory. `app.env` holds secrets and, like
`secrets/`, is not in it; keep a copy of it somewhere safe.

**Backups on the same disk are not backups.** Set `PRM_BACKUP_HOOK` to a script that receives
`<site> <backups-dir>` and pushes offsite (restic, rclone, rsync). Test a restore on a scratch site.
Also back up `sites/<name>/secrets/` and the Caddy `caddy_data` volume (or accept re-issuing certs), and, if you
run `prm monitor`, the `prm-monitor_kuma_data` volume (or accept setting the monitors up again).

## Deploy

```sh
cd sites/blog/app && git pull
bin/prm blog composer install --no-dev
bin/prm blog deploy        # runs DEPLOY_COMMAND (e.g. drush deploy), recreates containers, restarts php
```

## Migrating an existing site in

(An old site that is only HTML files has its own command, `prm migrate-static`, with no database to dump.
See "Moving old HTML sites in" in the README.)

`prm migrate` lifts a site off another host into its own stack here:

```sh
bin/prm migrate blog blog.example.com \
  --code /backup/blog/code \
  --db   /backup/blog/db.sql.gz \
  --files /backup/blog/files
```

It creates the site and copies the codebase and uploads. It writes a `settings.prm.php` wired to
this stack's database secret, and makes sure `settings.php` includes it. Then it restores the dump,
starts everything and reloads the edge if it's running. `--db` takes either `.sql` or `.sql.gz`.
`--files` is optional.

`--code` can be a git clone, including a monorepo with Drupal in a subdirectory. `migrate` finds the
docroot (or takes `--docroot <path>`) and records the Composer project root as `PROJECT_DIR`. See
"Moving an existing Drupal multisite" in the README.

Finish with `prm <site> deploy` — the database came from somewhere else, so it still needs
`drush updatedb`, `config:import` and a cache rebuild.

### Splitting a Drupal multisite

Run it once per child site, with `--from-site` naming the child. Each becomes an ordinary,
independent prm site: its own database, uploads, container set and backup schedule, and its own PHP
version if you want one.

```sh
bin/prm migrate alpha alpha.example.com --code /var/www/drupal --from-site alpha.example.com --db alpha.sql.gz
bin/prm migrate beta  beta.example.com  --code /var/www/drupal --from-site beta.example.com  --db beta.sql.gz
```

`--from-site` is the child's site directory: a path, or its name under `<docroot>/sites/`. It's
required for a multisite. While `sites/sites.php` exists, Drupal routes each hostname to
`sites/<name>/settings.php` and never reads `sites/default/settings.php`, where prm writes its block,
so the site would keep the old host's database credentials. In the copy, `migrate` handles this:

- the child's settings files are promoted into `sites/default/`, and `sites.php` is set aside as
  `sites.php.pre-prm`
- uploads come from `<site dir>/files` (override with `--files`), and `file_public_path` is pinned
  to `sites/default/files`, where the stack mounts them
- `sites/<child>/files` becomes a symlink to them, so `/sites/<child>/files/...` links stored in
  content keep working
- the other children's uploads are dropped from the copy

The same codebase is copied into each site, so each gets an independent copy to deploy and patch.
`prm update` still patches PHP across all of them in one command.

Two things to know:

- **The old `settings.php` is overridden, not deleted.** A live codebase always ships one pointing at
  the old host's database. prm writes its settings to `settings.prm.php` and includes it at the end
  of `settings.php`. PHP takes the last assignment, so the database credentials, hash salt and
  trusted hosts become this host's, while anything else the site configured survives. If
  `settings.php` lacked the include, prm appends it and keeps the original as
  `settings.php.pre-prm`; commit the include to the repository instead. nginx refuses to serve
  `*.pre-prm` files.
- **The other children's `sites/<name>/` directories are left in place,** settings files included.
  With `sites.php` gone they are inert. Review and delete them once the migration is confirmed.

Cut DNS over only after the migrated site answers correctly on the VPS — test with a hosts-file
entry first.

## Upgrades

### Security updates: the routine

When advisories land for PHP, nginx, OpenSSL, Caddy or Drupal core, this is the whole job:

```sh
bin/prm versions               # before: what is actually running
bin/prm all backup             # cheap insurance; MariaDB may be recreated too
bin/prm update                 # every image, every site, plus the edge
# Drupal core is code, not an image: see "Drupal core" below
```

`prm update` does this, site by site:

| What | How | Needs an edit? |
|---|---|---|
| PHP (8.4.x) | pulls `php:8.4-fpm-trixie`, rebuilds `prm/php` and `prm/php-tools` | no: the tag floats to the newest 8.4.x |
| Debian libraries in the PHP image (OpenSSL, libxml2, ICU) | the Dockerfile's `apt-get upgrade`, run on each rebuild | no; see `--no-cache` below |
| nginx (1.30.x) | pulls `nginx:1.30-alpine` | no, until the series reaches end of life (see below) |
| MariaDB, Valkey, Node | pulls their tags (`11.8`, `8`, `24`) | no |
| Caddy (the edge) | pulls `caddy:2-alpine` and recreates the edge if it is running | no |
| Python sites | rebuilds on the newest `python:<version>-slim-trixie` | no |

Then it recreates only the containers whose image changed and waits until they are healthy. A site
that was **stopped stays stopped**: its images are refreshed and its next `prm <site> up` uses them.
The PHP image is compiled once per `PHP_VERSION`, not once per site. Recreating a container is a
restart of a few seconds. The edge's restart is a sub-second blip for every site.

It finishes by running `prm versions`, which reads each version from the live containers, so you
can prove the fleet is patched rather than assume it:

```
==> --- versions now running ---
SITE                 TYPE      RUNTIME          NGINX     DRUPAL
blog                 drupal    php 8.4.28       1.30.7    11.4.13
shop                 generic   php 8.4.28       1.30.7    -
brochure             static    -                1.30.7    -
bot                  python    python 3.12.12   -         -
(edge)               caddy     v2.11.8
```

`prm update` keeps going when a site fails (a pull, a build, or a container that never becomes
healthy), lists the failures at the end, and exits non-zero. Check those sites before you call the
incident closed.

**`--no-cache`.** Docker reuses the cached layer holding `apt-get upgrade` and the compiled
extensions until the PHP base image changes. A PHP release changes it, but a Debian-only fix (an
OpenSSL advisory, say) may reach Debian before the official PHP image is rebuilt. `prm update
--no-cache` rebuilds from scratch and picks it up. It takes a few minutes per `PHP_VERSION`.

**Disk.** Each refresh leaves the superseded images behind, untagged. `docker image prune` removes
them; it removes *every* dangling image on the host, so run it yourself.

**One site only:** `prm <site> pull && prm <site> build --pull && prm <site> up`.

### When the fix is in a newer series than the one you run

The floating tags only move within a series, and **a series stops moving when it reaches end of
life**. If `prm versions` still shows the old version after `prm update`, that is why.
nginx is the usual case. A new stable series (1.28, 1.30, ...) arrives each spring, and the previous
one gets no more releases: `nginx:1.28-alpine` froze at 1.28.3 in March 2026. PHP minors last
longer (see below).

To check whether a tag is still maintained, look at its last-updated date:

```sh
curl -s https://hub.docker.com/v2/repositories/library/nginx/tags/1.30-alpine | grep -o '"last_updated":"[^"]*"'
```

Then change the version:

- **Fleet-wide:** the defaults live in the compose files. Change `${NGINX_VERSION:-1.30}` in
  `stack/compose.yaml` and `stack/compose.static.yaml`, then `prm update`. Sites only override it
  if their `site.env` sets `NGINX_VERSION` (`grep NGINX_VERSION sites/*/site.env`).
- **One site:** set it in `sites/<name>/site.env` (`NGINX_VERSION=1.31`, or `PHP_VERSION=8.4.28`
  to pin an exact PHP patch: `php:8.4.28-fpm-trixie` is a real tag), then `prm update` or
  `prm <site> up`. A pinned site stops receiving patches until you move the pin, so unpin it
  afterwards.

### Drupal core

Core is in each site's `composer.lock`, not in an image, so `prm update` does not touch it.
`prm versions` shows each site's core version (read from `core/lib/Drupal.php`).

**The site's code is a git clone (the normal case).** Update the lock where you develop, then
deploy:

```sh
# in the site's repository (DDEV: ddev composer ...)
composer update "drupal/core-*" --with-all-dependencies
git commit -am "Drupal core security update" && git push

# on the VPS, per site
git -C sites/blog/app pull
bin/prm blog composer install --no-dev
bin/prm blog deploy                  # drush deploy: updatedb, config:import, cache:rebuild; restarts php
```

**The code isn't tracked in git** (e.g. the per-site copies `prm migrate` made of a multisite).
Update in place. `--type` limits `prm all` to the Drupal sites:

```sh
bin/prm all --type drupal,headless backup
bin/prm all --type drupal,headless composer update "drupal/core-*" --with-all-dependencies --no-dev
bin/prm all --type drupal,headless deploy
bin/prm versions
```

Keep the quotes around `"drupal/core-*"` so the shell doesn't expand it. `deploy` is required, not
optional: it runs the database updates, and with `PHP_OPCACHE_VALIDATE=0` php keeps serving the old
core from opcache until it restarts.

### A PHP minor version (8.4 -> 8.5)

Per site, because it can break application code: set `PHP_VERSION` in `sites/<name>/site.env`, then
`prm <site> up`. Do one site first and exercise it before the rest.

### Everything else

- **MariaDB**: bump `MARIADB_VERSION` one minor series at a time; `MARIADB_AUTO_UPGRADE` is on. Back up first.
- **nginx / valkey / Caddy** patch releases: `prm update`. Newer series: see above.
- **Host**: unattended-upgrades handles OS security patches; reboot occasionally for kernel updates.

### Running one command everywhere

`prm all <command>` runs any site command against every site — `prm all ps`, `prm all backup`,
`prm all restart`. `prm all --type drupal,headless <command>` limits it to sites of those types. Like
`update`, it does not stop at the first failure and names what failed.

## Troubleshooting

- 502 from a site: `prm <site> ps` and `prm <site> logs php web`. Is php `healthy`?
- Cert not issued: DNS must point at the host; `prm edge logs`.
- "read-only file system" on `up`: the uploads mount target is missing in the app dir; run `prm <site> up` (not raw compose).
- OOM kills: `docker stats`, lower `PHP_FPM_MAX_CHILDREN`, raise limits, or add RAM/swap.

# Prometheus

An opinionated, small, boring way to run **several PHP sites on one VPS** with Docker Compose:
**L**inux, **E**ngine-X (nginx), **M**ariaDB, **P**HP-FPM, with a shared TLS edge and a tiny CLI.

> **Status: v0.1, unproven.** Written without access to a Docker host. CI (`.github/workflows/ci.yml`)
> is the first real test; treat the first green run as the milestone. Issues and PRs welcome.

## Why "Prometheus"

[Pantheon](https://pantheon.io) showed what good Drupal hosting feels like: isolated per-site containers, a managed edge,
built-in caching, one-command deploys, backups you trust, and parity between local dev and production.
It is also proprietary. Prometheus takes those principles and hands them to everyone, as the Titan did with fire:
open source (GPL-3.0), self-hosted on a single VPS you control. The CLI is `prm`.

## Why this exists

- One container per process (no supervisord mega-image).
- A single shared **Caddy edge** owns ports 80/443 and TLS; every site is its own isolated stack behind it.
- Each site = nginx + php-fpm + MariaDB (+ optional valkey / cron / websocket), with **memory limits** so
  a noisy site can't take down its neighbours.
- Same PHP/MariaDB versions as local development with **DDEV** (see [docs/local-dev-ddev.md](docs/local-dev-ddev.md)).
- Deploys are `git pull` + `prm <site> deploy`. Backups are one command and a systemd timer.

```
                Internet
                    |  80/443 (+udp 443)
              +-----v------+       docker network "edge"
              |   caddy    |  TLS, HTTP/3, compression, security headers
              +--+-------+-+
     blog-web:80 |       | shop-web:80
        +--------v--+  +-v---------+
        |   nginx   |  |   nginx   |   per-site stacks (private "internal" network each)
        |   php-fpm |  |   php-fpm |
        |  mariadb  |  |  mariadb  |   + valkey | cron | ws  (compose profiles)
        +-----------+  +-----------+
```

## Quick start (fresh Debian/Ubuntu VPS)

```sh
git clone https://github.com/koppieesq/prometheus /opt/prometheus && cd /opt/prometheus
sudo ./scripts/bootstrap-vps.sh            # docker, ufw (22/80/443), swap, auto-updates, "edge" network
cp edge/.env.example edge/.env && $EDITOR edge/.env      # ACME email
bin/prm edge up

bin/prm new hello hello.example.com --example hello      # smoke test app
bin/prm hello up
bin/prm edge reload                                      # picks up the new site's hostname
curl https://hello.example.com/                            # expect: "db: ok", "files: ok"
```

Point DNS A/AAAA records at the VPS first, or Let's Encrypt will not issue certificates.

No VPS handy? The whole stack also comes up on a Mac under colima or Docker Desktop:
[docs/try-on-macos.md](docs/try-on-macos.md).

## Quick start 2: Drupal

Clone the project as above, and then:

```shell
bin/prm new test1 test1.localhost --type drupal

# Scaffold Drupal. `prm new` pre-creates app/web/sites/default/files and the uploads
# mount recreates it in the container, so /var/www/html is never empty and
# create-project cannot target it: build in /tmp and copy the contents up.
bin/prm test1 compose run --rm tools sh -c '
  composer create-project drupal/recommended-project /tmp/new --no-interaction
  cd /tmp/new && composer require drush/drush
  cp -a /tmp/new/. /var/www/html/
'

# Database credentials, hash salt, trusted host. Full block: examples/drupal/README.md
echo "DRUPAL_HASH_SALT=$(openssl rand -hex 32)" >> sites/test1/site.env
cp sites/test1/app/web/sites/default/default.settings.php \
   sites/test1/app/web/sites/default/settings.php
$EDITOR sites/test1/app/web/sites/default/settings.php

bin/prm test1 drush site:install          # starts the db on its own
bin/prm test1 up
bin/prm edge reload
curl -k https://test1.localhost/          # -k: the cert comes from Caddy's internal CA
```

`drupal/recommended-project` is a project *template*, so it only works through
`create-project` — `composer require`-ing it, or letting create-project default to a
`recommended-project/` subdirectory, leaves prm with no `composer.json` or docroot where
`DOCROOT=web` expects them. `deploy` comes later: it is `drush deploy` (updatedb,
config:import, cache:rebuild), which maintains a site that already exists.

## Your own site

```sh
bin/prm new blog blog.example.com --type drupal --size small
# put your code in sites/blog/app   (git clone, rsync, CI deploy...)
bin/prm blog composer install --no-dev
# first run only: wire settings.php (see examples/drupal/README.md), then install or restore
bin/prm blog drush site:install           # ...or: bin/prm blog restore db-*.sql.gz
bin/prm blog deploy                       # every deploy after that: db up -> DEPLOY_COMMAND -> up -> restart php
bin/prm edge reload
```

App types (`--type`): `generic` (front controller: Laravel, Symfony, plain PHP), `drupal`, `headless`
(SPA at `/` + PHP API + websocket at `/ws`, single origin), `spa` (static only).
Sizes (`--size`): `small` / `medium` / `large`, see [docs/sizing.md](docs/sizing.md).

## Commands

```
prm new <site> <domains> [--type T] [--size S] [--example E]
prm ls
prm edge up|down|reload|logs|ps|restart
prm <site> up|down|restart|ps|logs|stats|deploy|sh
prm <site> backup | restore <db-file.sql.gz>
prm <site> composer|drush|npm|npx ...
prm <site> exec <service> <cmd>     prm <site> compose <any docker compose args>
```

## Layout

```
bin/prm               the CLI (bash, no dependencies beyond docker + openssl)
edge/                  shared Caddy proxy (one per host); sites/<name>.caddy generated per site
stack/                 the per-site compose file, nginx/mariadb config, hardening overlay
images/php/            php-fpm image (runtime) + tools image (composer, git)
scripts/               VPS bootstrap, systemd backup timer
examples/              hello (smoke test), drupal, headless-spa (Rail Baron shape)
sites/                 per-site state: app/, files/, secrets/, backups/, site.env (gitignored)
docs/                  architecture, sizing, operations, local dev, trying it on macOS
```

## Security notes

- Only Caddy publishes ports. `bootstrap-vps.sh` enables ufw, but **Docker bypasses ufw for published
  ports**, so never add `ports:` to a site's services.
- DB passwords are generated per site into `sites/<name>/secrets/` and passed as Docker secrets, not env vars.
- App code is mounted **read-only** into nginx and php-fpm; only the uploads dir is writable.
- `PRM_HARDENED=1` drops all Linux capabilities except those each image needs (opt-in until CI has proven it).
- Security headers and HSTS are set at the edge, one place for every site.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

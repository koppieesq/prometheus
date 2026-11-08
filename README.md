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

One command, from nothing to an installed Drupal 11 site served over HTTPS:

```shell
bin/prm edge up          # once per host
bin/prm demo demo1
curl -k https://demo1.localhost/
```

`prm demo <name>` is a smoke test, not a deploy path. It takes a single name and derives
everything else from it: the site is `<name>`, the domain is `<name>.localhost`, the type is
`drupal`. It scaffolds `drupal/recommended-project` plus drush, generates a hash salt and a
`settings.php` wired to the stack's database secret, runs `drush site:install`, starts the
containers and reloads the edge. It takes a minute or two — each site has its own composer
cache volume, so a new demo always downloads Drupal afresh — and prints the URL and the admin
login when it is done.

The certificate comes from Caddy's internal CA, so `curl` needs `-k` and a browser will warn
until you trust that CA ([docs/try-on-macos.md](docs/try-on-macos.md)).

The admin password is `admin`; override it with `PRM_DEMO_PASS`. Never point this at a real
domain. To remove the site, run `bin/prm rm demo1`.

For a site you intend to keep, see [examples/drupal/README.md](examples/drupal/README.md) and
"Your own site" below: the same steps, but with your own repository in `sites/<name>/app`.

## Your own site

```sh
git clone git@github.com:you/blog.git sites/blog/app   # first: git refuses a non-empty directory
bin/prm new blog blog.example.com --type drupal --size small
bin/prm blog composer install --no-dev
# first run only: write settings.prm.php (see examples/drupal/README.md), then install or restore
bin/prm blog drush site:install           # ...or: bin/prm blog restore db-*.sql.gz
bin/prm blog deploy                       # every deploy after that: db up -> DEPLOY_COMMAND -> up -> restart php
bin/prm edge reload
```

App types (`--type`): `generic` (front controller: Laravel, Symfony, plain PHP), `drupal`, `headless`
(SPA at `/` + PHP API + websocket at `/ws`, single origin), `spa` (static only).
Sizes (`--size`): `small` / `medium` / `large`, see [docs/sizing.md](docs/sizing.md).

## Moving an existing Drupal multisite into Docker on the same VPS

`prm migrate` imports one existing site into its own stack. Run it once per multisite child and each
child becomes an ordinary prm site with its own database, uploads, containers and backups. The old
setup keeps serving until the cutover at the end, and rolling back means starting the old web server
again.

The examples use a child `alpha` served at `alpha.example.com`, with its site directory at
`web/sites/alpha.example.com` in a live codebase at `/var/www/drupal`. Repeat steps 2-4 for every child.

### 1. Install Docker without breaking the host

`scripts/bootstrap-vps.sh` is written for a **fresh** VPS. On a host that is already in service, read it
first: it enables ufw with only SSH, 80 and 443 open, which would cut off anything else the box
serves (mail, a non-22 SSH port, remote MySQL). Either run it with the correct `SSH_PORT`, knowing
that, or install Docker yourself and run `docker network create edge`. Then:

```sh
cp edge/.env.example edge/.env && $EDITOR edge/.env      # ACME email
```

Don't run `prm edge up` yet. Your current web server owns ports 80/443.

### 2. Dump the child's database

```sh
mkdir -p /root/prm-stage
mysqldump --single-transaction --routines --triggers alpha_db | gzip > /root/prm-stage/alpha.sql.gz
```

### 3. Migrate

Run `migrate` with `sudo`. A live Drupal tree normally belongs to `www-data` and its settings files
are often readable only by that user. `migrate` checks this before it creates anything and says
which file it couldn't read. Afterwards, hand the site to the user that deploys it (here `deploy`,
a member of the `docker` group). From then on that user runs `prm` without `sudo`. The uploads stay
with `www-data`, which php-fpm runs as:

```sh
sudo bin/prm migrate alpha alpha.example.com,www.alpha.example.com --size small \
  --code      /var/www/drupal \
  --from-site /var/www/drupal/web/sites/alpha.example.com \
  --db        /root/prm-stage/alpha.sql.gz
sudo chown -R deploy: sites/alpha && sudo chown -R 33:33 sites/alpha/files
bin/prm alpha composer install --no-dev   # only if vendor/ isn't in the codebase (a git clone)
bin/prm alpha deploy                      # updatedb, config:import, cache rebuild
```

`prm <site> composer` and `prm <site> npm` run as whoever owns `app/`, because they write into the
code (`vendor/`, `node_modules/`, build output). `drush` and `deploy` run as `www-data`, because
Drupal writes into the uploads. `prm rm` needs `sudo` here, because the uploads aren't the deploy
user's.

`--code` is the multisite codebase on the host. It's only read: `migrate` works on its own copy.
`--from-site` is the child's site directory on the host, given as a path or as its name under
`<docroot>/sites/`. Drupal ignores `sites/default/settings.php` while `sites/sites.php` exists, so in
the copy `migrate` does the following:

- It promotes the child to the default site: the child's `settings.php`, `services.yml` and
  any other files it includes are copied into `sites/default/`, and `sites.php` is set aside as
  `sites.php.pre-prm`.
- It takes uploads from `<site dir>/files` unless `--files` says otherwise, and pins
  `file_public_path` to `sites/default/files`, where the stack mounts them.
- It symlinks `sites/<child>/files` to `sites/default/files`, so links stored in content as
  `/sites/alpha.example.com/files/...` keep working.
- It drops the other children's uploads from the copy. They would otherwise be duplicated into
  every site.

Private files (`file_private_path`) aren't migrated. `migrate` warns if the site uses them.

**Where `migrate` writes its settings.** The hosting settings (database, hash salt, trusted hosts) go
into `sites/default/settings.prm.php`. Each host gets its own copy, which is never committed.
`settings.php` only needs this at its end, so these settings win:

```php
if (file_exists($app_root . '/' . $site_path . '/settings.prm.php')) {
  include $app_root . '/' . $site_path . '/settings.prm.php';
}
```

If that include isn't there, `migrate` appends it and keeps the original as `settings.php.pre-prm`.
Commit the include to the site's repository, and later `git pull`s in `sites/<name>/app` stay
clean. When the copy is a git checkout, `migrate` adds `settings.prm.php` and `*.pre-prm` to
`.git/info/exclude`. A config sync directory the site sets itself is kept.

**A codebase in its own repository, or a monorepo.** Clone it anywhere and pass the clone as
`--code`. The copy includes `.git`, so `sites/<name>/app` becomes a working clone, and later deploys
are `git pull` + `prm <name> deploy`. `vendor/` usually isn't in git, so run
`bin/prm <name> composer install --no-dev` before `deploy`. In a monorepo, `migrate` finds Drupal
in a subdirectory such as `kands-d10/web` by itself. If there's more than one, choose with
`--docroot`. It records the Composer project root (the nearest `composer.json` above the docroot) as
`PROJECT_DIR` in `site.env`. `composer`, `drush`, `deploy` and cron all run there.

`migrate` ends by saying the edge isn't running yet. That's expected until the cutover. If a
migration fails part-way, `sudo bin/prm rm alpha` deletes everything it created, and you can run it
again.

**A frontend on its own domain.** A decoupled frontend, such as a React app on `example.com` that
reads from Drupal on `cms.example.com`, is a second site of type `spa`. Give it its own clone of the
repository; a sparse checkout keeps only the frontend:

```sh
git clone --sparse git@github.com:you/monorepo.git sites/front/app   # before `prm new`
git -C sites/front/app sparse-checkout set frontend
bin/prm new front example.com --type spa
sed -i 's|^SPA_ROOT=.*|SPA_ROOT=frontend/build|' sites/front/site.env     # the build output, under app/
bin/prm front npm --prefix frontend ci && bin/prm front npm --prefix frontend run build
bin/prm front up
```

Build-time settings, such as Create React App's `.env.production`, are baked in by `npm run build`.
`NODE_VERSION` in `site.env` picks the Node image that builds it (default 24).

Each child runs its own MariaDB and PHP-FPM,
so pick `--size` with [docs/sizing.md](docs/sizing.md) and the VPS's total memory in mind.

### 4. Test it before the cutover

The site is already reachable on the docker network, so you can test it without touching ports 80/443:

```sh
docker run --rm --network edge curlimages/curl -sI -H 'Host: alpha.example.com' http://alpha-web/
bin/prm alpha drush status
```

Expect a `200` and drush reporting a connected database.

### 5. Cut over, one site at a time

The host's web server keeps ports 80/443 until the last site has moved, so sites can move one at a
time. While that's the case, publish each migrated site's web container on a **loopback** port, which
nothing outside the VPS can reach. Then point the host web server's vhost for that domain at it,
keeping its existing certificate. Choose a free port per site:

```yaml
# sites/alpha/compose.override.yaml - transition only, deleted at the final switch
services:
  web:
    ports: ["127.0.0.1:8081:80"]
```

```nginx
# host nginx: replaces the old vhost's root/PHP handling for alpha.example.com
location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Apply it with `bin/prm alpha up && sudo nginx -t && sudo systemctl reload nginx`. Drupal trusts
the forwarded protocol, so it still builds `https://` links. To roll a site back, restore its old vhost.

To move a site's content, freeze it, then take a final dump and load it:

```sh
drush -r /var/www/drupal/web -l alpha.example.com state:set system.maintenance_mode 1   # old site
mysqldump --single-transaction --routines --triggers alpha_db | gzip > /root/prm-stage/alpha-final.sql.gz
bin/prm alpha restore /root/prm-stage/alpha-final.sql.gz && bin/prm alpha deploy
bin/prm alpha drush state:set system.maintenance_mode 0                                  # new site
```

**When the last site has moved,** hand the ports to the edge. First give anything else the host web
server still fronts a home: another app or an API on a subdomain. Then remove the loopback ports and
switch. DNS already points at this VPS, so Caddy gets Let's Encrypt certificates on the first request:

```sh
rm sites/*/compose.override.yaml && bin/prm all up            # if the overrides held only the ports
sudo systemctl stop nginx && sudo systemctl disable nginx    # or apache2
bin/prm edge up
```

To roll back: `bin/prm edge down && sudo systemctl enable --now nginx`, with the overrides restored.

### 6. Clean up after the new setup is confirmed

- Remove the old host's `drush cron` crontab entries. Each stack runs its own cron.
- Stop the host's MySQL/MariaDB and PHP-FPM once nothing needs them.
- Schedule backups: [docs/operations.md](docs/operations.md).

**Deploying afterwards**, e.g. from CI over SSH as the deploy user:

```sh
cd /opt/prometheus
git -C sites/alpha/app fetch origin main && git -C sites/alpha/app reset --hard origin/main
bin/prm alpha composer install --no-dev --no-interaction
bin/prm alpha deploy
```

`settings.prm.php` and the uploads aren't tracked, so `reset --hard` leaves them alone.

## Commands

```
prm new <site> <domains> [--type T] [--size S] [--example E]
prm demo <name>                     throwaway Drupal site on <name>.localhost
prm ls
prm rm <site>                       delete a site: containers, volumes, files, edge route
prm all <command> [args]            run a site command against every site
prm update                          pull, rebuild and restart every site; report PHP versions
prm migrate <site> <domains> --code <dir> --db <dump> [--files <dir>] [--from-site <dir>]
            [--docroot <path>] [--size S]
prm edge up|down|reload|logs|ps|restart
prm <site> up|down|restart|ps|logs|stats|deploy|sh
prm <site> backup | restore <db-file.sql.gz>
prm <site> composer|drush|npm|npx ...  composer/npm run as app/'s owner, drush as www-data
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
  ports**, so never add `ports:` to a site's services. The one exception is a loopback-only port
  (`127.0.0.1:...`) while the host's own web server still fronts a site during a migration.
- DB passwords are generated per site into `sites/<name>/secrets/` and passed as Docker secrets, not env vars.
- App code is mounted **read-only** into nginx and php-fpm; only the uploads dir is writable.
- `PRM_HARDENED=1` drops all Linux capabilities except those each image needs (opt-in until CI has proven it).
- Security headers and HSTS are set at the edge, one place for every site.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

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

**Backups on the same disk are not backups.** Set `PRM_BACKUP_HOOK` to a script that receives
`<site> <backups-dir>` and pushes offsite (restic, rclone, rsync). Test a restore on a scratch site.
Also back up `sites/<name>/secrets/` and the Caddy `caddy_data` volume (or accept re-issuing certs).

## Deploy

```sh
cd sites/blog/app && git pull
bin/prm blog composer install --no-dev
bin/prm blog deploy        # runs DEPLOY_COMMAND (e.g. drush deploy), recreates containers, restarts php
```

## Upgrades

### A PHP security patch (8.4.27 -> 8.4.28)

This is the common case, and it needs **no change to any site.env**: the patch ships inside the same
`php:8.4-fpm-bookworm` tag the image already builds from.

```sh
bin/prm update        # every site: pull new base images, rebuild, recreate, then report versions
```

It finishes with what each site is actually running, so you can prove the fleet is patched rather
than assume it:

```
==> --- versions now running ---
blog                 php 8.4.28
shop                 php 8.4.28
```

One site at a time is `prm <site> pull && prm <site> up`. A bare `prm <site> up` usually suffices —
buildkit re-resolves the base tag against the registry on each build — but `update` passes `--pull`
so it does not depend on that.

`prm update` keeps going when a site fails, lists the failures at the end, and exits non-zero. Check
those sites before you call the incident closed.

### A PHP minor version (8.4 -> 8.5)

Per site, because it can break application code: set `PHP_VERSION` in `sites/<name>/site.env`, then
`prm <site> up`. Do one site first and exercise it before the rest.

### Everything else

- **MariaDB**: bump `MARIADB_VERSION` one minor series at a time; `MARIADB_AUTO_UPGRADE` is on. Back up first.
- **nginx / valkey**: `prm <site> pull && prm <site> up`, or fleet-wide with `prm update`.
- **Host**: unattended-upgrades handles OS security patches; reboot occasionally for kernel updates.

### Running one command everywhere

`prm all <command>` runs any site command against every site — `prm all ps`, `prm all backup`,
`prm all restart`. Like `update`, it does not stop at the first failure and names what failed.

## Troubleshooting

- 502 from a site: `prm <site> ps` and `prm <site> logs php web`. Is php `healthy`?
- Cert not issued: DNS must point at the host; `prm edge logs`.
- "read-only file system" on `up`: the uploads mount target is missing in the app dir; run `prm <site> up` (not raw compose).
- OOM kills: `docker stats`, lower `PHP_FPM_MAX_CHILDREN`, raise limits, or add RAM/swap.

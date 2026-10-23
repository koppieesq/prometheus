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

- **PHP**: set `PHP_VERSION` in site.env, then `prm <site> up` (rebuilds the image tag for that version).
- **MariaDB**: bump `MARIADB_VERSION` one minor series at a time; `MARIADB_AUTO_UPGRADE` is on. Back up first.
- **Host**: unattended-upgrades handles OS security patches; reboot occasionally for kernel updates.

## Troubleshooting

- 502 from a site: `prm <site> ps` and `prm <site> logs php web`. Is php `healthy`?
- Cert not issued: DNS must point at the host; `prm edge logs`.
- "read-only file system" on `up`: the uploads mount target is missing in the app dir; run `prm <site> up` (not raw compose).
- OOM kills: `docker stats`, lower `PHP_FPM_MAX_CHILDREN`, raise limits, or add RAM/swap.

# Trying Prometheus on macOS (colima / Docker Desktop)

Prometheus is built to run on a Linux VPS. You can still bring the whole stack up on a Mac to kick
the tires — the edge, a site, TLS, the smoke test — without renting a server.

This is **not** the recommended way to develop a site. For day-to-day work on an individual site,
use DDEV: [local-dev-ddev.md](local-dev-ddev.md). This page is for exercising Prometheus itself.

## Prerequisites

- [colima](https://github.com/abiosoft/colima) (`brew install colima docker docker-compose`) or
  Docker Desktop. `colima start` is enough; the defaults are fine.
- The repo must live somewhere the Docker VM shares with the host — under `$HOME` for colima's
  default mount. Every site mount (`app/`, `files/`, `secrets/`) is a bind mount from this checkout.
- Skip `scripts/bootstrap-vps.sh`. It is Debian/Ubuntu only (apt, ufw, swapfile, unattended-upgrades)
  and has nothing to do on macOS.

## Never run `prm` with sudo

On macOS the Docker daemon lives inside a VM, and that VM shares your files **as your user** —
colima's virtiofs daemon runs as you, Docker Desktop's sharing works the same way. Files you own
show up inside the VM as root-owned and everything works. Files owned by *root on the host* are
unreadable by the daemon.

So `sudo bin/prm new ...` produces a site that cannot start:

```
Error response from daemon: invalid mount config for type "bind":
stat .../sites/<name>/secrets/db_password: permission denied
```

`prm new` creates `secrets/` as `0700` on purpose. Owned by you, that is fine. Owned by root, the
daemon cannot stat it. `prm new` refuses to run as root off Linux for this reason.

The same uid mapping is why `prm new` reports `could not chown files/ to uid 33; made it
world-writable instead` here: only root can chown to another uid, and you are not root. The message
is expected on macOS and nothing needs fixing. On Linux that `0777` is what lets php-fpm (uid 33 in
the container) write uploads; on a Docker-VM host it is belt and braces, because the share does not
enforce its own permission bits — the VM's virtiofs mount defers to the daemon on the host, which
runs as you, so any container uid can already write anywhere in the share.

If you already created a site with sudo, remove it and start over — there is nothing in it worth
saving:

```sh
bin/prm <name> down -v
sudo rm -rf sites/<name>
bin/prm new <name> ...        # no sudo
```

## Use `*.localhost` hostnames

There is no public DNS pointing at your laptop, so Let's Encrypt cannot issue a certificate. Give
the site a `.localhost` hostname instead: Caddy recognises those as local and issues from its own
internal CA automatically, with no Caddyfile change. macOS resolves `anything.localhost` to
`127.0.0.1`, so no `/etc/hosts` edit either.

## Bring it up

```sh
cp edge/.env.example edge/.env && $EDITOR edge/.env     # ACME_EMAIL is still required, unused locally
bin/prm edge up

bin/prm new hello hello.localhost --example hello       # no sudo
bin/prm hello up --wait
bin/prm edge reload

curl -k https://hello.localhost/        # expect: db: ok, files: ok, https-seen: on
```

`-k` because the certificate comes from Caddy's internal CA, which nothing trusts yet. To drop the
warning in browsers, add that CA to your login keychain:

```sh
docker run --rm -v prm-edge_caddy_data:/data alpine \
  cat /data/caddy/pki/authorities/local/root.crt > /tmp/caddy-local-ca.crt
sudo security add-trusted-cert -d -k /Library/Keychains/System.keychain /tmp/caddy-local-ca.crt
```

(That `sudo` is fine — it touches the keychain, not this repo.)

## Port 80/443 conflicts

The edge publishes 80, 443 and 443/udp on the host. DDEV's router wants the same ports, so stop it
first:

```sh
ddev poweroff
```

## Teardown

```sh
bin/prm hello down -v      # containers, volumes, the site's network
bin/prm edge down
sudo rm -rf sites/hello    # only if you created it as root; otherwise plain rm -rf
```

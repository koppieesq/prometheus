# Monitoring with Uptime Kuma

`prm monitor` runs [Uptime Kuma](https://github.com/louislam/uptime-kuma) on the host, on a hostname of your choosing.
It can check what a visitor sees (HTTP, certificates) and whether every container is running and healthy,
grouped by site.

## Set it up

Point a hostname's DNS at the host (an `A` record for `status.example.com`, say), then:

```sh
cp monitor/.env.example monitor/.env && $EDITOR monitor/.env    # MONITOR_DOMAIN=status.example.com
bin/prm monitor up
```

`up` starts Kuma, writes `edge/sites/_monitor.caddy` and reloads the edge. Caddy gets the certificate on the
first request.

**Open the dashboard right away and create the admin account.** Until an account exists, whoever opens the page
first gets to create it. Choose SQLite when it asks for a database; it is the lighter option and plenty for one host.
Then run `bin/prm monitor sync` (next section) to add every site.

## Add every site: `prm monitor sync`

```sh
bin/prm monitor sync --dry-run    # what it would add, without logging in
bin/prm monitor sync              # asks for your Kuma username and password
```

`sync` logs in to Kuma the way its web UI does and makes sure it has:

- a Docker host, `prometheus`, at `http://docker-api:2375` (see [below](#the-docker-host));
- for each site, a **Group** named after its first hostname, containing
  - an **HTTP(s)** monitor on `https://<hostname>/`, which also warns before the certificate expires. A python
    app may have nothing at `/`, so for one any answer below 500 counts as up: the edge answers 502 when it is not;
  - an **HTTP(s)** monitor for each path another site serves on that hostname with `prm route`, e.g.
    `koplowiczandsons.com/chat/`, with the same any-answer rule;
  - a **Docker Container** monitor for each of the site's containers. It is down when the container stops or its
    healthcheck reports it unhealthy, and pending while Docker restarts it, so a crash loop shows as a monitor
    flapping between pending and down;
- a group `edge` for Caddy's container.

For example:

```
koplowiczandsons.com
├─ koplowiczandsons.com          HTTP(s)
├─ koplowiczandsons.com/chat/    HTTP(s), any answer below 500
└─ kands-react-web-1             Docker Container
koppiebot.koplowiczandsons.com
├─ koppiebot.koplowiczandsons.com   HTTP(s), any answer below 500
└─ koppiebot-app-1                  Docker Container
edge
└─ prm-edge-caddy-1              Docker Container
```

It only adds. A group or monitor that already exists, by name, is left exactly as it is, so run it again after
`prm new` and it adds just the new site; edit or delete monitors in Kuma as you like. New monitors check every
60 seconds, retry once before alerting, and get the notifications marked **Default enabled** in Kuma.

The credentials are read from the terminal, or from `PRM_KUMA_USER` and `PRM_KUMA_PASSWORD`, and are passed to
Kuma on stdin, never on a command line. An account with 2FA also needs `PRM_KUMA_TOKEN` set to a current code.

Containers are named `<site>-<service>-1`; `bin/prm <site> ps` lists a site's:

| Site type | Containers |
|---|---|
| Drupal / generic | `<site>-web-1`, `<site>-php-1`, `<site>-db-1`, plus `-cron-1`, `-valkey-1`, `-ws-1` if their profiles are on |
| static | `<site>-web-1` |
| python | `<site>-app-1` |
| edge | `prm-edge-caddy-1` |

To check what a page says rather than that it answers, edit its HTTP monitor in Kuma into **HTTP(s) - Keyword**,
for example `koplowiczandsons.com/chat/hello` with a 60-second timeout.

## The Docker host

`http://docker-api:2375` is a socket proxy, not the Docker socket itself, and it only answers read-only container
queries. Kuma can see whether a container is running and healthy, but it cannot start, stop or exec into anything,
or read images, volumes or secrets. The proxy sits on a private network that only Kuma joins, so no site
container can reach it, and that network has no route to the internet.

A group is down when any monitor in it is. Add a **notification** (email, Slack, ntfy...) under Settings, and
tick it on the groups.

Kuma is on the `edge` network too, so it can also check a site from the inside: an HTTP monitor on
`http://<site>-web/` (or `http://<site>-web:8000/` for a python site) skips DNS and TLS. That tells a broken
site apart from a broken edge.

## What it can't tell you

**A monitor on the same host can't report that the host is down.** Add at least one check from outside: another
Kuma elsewhere, or any hosted uptime service, on one URL per site.

## Operations

```sh
bin/prm monitor logs --tail 50
bin/prm monitor down        # stops it and removes the route; monitors and history stay in the kuma_data volume
bin/prm monitor up          # back, as it was
```

`prm update` pulls Kuma's and the proxy's images with everything else, and recreates them if they were running.
Back up the `prm-monitor_kuma_data` volume (monitors, history, accounts) along with the edge's `caddy_data`, or
accept setting the monitors up again.

The container is limited to 512 MB. Raise `MONITOR_MEM_LIMIT` in `monitor/.env` if you add hundreds of monitors.

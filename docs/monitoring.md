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

## Connect it to Docker

In Kuma: **Settings → Docker Hosts → Setup Docker Host**, connection type **TCP / HTTP**, URL
`http://docker-api:2375`.

That is a socket proxy, not the Docker socket itself, and it only answers read-only container queries.
Kuma can see whether a container is running and healthy, but it cannot start, stop or exec into anything,
or read images, volumes or secrets. The proxy sits on a private network that only Kuma joins, so no site
container can reach it, and that network has no route to the internet.

## Monitors, grouped by site

Containers are named `<site>-<service>-1`:

| Site type | Containers |
|---|---|
| Drupal / generic | `<site>-web-1`, `<site>-php-1`, `<site>-db-1`, plus `-cron-1`, `-valkey-1`, `-ws-1` if their profiles are on |
| static | `<site>-web-1` |
| python | `<site>-app-1` |
| edge | `prm-edge-caddy-1` |

`bin/prm <site> ps` lists a site's containers. For each site, create a **Group** monitor, then add to it:

- an **HTTP(s)** monitor on the site's public URL, which also warns before its certificate expires. Use
  **HTTP(s) - Keyword** to check a page's contents, e.g. a python app's endpoint returning a known answer;
- a **Docker Container** monitor per container, on the `docker-api` host. It is down when the container stops
  or its healthcheck reports it unhealthy, and pending while Docker is restarting it, so a crash loop shows as
  a monitor flapping between pending and down.

For example:

```
koplowiczandsons.com (group)
├─ https://koplowiczandsons.com/              HTTP(s)
├─ https://koplowiczandsons.com/chat/hello    HTTP(s) - Keyword, 60s timeout
├─ kands-react-web-1                          Docker Container
└─ koppiebot-app-1                            Docker Container
```

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

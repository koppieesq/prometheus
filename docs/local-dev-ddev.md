# Local development with DDEV

Production runs this stack; local development stays on [DDEV](https://ddev.com). Keep the versions in
lockstep so "works on my machine" means something.

- DDEV `php_version` <-> `PHP_VERSION` (8.4)
- DDEV `database` mariadb `11.8` <-> `MARIADB_VERSION`
- DDEV `webserver_type: nginx-fpm` <-> the nginx templates in `stack/nginx/apps/` (same Drupal rules)
- DDEV `docroot` <-> `DOCROOT`

Example `.ddev/config.yaml` for a Drupal 11 site (the Rail Baron one is the same shape):

```yaml
name: mysite
type: drupal11
docroot: web
php_version: "8.4"
webserver_type: nginx-fpm
database: { type: mariadb, version: "11.8" }
composer_version: "2"
```

Workflow: develop in DDEV, push to git, then on the VPS `git pull && prm <site> deploy`.
Data flows **down** (restore a prod `db-*.sql.gz` into DDEV with `ddev import-db`), code flows **up**.
Never push a local database to production.

For a Vite frontend, run `ddev npm run dev` locally and expose the port with `web_extra_exposed_ports`.

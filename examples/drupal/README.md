# Drupal 11

```sh
bin/prm new blog blog.example.com --type drupal
git clone git@github.com:you/blog.git sites/blog/app     # repo root contains composer.json and web/
bin/prm blog composer install --no-dev
bin/prm blog up
bin/prm edge reload
```

Then in `web/sites/default/settings.php` (or a `settings.prm.php` include):

```php
$databases['default']['default'] = [
  'driver' => 'mysql',
  'host' => getenv('DB_HOST'), 'port' => getenv('DB_PORT'),
  'database' => getenv('DB_NAME'), 'username' => getenv('DB_USER'),
  'password' => trim(file_get_contents(getenv('DB_PASSWORD_FILE'))),
  'prefix' => '', 'collation' => 'utf8mb4_general_ci',
  'init_commands' => ['isolation_level' => 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED'],
];
$settings['hash_salt'] = getenv('DRUPAL_HASH_SALT'); // generate once: openssl rand -base64 48
$settings['trusted_host_patterns'] = ['^blog\.example\.com$'];
$settings['reverse_proxy'] = TRUE;
$settings['reverse_proxy_addresses'] = [$_SERVER['REMOTE_ADDR']];
$settings['file_private_path'] = '/var/www/html/private'; // add a mount if you use private files
```

`DRUPAL_HASH_SALT` goes in `sites/<name>/site.env`. Only the keys named in `stack/compose.yaml`'s
`x-php-env` block reach the container — `site.env` is compose's `--env-file`, which supplies
variables for substitution in the compose file, not environment for the services.

Valkey: install `drupal/redis` and set `$settings['redis.connection']['host'] = getenv('REDIS_HOST');`.
Cron: the `cron` profile runs `vendor/bin/drush cron` every 15 minutes; disable Drupal's automated_cron.

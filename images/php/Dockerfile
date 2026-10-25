# syntax=docker/dockerfile:1
ARG PHP_VERSION=8.4

# ---- runtime: what production runs ------------------------------------------
FROM php:${PHP_VERSION}-fpm-bookworm AS runtime

ADD --chmod=0755 https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
RUN apt-get update \
 && apt-get install -y --no-install-recommends libfcgi-bin \
 && install-php-extensions pdo_mysql mysqli gd intl mbstring zip opcache apcu redis bcmath exif \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY conf.d/ /usr/local/etc/php/conf.d/
COPY php-fpm.d/zz-prm.conf /usr/local/etc/php-fpm.d/zz-prm.conf
COPY prm-cron /usr/local/bin/prm-cron

WORKDIR /var/www/html
# php-fpm master starts as root and drops to www-data (uid 33) per pool.

# ---- tools: composer, git, drush-friendly extras (never runs as a service) ----
FROM runtime AS tools
RUN apt-get update \
 && apt-get install -y --no-install-recommends git unzip default-mysql-client \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
# COMPOSER_HOME is a named volume; a fresh volume inherits this directory's
# ownership from the image, so www-data can actually write the cache.
RUN mkdir -p /tmp/composer && chown www-data:www-data /tmp/composer
USER www-data

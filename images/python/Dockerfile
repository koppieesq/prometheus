# Runtime for `--type python` sites. Only requirements.txt comes from the site (the `site` build
# context, see stack/compose.python.yaml); the code itself is bind-mounted at run time.
ARG PYTHON_VERSION=3.12
# -trixie pins the Debian under Python, as images/php does: a new Debian release is a deliberate change here.
FROM python:${PYTHON_VERSION}-slim-trixie

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH=/opt/venv/bin:$PATH

RUN python -m venv /opt/venv

COPY --from=site requirements.txt /tmp/requirements.txt
# a requirements file with nothing but comments is allowed
RUN if grep -qE '^[[:space:]]*[^#[:space:]]' /tmp/requirements.txt; then pip install -r /tmp/requirements.txt; fi

# the same uid as php-fpm, so a site's data/ directory is owned the same way for every type
USER www-data

# Headless: Drupal API + Vite SPA + websocket (Rail Baron shape)

[koppieesq/rail-baron](https://github.com/koppieesq/rail-baron) is Drupal 11 (`backend/`), a React app
(`frontend/`) and a Node websocket server (`ws-server/`). On this stack:

```
sites/rb/app/
  backend/     Drupal (docroot backend/web)
  frontend/    Vite app, built to frontend/dist
  ws-server/   node server.js listening on :3000, accepting connections at /ws
```

```sh
bin/prm new rb rb.example.com --type headless
git clone <rail-baron repo> sites/rb/app
bin/prm rb composer install --no-dev --working-dir=backend
bin/prm rb npm --prefix frontend ci
bin/prm rb npm --prefix frontend run build
bin/prm rb npm --prefix ws-server ci --omit=dev
bin/prm rb up && bin/prm edge reload
```

What changes in the app, and why:

- **Same origin.** nginx serves the SPA at `/`, Drupal under `BACKEND_PATHS` (`/jsonapi`, `/user`, `/admin` ...),
  and the websocket at `/ws`. Drop the `Access-Control-Allow-Origin: *` headers; call the API with relative URLs.
  If a SPA route collides with a backend prefix (e.g. `/user`), override `BACKEND_PATHS` in site.env.
- **Runtime config.** Replace `REACT_APP_*` build-time vars with `window.__CONFIG__` from `/config.js`
  (add `<script src="/config.js"></script>` to `index.html`; set `PUBLIC_API_BASE` in site.env).
- **Vite instead of CRA.** CRA is deprecated. Vite outputs hashed files in `dist/assets/`, which the template
  caches for a year. Env vars become `import.meta.env.VITE_*`, but prefer `window.__CONFIG__` for anything
  deployment-specific.
- **Websocket server.** Must listen on `PORT` (3000) and accept the `/ws` path (e.g. `new WebSocketServer({ server, path: '/ws' })`).
- **No Kubernetes, no supervisord.** `k8s/`, `docker/supervisord.conf` and the single-image `Dockerfile` are not needed.

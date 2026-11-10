# Python apps on Prometheus

How to move a Python service, using [koppiebot](https://github.com/koppieesq/koppiebot) (a FastAPI
retrieval-augmented chatbot behind a headless blog) as the example. For what `--type python` is and does, see the
README. These steps assume koppiebot reads its data directory from `DATA_DIR` (it used to write
`embeddings.csv` next to its code, which is read-only here).

## 1. Create the site

```sh
cd /opt/prometheus        # or wherever it lives
git clone git@github.com:koppieesq/koppiebot.git sites/koppiebot/app     # before `prm new`: git refuses a non-empty dir
bin/prm new koppiebot koppiebot.example.com --type python --size medium
$EDITOR sites/koppiebot/app.env
```

`app.env` is the environment the old `.env` file held, minus the TLS settings (Caddy terminates TLS now, so
`CERT_FILE_PATH` and `KEY_FILE_PATH` go away):

```dotenv
OPENAI_API_KEY=sk-...
ALLOW_ORIGINS=https://example.com
DATA_DIR=/data
```

`--size medium` gives the container 1 GB: pandas, scipy and the embeddings are held in memory, and re-embedding
with langchain needs more than serving does. Watch `prm koppiebot stats` and adjust `APP_MEM_LIMIT`.

The default command, `uvicorn main:app --host 0.0.0.0 --port 8000`, is what koppiebot needs. `main.py` only reads
the certificate paths under `if __name__ == "__main__"`, which uvicorn does not execute.

## 2. Build the knowledge base, then start it

koppiebot loads `embeddings.csv` when it starts, so build it first. `run` builds the image if needed and runs the
command in it, with `data/` mounted:

```sh
bin/prm koppiebot run python embed.py --url https://d10.example.com/export --primary body
bin/prm koppiebot up --wait
```

Whenever the blog changes, re-embed and restart (the app reads the file once, at start):

```sh
bin/prm koppiebot run python embed.py --url https://d10.example.com/export --primary body
bin/prm koppiebot restart
```

## 3. Test it before the cutover

```sh
docker run --rm --network edge curlimages/curl -s http://koppiebot-web:8000/chat/hello
```

## 4. Serve it

**On its own hostname.** Already done by `prm new`: Caddy answers `koppiebot.example.com` once the edge is up.
The browser calls it from another origin, so `ALLOW_ORIGINS` must name the site's origin.

**On the frontend's own hostname, with no CORS.** Serve `/chat/*` of the frontend's domain from the bot, and point
the frontend at its own origin:

```sh
bin/prm route koppiebot /chat --on kands-react      # kands-react is the frontend's site name
```

`/chat/*` is exactly the bot's path; it does not capture a frontend route like `/chatbot`. `prm rm koppiebot`
removes the route again.

## 5. Cut over from the old service

The old service listens on a public port 8000 with its own certificate. Once the new one answers:

```sh
sudo systemctl disable --now koppiebot
```

That closes port 8000 to the internet, which nothing else should need.

**While the host's nginx still owns 80/443**, the edge can't serve the domain yet. As for any prm site, publish the
app on a loopback port and let the host's nginx proxy to it:

```yaml
# sites/koppiebot/compose.override.yaml - transition only
services:
  app:
    ports: ["127.0.0.1:8082:8000"]
```

```nginx
# in koppiebot.example.com's server block, and, for same-origin use, in the frontend's:
location /chat/ {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;      # each answer is an OpenAI round trip
}
```

`location /chat/` matches paths under `/chat/` only, so the frontend's `/chatbot` page is unaffected. Skip
`prm route` in this phase: it configures the edge, which isn't serving yet. Do it at the final switch.

## Not covered

- **Rate limiting.** Anyone who can reach `/chat/<question>` spends your OpenAI credit. Caddy's core has no rate
  limiter; set a monthly spend limit on the OpenAI key, or limit in the app.
- **Query logs.** Questions travel in the URL path, so they appear in the edge's access log.

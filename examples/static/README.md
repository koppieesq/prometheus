# static

A site with nothing but files, served by nginx alone: no PHP, no database.

```sh
bin/prm new brochure brochure.example.com --type static --example static
bin/prm brochure up
bin/prm brochure exec web wget -qO- http://127.0.0.1/
```

Expected output includes `static: ok`. To bring an existing HTML site in, see
`prm migrate-static` in the README.

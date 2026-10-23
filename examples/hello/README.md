# hello

Smallest possible app, used by CI and as a first-run check:

```sh
bin/prm new hello hello.example.com --example hello
bin/prm hello up
bin/prm hello exec web wget -qO- http://127.0.0.1/
```

Expected output includes `db: ok` and `files: ok`.

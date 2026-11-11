# python

A Python service with one pinned dependency, served without nginx, PHP or a database.

```sh
bin/prm new py py.example.com --type python --example python --command "python main.py"
echo EXAMPLE_SECRET=hunter2 > sites/py/app.env
bin/prm py up --wait
bin/prm py exec -T app python -c "import urllib.request as u; print(u.urlopen('http://127.0.0.1:8000/x').read().decode())"
```

Expected output includes `python: ok`, `deps: ok`, `data: ok` and `secret: set`.

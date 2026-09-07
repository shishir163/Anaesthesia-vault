#!/usr/bin/env python3
"""Bundle src/ files into a single self-contained index.html."""
import pathlib

root = pathlib.Path(__file__).parent
shell = (root/'src/shell.html').read_text(encoding='utf-8')
css   = (root/'src/style.css').read_text(encoding='utf-8')
db    = (root/'src/db.js').read_text(encoding='utf-8')
app   = (root/'src/app.js').read_text(encoding='utf-8')

out = shell.replace('__CSS__', css).replace('__JS__', db + "\n\n" + app)
(root/'index.html').write_text(out, encoding='utf-8')
print(f"built index.html ({len(out)} bytes)")

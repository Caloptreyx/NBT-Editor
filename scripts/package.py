#!/usr/bin/env python3
"""Build the release zip, dist/dev_caloptreyx_nbteditor.c7s.zip, from the repository.

The zip has the layout `panel-rs extensions export` produces: `Metadata.toml`, the crate under
`backend/` and `frontend/` (package.json and src). Directory entries come first, then
files, both in sorted order.
"""

import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist", "dev_caloptreyx_nbteditor.c7s.zip")

# (path in the repository, path in the zip)
FILES = [
    ("Metadata.toml", "Metadata.toml"),
    ("Cargo.toml", "backend/Cargo.toml"),
    ("LICENSE", "backend/LICENSE"),
    ("README.md", "backend/README.md"),
    (".gitignore", "backend/.gitignore"),
    ("frontend/package.json", "frontend/package.json"),
]
TREES = [("src", "backend/src"), ("frontend/src", "frontend/src")]


def collect():
    files = list(FILES)
    for source, target in TREES:
        for current, subdirs, names in os.walk(os.path.join(ROOT, source)):
            subdirs.sort()
            rel = os.path.relpath(current, os.path.join(ROOT, source)).replace(os.sep, "/")
            for name in sorted(names):
                inner = name if rel == "." else f"{rel}/{name}"
                files.append((f"{source}/{inner}", f"{target}/{inner}"))
    dirs = sorted({arc.rsplit("/", i)[0] + "/" for _, arc in files for i in range(1, arc.count("/") + 1)})
    return dirs, files


def main():
    dirs, files = collect()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for arc in dirs:
            zf.writestr(arc, "")
        for source, arc in files:
            zf.write(os.path.join(ROOT, *source.split("/")), arc)
    print(f"{os.path.relpath(OUT, ROOT)}: {len(dirs)} directories, {len(files)} files, "
          f"{os.path.getsize(OUT)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

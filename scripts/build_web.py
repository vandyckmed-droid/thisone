#!/usr/bin/env python3
"""
Fold data/ into web/index.template.html and write a single self-contained page.

The web edition exists because the page is published as a Claude Artifact,
whose Content-Security-Policy blocks every external request -- no fetch to
raw.githubusercontent.com, no logo CDN, nothing. So unlike the Snack, which
pulls data/ from `main` at runtime, this page carries its data inside itself:
refreshing it means rebuilding the table, rerunning this script, and
republishing the artifact.

Usage:
    python3 scripts/build_web.py [output.html]   (default: web/top300.html)
"""

import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "web" / "index.template.html"
DATA = ROOT / "data"


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "web" / "top300.html"

    index = json.loads((DATA / "index.json").read_text())
    tables = {}
    for universe in index["universes"]:
        path = DATA / universe["file"]
        table = json.loads(path.read_text())
        # The index already names and sizes every universe; make the table
        # self-describing the same way app/src/data.js does after a fetch.
        table.setdefault("title", universe.get("title", universe["key"]))
        table.setdefault("scope", universe.get("scope", "all"))
        table.setdefault("universeSize", len(table["tickers"]))
        tables[universe["key"]] = table

    payload = json.dumps({"index": index, "tables": tables}, separators=(",", ":"))
    # "</script>" inside a string literal would end the inline script early.
    payload = payload.replace("</", "<\\/")

    built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ")

    html = TEMPLATE.read_text()
    for marker, value in (("/*__DATA__*/", payload), ("/*__BUILT__*/", json.dumps(built))):
        if marker not in html:
            print(f"{marker} missing from {TEMPLATE}", file=sys.stderr)
            return 1
        html = html.replace(marker, value, 1)

    out.write_text(html)
    print(f"Wrote {out} ({out.stat().st_size:,} bytes, "
          f"{len(tables)} universes, data date {tables['all']['dataDate']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

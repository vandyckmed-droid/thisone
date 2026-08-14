#!/usr/bin/env python3
"""
Fold data/ into web/index.template.html and write a single self-contained page.

The page is published as a Claude Artifact, whose Content-Security-Policy
blocks every external request -- no fetch to raw.githubusercontent.com, no
logo CDN, nothing. So the page carries everything it shows: the tables from
data/, and the logos from web/logos.json (run scripts/fetch_logos.py to fill
that cache). Refreshing the app means rebuilding the table, rerunning this
script, and republishing the artifact to the same URL.

Usage:
    python3 scripts/build_web.py [output.html]   (default: web/top300.html)
"""

import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "web" / "index.template.html"
LOGOS = ROOT / "web" / "logos.json"
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

    # Base64 WebP keyed by symbol, minus the ones that could never be fetched --
    # a null would only be tested for at render time, and the page already draws
    # a letter tile for any symbol the map does not carry.
    opaque = []
    if LOGOS.exists():
        cache = json.loads(LOGOS.read_text())
        logos = {k: v for k, v in cache["logos"].items() if v}
        # Logos baked onto their own background fill the tile; transparent
        # marks sit inset on it.
        opaque = [s for s in cache.get("opaque", []) if s in logos]
    else:
        logos = {}
        print(f"warning: no {LOGOS.relative_to(ROOT)} -- run scripts/fetch_logos.py "
              f"or the page ships with letter tiles only", file=sys.stderr)

    built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ")

    html = TEMPLATE.read_text()
    for marker, value in (("/*__DATA__*/", payload),
                          ("/*__LOGOS__*/", json.dumps(logos, separators=(",", ":"))),
                          ("/*__OPAQUE__*/", json.dumps(opaque, separators=(",", ":"))),
                          ("/*__BUILT__*/", json.dumps(built))):
        if marker not in html:
            print(f"{marker} missing from {TEMPLATE}", file=sys.stderr)
            return 1
        html = html.replace(marker, value, 1)

    out.write_text(html)
    print(f"Wrote {out} ({out.stat().st_size / 1024 / 1024:.1f}MB, "
          f"{len(tables)} universes, {len(logos)} logos, "
          f"data date {tables['all']['dataDate']})")
    # The artifact host rejects anything over 16MB, and the failure arrives at
    # publish time rather than here.
    if out.stat().st_size > 15 * 1024 * 1024:
        print("warning: within 1MB of the 16MB artifact limit", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

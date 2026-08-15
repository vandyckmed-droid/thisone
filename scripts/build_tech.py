#!/usr/bin/env python3
"""
Fold data/sectors/technology.json into web/tech.template.html.

A standalone companion to the main app: one sector, ranked by 12-1 momentum,
with the residual model built from the sector's own constituents rather than an
ETF -- which is only possible because every constituent's history is here.

Everything the page shows is carried inside it, like the main artifact, since
the host blocks outbound requests.

Usage:
    python3 scripts/build_tech.py [output.html]   (default: web/tech100.html)
"""

import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "web" / "tech.template.html"
SECTOR = ROOT / "data" / "sectors" / "technology.json"
LOGOS = ROOT / "web" / "logos.json"


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "web" / "tech100.html"
    table = json.loads(SECTOR.read_text())

    payload = {
        "dates": table["dates"],
        "dataDate": table["dataDate"],
        # Short keys: this is 100 companies times ~585 closes, and the field
        # names would otherwise outweigh some of the data.
        "tickers": [
            {"s": t["symbol"], "n": t["name"], "i": t.get("industry", ""),
             "cap": t["marketCap"], "h": t["history"]}
            for t in table["tickers"]
        ],
        "market": table["benchmarks"]["market"]["history"],
    }

    cache = json.loads(LOGOS.read_text()) if LOGOS.exists() else {"logos": {}, "opaque": []}
    wanted = {t["symbol"] for t in table["tickers"]}
    logos = {k: v for k, v in cache["logos"].items() if k in wanted and v}
    opaque = [s for s in cache.get("opaque", []) if s in logos]

    built = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ")

    html = TEMPLATE.read_text()
    for marker, value in (
        # "</script>" inside a string literal would close the block early.
        ("/*__DATA__*/", json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")),
        ("/*__LOGOS__*/", json.dumps(logos, separators=(",", ":"))),
        ("/*__OPAQUE__*/", json.dumps(opaque, separators=(",", ":"))),
        ("/*__BUILT__*/", json.dumps(built)),
    ):
        if marker not in html:
            print(f"{marker} missing from {TEMPLATE.name}", file=sys.stderr)
            return 1
        html = html.replace(marker, value, 1)

    out.write_text(html)
    size = out.stat().st_size
    print(f"Wrote {out} ({size / 1024 / 1024:.2f}MB, {len(payload['tickers'])} companies, "
          f"{len(logos)} logos, data date {table['dataDate']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Fetch every company logo once and cache it into web/logos.json.

The web edition is published as a Claude Artifact, whose Content-Security-Policy
blocks every external request -- so a logo cannot be loaded from a CDN at view
time the way the phone app loads it. It has to already be inside the page.

Each logo is therefore fetched here, trimmed of its transparent margin, fitted
into a 96px box (the 46pt detail tile at 2x, so it is sharp everywhere the app
draws it) and re-encoded as WebP, which halves PNG for this kind of art. The
result is base64 in web/logos.json, keyed by symbol, and committed -- so a data
refresh reuses the cache and only fetches symbols it has never seen.

Issuers supply two incompatible kinds of art: a transparent mark, which wants
to sit inset on the app's dark tile, and a square logo baked onto its own
opaque background -- usually white -- which inset would punch a bright hole
through the list. So each cached logo is also classified, and the opaque ones
are listed under "opaque" for the page to draw edge-to-edge, filling the tile
like an app icon rather than floating in it. The test runs over the cache, so
it costs no network and reclassifies everything on every run.

Usage:
    python3 scripts/fetch_logos.py [--refresh] [--workers 12]

    --refresh   re-fetch every logo instead of only the missing ones
"""

import argparse
import base64
import glob
import io
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / "web" / "logos.json"

BOX = 96          # 46pt detail tile at 2x; the 30pt row tile is a downscale
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
ATTEMPTS = 3


def universe_files() -> list[Path]:
    index = json.loads((DATA / "index.json").read_text())
    return [DATA / u["file"] for u in index["universes"]]


def wanted_logos() -> dict[str, str]:
    """Every symbol in every universe, mapped to its logo URL."""
    out: dict[str, str] = {}
    for path in universe_files():
        for ticker in json.loads(path.read_text())["tickers"]:
            url = ticker.get("logo")
            if url:
                out.setdefault(ticker["symbol"], url)
    return out


def encode(raw: bytes) -> str | None:
    """Trim, fit into BOX, and re-encode as WebP. None if it is not an image."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return None

    img = img.convert("RGBA")

    # FMP art often carries a wide transparent margin, which in a 30px tile
    # leaves the mark itself tiny. Cropping to the visible pixels lets every
    # logo fill the same square. Fully opaque art has no margin to find, and
    # getbbox on the alpha channel simply returns the whole image.
    bbox = img.getchannel("A").getbbox()
    if bbox and bbox != (0, 0, img.width, img.height):
        img = img.crop(bbox)

    img.thumbnail((BOX, BOX), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=82, method=6)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def is_opaque(encoded: str) -> bool:
    """Is this logo baked onto its own background rather than transparent?

    Read off the cached WebP, so reclassifying never re-fetches. A handful of
    stray soft pixels along an antialiased edge should not count as a
    background, hence a share rather than a minimum.
    """
    try:
        img = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
    except Exception:
        return False
    alpha = img.getchannel("A")
    solid = sum(count for value, count in enumerate(alpha.histogram()) if value >= 250)
    return solid / (img.width * img.height) >= 0.97


def fetch(item: tuple[str, str]) -> tuple[str, str | None]:
    symbol, url = item
    for attempt in range(ATTEMPTS):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return symbol, encode(resp.read())
        except urllib.error.HTTPError as exc:
            # A missing logo is a fact about the company, not a transient
            # failure; the page falls back to a letter tile for it.
            if exc.code in (403, 404):
                return symbol, None
        except Exception:
            pass
    return symbol, None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()

    wanted = wanted_logos()
    stored = json.loads(CACHE.read_text()) if CACHE.exists() and not args.refresh else {}
    cached = stored.get("logos", stored) if isinstance(stored, dict) else {}

    todo = [(s, u) for s, u in wanted.items() if s not in cached]
    print(f"{len(wanted)} symbols, {len(cached)} cached, {len(todo)} to fetch")

    if todo:
        done = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for symbol, encoded in pool.map(fetch, todo):
                # A failure is cached as null too, so a rerun does not spend
                # another round trip discovering the same missing logo.
                cached[symbol] = encoded
                done += 1
                if done % 100 == 0 or done == len(todo):
                    print(f"  {done}/{len(todo)}")

    # Symbols that have dropped out of every universe are dead weight in a file
    # that ships inside the page.
    kept = {s: cached[s] for s in sorted(wanted) if s in cached}
    dropped = len(cached) - len(kept)

    opaque = sorted(s for s, v in kept.items() if v and is_opaque(v))

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"logos": kept, "opaque": opaque},
                                separators=(",", ":"), sort_keys=True))

    have = sum(1 for v in kept.values() if v)
    weight = sum(len(v) for v in kept.values() if v)
    print(f"Wrote {CACHE.relative_to(ROOT)}: {have}/{len(kept)} logos "
          f"({len(opaque)} opaque, {have - len(opaque)} transparent), "
          f"{weight / 1024 / 1024:.1f}MB base64"
          + (f", dropped {dropped} stale" if dropped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())

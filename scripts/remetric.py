#!/usr/bin/env python3
"""
Recompute every derived metric in data/ from the history already committed.

The pipeline is the definition of these numbers, but running it means refetching
the whole universe from FMP and lands a new data date. When only the *formulas*
change -- returns losing their skip, momentum becoming a ratio -- none of that is
wanted: the prices are already here, in each ticker's `history`, aligned to the
file's shared calendar.

So this imports the pipeline's own functions and replays them over the existing
files. One definition of momentum, in build_snapshot.py, applied two ways.

Validation and the atomic write are kept: every file is recomputed and checked
in memory, and nothing is written unless all of them pass, so a bad formula
leaves the published data exactly where it was.

Usage:
    python3 scripts/remetric.py [--check]

    --check   report what would change and write nothing
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_snapshot import (  # noqa: E402
    MOM_WINDOWS, TRADING_DAYS_PER_YEAR, WINDOWS,
    annualised_vol, max_drawdown, momentum, pct_change, window_ratio,
    write_atomically, ytd_change, _round,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Fields the old formulas produced that no longer exist. Left in place they
# would be a second, contradictory answer to questions the app now asks of the
# view it is showing.
RETIRED = ("momentumReturns", "momentumScore", "riskAdjusted1y", "ranks")


def recompute(table: dict) -> tuple[dict, list[str]]:
    """A copy of `table` with every derived metric rebuilt from its history."""
    calendar = table["dates"]
    notes: list[str] = []
    rows = []

    for ticker in table["tickers"]:
        row = {k: v for k, v in ticker.items() if k not in RETIRED}
        dated = [(d, c) for d, c in zip(calendar, ticker["history"]) if c is not None]
        closes = [c for _, c in dated]
        if not closes:
            notes.append(f"{ticker['symbol']}: no history")
            rows.append(row)
            continue

        returns = {label: pct_change(closes, n) for label, n in WINDOWS.items()}
        returns["ytd"] = ytd_change(dated)
        row["returns"] = {k: _round(v) for k, v in returns.items()}
        row["momWindows"] = {
            f"{n}-{skip}": _round(window_ratio(closes, n, skip), 3)
            for n, skip in MOM_WINDOWS
        }
        row["volatility"] = {
            "30d": _round(annualised_vol(closes, 30)),
            "90d": _round(annualised_vol(closes, 90)),
            "1y": _round(annualised_vol(closes, TRADING_DAYS_PER_YEAR)),
        }
        row["maxDrawdown1y"] = _round(max_drawdown(closes, TRADING_DAYS_PER_YEAR))
        row["mom"] = _round(momentum(closes), 3)
        rows.append(row)

    out = {k: v for k, v in table.items() if k not in ("skip", "momentum", "tickers")}
    out["mom"] = {
        "windows": [{"sessions": n, "skip": skip} for n, skip in MOM_WINDOWS],
        "measure": "annualised return / annualised volatility, averaged",
    }
    out["tickers"] = rows
    return out, notes


def check(table: dict, path: Path) -> list[str]:
    """Refuse to publish a table the new formulas clearly broke."""
    errors = []
    rows = table["tickers"]
    scored = [t for t in rows if t.get("mom") is not None]

    # Momentum needs 250 sessions plus the skip, so a young listing having none
    # is expected -- the whole table having none is a broken formula.
    if len(scored) < len(rows) * 0.5:
        errors.append(f"{path.name}: only {len(scored)}/{len(rows)} tickers scored a momentum")
    # Deliberately loose. A genuine 30-bagger annualises into a ratio in the
    # 20s -- SNDK does exactly that -- while the failure this guards against,
    # dividing by a volatility rounded to nothing, lands in the thousands.
    for t in rows:
        if t.get("mom") is not None and not -100 < t["mom"] < 100:
            errors.append(f"{path.name}: {t['symbol']} momentum {t['mom']} out of range")
        if t["returns"].get("1y") is not None and not -100 <= t["returns"]["1y"] < 10000:
            errors.append(f"{path.name}: {t['symbol']} 1y return {t['returns']['1y']}% out of range")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    index = json.loads((DATA / "index.json").read_text())
    paths = [DATA / u["file"] for u in index["universes"]]

    rebuilt: list[tuple[Path, dict]] = []
    errors: list[str] = []
    for path in paths:
        table, notes = recompute(json.loads(path.read_text()))
        errors.extend(check(table, path))
        for note in notes:
            print(f"  {path.name}: {note}")
        rebuilt.append((path, table))

    if errors:
        print("REMETRIC FAILED:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        print("data left untouched", file=sys.stderr)
        return 1

    top = rebuilt[0][1]
    scored = [t for t in top["tickers"] if t.get("mom") is not None]
    best = max(scored, key=lambda t: t["mom"])
    print(f"{len(rebuilt)} tables recomputed, {len(scored)}/{len(top['tickers'])} "
          f"scored in {top['title']}, best {best['symbol']} at {best['mom']}")

    if args.check:
        print("--check: nothing written")
        return 0

    for path, table in rebuilt:
        write_atomically(str(path), table)
    print(f"Wrote {len(rebuilt)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())

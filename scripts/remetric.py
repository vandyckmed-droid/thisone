#!/usr/bin/env python3
"""
Recompute every derived metric in data/ from the history already committed.

The pipeline is the definition of these numbers, but running it means refetching
the whole universe from FMP and lands a new data date. When only the *formulas*
change -- returns losing their skip, a field being retired -- none of that is
wanted: the prices are already here, in each ticker's `history`, aligned to the
file's shared calendar.

So this imports the pipeline's own functions and replays them over the existing
files. One definition of each metric, in build_snapshot.py, applied two ways.

Momentum is deliberately not on the list. The score is user-configurable, so it
lives in the app and is computed at view time from raw history and the tables'
benchmark series; this script's momentum duty is only to keep those benchmark
series present and to strip the retired precomputed scores.

Validation and the atomic write are kept: every file is recomputed and checked
in memory, and nothing is written unless all of them pass, so a bad formula
leaves the published data exactly where it was.

Usage:
    python3 scripts/remetric.py [--check] [--fetch-benchmarks]

    --check             report what would change and write nothing
    --fetch-benchmarks  fetch the market and sector benchmark series (needs
                        FMP_API_KEY; ~13 requests) and attach them aligned to
                        each file's calendar. Without it, existing benchmarks
                        are carried over unchanged.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_snapshot import (  # noqa: E402
    API_KEY, MARKET_BENCHMARK, MIN_CALENDAR_SESSIONS, SECTOR_BENCHMARKS,
    TRADING_DAYS_PER_YEAR, WINDOWS,
    align, annualised_vol, benchmarks_for, load_history, max_drawdown,
    pct_change, write_atomically, ytd_change, _round,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Fields the old formulas produced that no longer exist. Left in place they
# would be a second, contradictory answer to questions the app now asks of the
# view it is showing -- the precomputed MOM/BLEND scores above all, now that
# the score is a function of the reader's formula settings.
RETIRED = ("momentumReturns", "momentumScore", "riskAdjusted1y", "ranks",
           "momWindows", "momMonths", "mom", "momBlocks", "blend", "blendWindows")
RETIRED_TABLE_KEYS = ("skip", "momentum", "mom", "blend")


def fetch_benchmark_series() -> dict[str, dict[str, float]]:
    """Raw date->close series for the market and every sector benchmark."""
    if not API_KEY:
        print("--fetch-benchmarks needs FMP_API_KEY (or API_KEY)", file=sys.stderr)
        sys.exit(2)
    symbols = [MARKET_BENCHMARK] + sorted(set(SECTOR_BENCHMARKS.values()))
    return load_history(symbols)


def attach_benchmarks(table: dict, series: dict[str, dict[str, float]]) -> dict:
    """Benchmarks aligned to this table's calendar, sliced to its sectors."""
    calendar = table["dates"]

    def aligned(symbol: str) -> dict:
        raw = series.get(symbol) or {}
        if len(raw) < MIN_CALENDAR_SESSIONS:
            print(f"benchmark {symbol}: only {len(raw)} sessions", file=sys.stderr)
            sys.exit(1)
        return {"symbol": symbol,
                "history": [round(c, 2) if c is not None else None
                            for c in align(raw, calendar)]}

    by_symbol = {s: aligned(s) for s in
                 [MARKET_BENCHMARK] + sorted(set(SECTOR_BENCHMARKS.values()))}
    full = {
        "market": by_symbol[MARKET_BENCHMARK],
        "sectors": {sector: by_symbol[etf]
                    for sector, etf in SECTOR_BENCHMARKS.items()},
    }
    return benchmarks_for(full, {t["sector"] for t in table["tickers"]})


def recompute(table: dict, series: dict[str, dict[str, float]] | None) -> tuple[dict, list[str]]:
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
        row["volatility"] = {
            "30d": _round(annualised_vol(closes, 30)),
            "90d": _round(annualised_vol(closes, 90)),
            "1y": _round(annualised_vol(closes, TRADING_DAYS_PER_YEAR)),
        }
        row["maxDrawdown1y"] = _round(max_drawdown(closes, TRADING_DAYS_PER_YEAR))
        rows.append(row)

    out = {k: v for k, v in table.items() if k not in RETIRED_TABLE_KEYS + ("tickers",)}
    out["schema"] = 3
    if series is not None:
        out["benchmarks"] = attach_benchmarks(table, series)
    out["tickers"] = rows
    return out, notes


def check(table: dict, path: Path) -> list[str]:
    """Refuse to publish a table the replay clearly broke."""
    errors = []
    rows = table["tickers"]
    calendar = table["dates"]

    for t in rows:
        if t["returns"].get("1y") is not None and not -100 <= t["returns"]["1y"] < 10000:
            errors.append(f"{path.name}: {t['symbol']} 1y return {t['returns']['1y']}% out of range")

    marks = table.get("benchmarks") or {}
    market = (marks.get("market") or {}).get("history") or []
    if len(market) != len(calendar):
        errors.append(f"{path.name}: market benchmark history length != calendar length")
    elif any(c is None or c <= 0 for c in market):
        errors.append(f"{path.name}: market benchmark has missing or non-positive closes")
    for sector in sorted({t["sector"] for t in rows}):
        if sector not in SECTOR_BENCHMARKS:
            continue
        series = ((marks.get("sectors") or {}).get(sector) or {}).get("history") or []
        if len(series) != len(calendar):
            errors.append(f"{path.name}: benchmark for {sector} out of step with calendar")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--fetch-benchmarks", action="store_true")
    args = parser.parse_args()

    series = fetch_benchmark_series() if args.fetch_benchmarks else None

    index = json.loads((DATA / "index.json").read_text())
    paths = [DATA / u["file"] for u in index["universes"]]

    rebuilt: list[tuple[Path, dict]] = []
    errors: list[str] = []
    for path in paths:
        table, notes = recompute(json.loads(path.read_text()), series)
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
    marks = top.get("benchmarks") or {}
    print(f"{len(rebuilt)} tables recomputed, benchmarks: "
          f"{(marks.get('market') or {}).get('symbol', 'none')} + "
          f"{len(marks.get('sectors') or {})} sector series in {top['title']}")

    if args.check:
        print("--check: nothing written")
        return 0

    for path, table in rebuilt:
        write_atomically(str(path), table)
    print(f"Wrote {len(rebuilt)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())

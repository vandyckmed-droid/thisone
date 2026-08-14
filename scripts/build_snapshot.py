#!/usr/bin/env python3
"""
Top-100 market-cap snapshot builder.

One script, one job: turn the Financial Modeling Prep API into a single
validated ``data/snapshot.json`` that a phone app can fetch straight from
GitHub with no backend in between.

Pipeline stages
---------------
1. universe   -- screen for eligible US common stocks and drop share-class and
                 debt/preferred duplicates
2. prices     -- pull ~2 years of dividend-adjusted daily closes per ticker,
                 plus the benchmark series the app's scoring needs
3. metrics    -- returns, annualised volatility, drawdown
4. validate   -- refuse to publish a snapshot that fails any sanity check
5. write      -- one table of the largest TOP_N overall and one of the largest
                 SECTOR_N in each sector, every file replaced atomically so a
                 failed run leaves the last good copy exactly where it was

Only the standard library is used, so CI needs no dependency install.

Environment
-----------
FMP_API_KEY / API_KEY   required
TOP_N                   size of the overall table (default 300)
NEXT_N                  size of the band published below it (default 300)
SECTOR_N                size of each sector table (default 100)
MIN_MARKET_CAP          screen floor (default 250M -- low enough that the
                        smaller sectors can reach SECTOR_N)
MIN_DOLLAR_VOLUME       average daily traded value floor (default 3M)
HISTORY_DAYS            calendar days of history to request (default 850)
DATA_DIR                where to write (default data/)
MAX_WORKERS             concurrent API requests (default 8)
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

API_ROOT = "https://financialmodelingprep.com/stable"
API_KEY = os.environ.get("FMP_API_KEY") or os.environ.get("API_KEY") or ""

# Two kinds of table, both plain: the largest TOP_N companies overall, and the
# largest SECTOR_N within each sector. No balancing, no quotas -- a sector file
# already is the sector, so nothing needs spreading.
TOP_N = int(os.environ.get("TOP_N", "300"))
# The band below the overall table, published as its own universe. Same shape,
# same metrics, ranked among itself -- a company is #1 of the next 300 rather
# than #301 of six hundred, because the field it is measured against is what a
# placing means.
NEXT_N = int(os.environ.get("NEXT_N", "300"))
SECTOR_N = int(os.environ.get("SECTOR_N", "100"))
HISTORY_DAYS = int(os.environ.get("HISTORY_DAYS", "850"))
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "4"))

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(REPO_ROOT, "data")
OUTPUT_PATH = os.environ.get("OUTPUT") or os.path.join(DATA_DIR, "snapshot.json")
SECTOR_DIR = os.path.join(DATA_DIR, "sectors")
NEXT_FILE = "next300.json"

# Reaching a hundred names in the smaller sectors means screening well below
# mega-cap: at a $5B floor only five sectors have a hundred to give.
MIN_MARKET_CAP = int(os.environ.get("MIN_MARKET_CAP", 250_000_000))
CANDIDATE_POOL = int(os.environ.get("CANDIDATE_POOL", "4000"))
MIN_DOLLAR_VOLUME = int(os.environ.get("MIN_DOLLAR_VOLUME", 3_000_000))

# A recent listing can still be a genuine mega cap, so the bar for including a
# ticker is only "enough sessions to draw a chart and measure short-horizon
# risk" -- longer windows simply report null. The shared calendar is held to a
# much higher bar, since that reflects the whole universe.
MIN_TICKER_SESSIONS = 25
MIN_CALENDAR_SESSIONS = 200

TRADING_DAYS_PER_YEAR = 252
WINDOWS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252, "2y": 504}

# The plain return windows above run right up to the last close. A "3 month
# return" on the table means exactly that, so it can be checked against any
# other source. Momentum is not computed here at all: the app builds the score
# itself from raw history, because the formula is user-configurable -- lookback,
# skip, volatility adjustment and factor residuals are all toggles -- and a
# score frozen at build time could only ever answer one configuration.
#
# What the pipeline owes that scoring is the factor series it regresses
# against: one whole-market benchmark and one per sector, published aligned to
# the same shared calendar as every ticker. The app estimates betas over the
# ESTIMATION_SESSIONS *ending at* a scoring window's cutoff -- the estimation
# stretch contains the scoring window -- so the calendar has to carry at least
# 504 sessions plus the deepest skip (21): ~526 sessions, which HISTORY_DAYS
# at 850 calendar days comfortably covers.
MARKET_BENCHMARK = "VTI"
SECTOR_BENCHMARKS = {
    "Basic Materials": "XLB",
    "Communication Services": "XLC",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Energy": "XLE",
    "Financial Services": "XLF",
    "Healthcare": "XLV",
    "Industrials": "XLI",
    "Real Estate": "XLRE",
    "Technology": "XLK",
    "Utilities": "XLU",
}
ESTIMATION_SESSIONS = 504

# Names that betray a note, bond, preferred or depositary line rather than a
# common share. FMP reports these with the *parent company's* market cap.
NON_COMMON_MARKERS = (
    "% ", "%,", " NTS", " NOTES", "NOTE ", "DEBENTURE", "PFD", "PREFERRED",
    "DEPOSITARY", "DEP SHS", "SUBORDINATED", "CUMULATIVE", " WARRANT", " UNITS",
    " UNIT ", " RIGHTS", "CAPITAL SECURITIES", "TRUST SECURITIES", " SERIES ",
)


class PipelineError(RuntimeError):
    """Fatal enough to abandon the refresh and keep the previous snapshot."""


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

def fetch(endpoint: str, params: dict[str, Any] | None = None,
          attempts: int = 7) -> Any:
    """GET an FMP endpoint, retrying transient failures with backoff.

    Rate limiting is the failure that matters here. A 429 that exhausts its
    retries does not raise -- it returns empty and the symbol quietly vanishes
    from the table, which is how Disney, Boeing and Verizon went missing from a
    run that otherwise looked clean. So 429s get many attempts and a long,
    honest backoff, and the caller checks that nothing important dropped.
    """
    query = dict(params or {})
    query["apikey"] = API_KEY
    url = f"{API_ROOT}/{endpoint}?{urllib.parse.urlencode(query)}"

    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "top100-snapshot/1.0"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_error = exc
            # 429 and 5xx are worth another go; anything else is our fault.
            if exc.code != 429 and exc.code < 500:
                raise PipelineError(f"{endpoint}: HTTP {exc.code}") from exc
            if exc.code == 429:
                # Wait out the window the server names, or a growing pause.
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                delay = int(retry_after) if (retry_after or "").isdigit() else min(60, 5 * (attempt + 1))
                time.sleep(delay)
                continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
        else:
            if isinstance(payload, dict) and ("Error Message" in payload or "error" in payload):
                raise PipelineError(f"{endpoint}: {payload.get('Error Message') or payload.get('error')}")
            return payload

        if attempt < attempts - 1:
            time.sleep(2 ** attempt)

    raise PipelineError(f"{endpoint}: giving up after {attempts} attempts ({last_error})")


def in_parallel(fn, items: Iterable[Any]) -> list[Any]:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        return list(pool.map(fn, items))


# --------------------------------------------------------------------------
# Stage 1 -- universe
# --------------------------------------------------------------------------

def looks_like_common_stock(name: str) -> bool:
    upper = f" {name.upper()} "
    return not any(marker in upper for marker in NON_COMMON_MARKERS)


def screen_candidates() -> list[dict[str, Any]]:
    """Pull the largest US-listed operating companies from the screener."""
    rows = fetch("company-screener", {
        "marketCapMoreThan": MIN_MARKET_CAP,
        "exchange": "NASDAQ,NYSE",
        "country": "US",
        "isEtf": "false",
        "isFund": "false",
        "isActivelyTrading": "true",
        "limit": CANDIDATE_POOL,
    })
    if not isinstance(rows, list) or not rows:
        raise PipelineError("screener returned no candidates")

    kept = [
        r for r in rows
        if r.get("symbol") and r.get("marketCap")
        and not r.get("isEtf") and not r.get("isFund")
        and looks_like_common_stock(r.get("companyName") or "")
    ]
    kept.sort(key=lambda r: r["marketCap"], reverse=True)
    log(f"screener: {len(rows)} rows -> {len(kept)} plausible common stocks")
    return kept


def load_profiles(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Profiles carry the CIK we dedupe on, plus sector and logo."""
    def one(symbol: str) -> tuple[str, dict[str, Any] | None]:
        try:
            rows = fetch("profile", {"symbol": symbol})
        except PipelineError as exc:
            log(f"  profile {symbol}: {exc}")
            return symbol, None
        return symbol, (rows[0] if isinstance(rows, list) and rows else None)

    profiles = {sym: prof for sym, prof in in_parallel(one, symbols) if prof}
    log(f"profiles: {len(profiles)}/{len(symbols)} resolved")
    return profiles


def build_universe() -> list[dict[str, Any]]:
    """Every eligible issuer the screen turned up, ordered by market cap."""
    candidates = screen_candidates()
    profiles = load_profiles([c["symbol"] for c in candidates])

    # One entry per issuer (CIK). Alphabet's GOOGL/GOOG, Berkshire's A/B shares
    # and Verizon's baby bonds all share their parent's CIK, and all report the
    # parent's full market cap -- keeping more than one would both double-count
    # the company and push a real one out of the table.
    by_issuer: dict[str, dict[str, Any]] = {}
    for cand in candidates:
        symbol = cand["symbol"]
        profile = profiles.get(symbol)
        if not profile:
            continue

        name = profile.get("companyName") or cand.get("companyName") or symbol
        price = profile.get("price") or cand.get("price") or 0
        avg_volume = profile.get("averageVolume") or 0
        if not looks_like_common_stock(name):
            continue
        if price <= 0 or price * avg_volume < MIN_DOLLAR_VOLUME:
            continue

        entry = {
            "symbol": symbol,
            "name": name,
            "sector": profile.get("sector") or cand.get("sector") or "Unknown",
            "industry": profile.get("industry") or cand.get("industry") or "",
            "exchange": profile.get("exchange") or cand.get("exchangeShortName") or "",
            "logo": profile.get("image") or "",
            "cik": profile.get("cik") or f"__{symbol}",
            "marketCap": float(profile.get("marketCap") or cand["marketCap"]),
            "dollarVolume": price * avg_volume,
        }

        incumbent = by_issuer.get(entry["cik"])
        # Most-traded listing wins: BRK-B over BRK-A, VZ over its 2054 notes.
        if incumbent is None or entry["dollarVolume"] > incumbent["dollarVolume"]:
            by_issuer[entry["cik"]] = entry

    ranked = sorted(by_issuer.values(), key=lambda e: e["marketCap"], reverse=True)
    log(f"universe: {len(ranked)} issuers after dedupe, from {ranked[0]['symbol']}")
    return ranked


def wanted(universe: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The union of every table we are about to publish.

    A company in the overall top 300 is almost always in its sector's top 100
    as well, so collecting the union first means its prices are fetched once
    rather than once per file it appears in.
    """
    chosen: dict[str, dict[str, Any]] = {}
    for entry in universe[:TOP_N + NEXT_N]:
        chosen[entry["symbol"]] = entry

    per_sector: dict[str, int] = {}
    for entry in universe:
        sector = entry["sector"]
        if per_sector.get(sector, 0) >= SECTOR_N:
            continue
        per_sector[sector] = per_sector.get(sector, 0) + 1
        chosen[entry["symbol"]] = entry

    log(f"wanted: {len(chosen)} unique symbols across the overall table and "
        f"{len(per_sector)} sectors")
    return [e for e in universe if e["symbol"] in chosen]


# --------------------------------------------------------------------------
# Stage 2 -- prices
# --------------------------------------------------------------------------

def load_history(symbols: list[str]) -> dict[str, dict[str, float]]:
    """Dividend-adjusted daily closes, keyed symbol -> {date: close}."""
    start = (date.today() - timedelta(days=HISTORY_DAYS)).isoformat()
    end = date.today().isoformat()

    def one(symbol: str) -> tuple[str, dict[str, float]]:
        try:
            rows = fetch("historical-price-eod/dividend-adjusted",
                         {"symbol": symbol, "from": start, "to": end})
        except PipelineError as exc:
            log(f"  history {symbol}: {exc}")
            return symbol, {}
        series = {
            r["date"]: float(r["adjClose"])
            for r in (rows or [])
            if r.get("date") and r.get("adjClose")
        }
        return symbol, series

    histories = dict(in_parallel(one, symbols))
    thin = [s for s, h in histories.items() if len(h) < MIN_TICKER_SESSIONS]
    log(f"history: {len(histories)} series, {len(thin)} below {MIN_TICKER_SESSIONS} sessions"
        + (f" ({', '.join(thin[:8])})" if thin else ""))
    return histories


def build_calendar(histories: dict[str, dict[str, float]]) -> list[str]:
    """Shared date axis: sessions that most of the universe actually traded."""
    counts: dict[str, int] = {}
    for series in histories.values():
        for day in series:
            counts[day] = counts.get(day, 0) + 1
    if not counts:
        raise PipelineError("no price history at all")

    quorum = max(2, int(len(histories) * 0.6))
    return sorted(day for day, n in counts.items() if n >= quorum)


def align(series: dict[str, float], calendar: list[str]) -> list[float | None]:
    """Map one ticker onto the shared calendar, forward-filling gaps.

    Sessions before a ticker's first trade stay null so the app can start the
    chart at listing rather than drawing a flat line back to 2024.
    """
    out: list[float | None] = []
    previous: float | None = None
    first_day = min(series) if series else None
    for day in calendar:
        if first_day is not None and day >= first_day:
            previous = series.get(day, previous)
            out.append(previous)
        else:
            out.append(None)
    return out


# --------------------------------------------------------------------------
# Stage 3 -- metrics
# --------------------------------------------------------------------------

def pct_change(closes: list[float], sessions: int) -> float | None:
    """Plain return over `sessions`, measured to the last close."""
    return pct_change_skip(closes, sessions, 0)


def _window(closes: list[float], sessions: int) -> list[float] | None:
    """Trailing window, or None when too little of it is actually covered.

    Without the coverage test a stock listed six weeks ago would report its
    six weeks of noise as a "1 year" figure.
    """
    window = closes[-(sessions + 1):]
    if len(window) < max(20, int(sessions * 0.6)):
        return None
    return window


def pct_change_skip(closes: list[float], sessions: int, skip: int) -> float | None:
    """Return over `sessions`, measured to `skip` sessions ago rather than today."""
    if len(closes) < sessions + skip + 1:
        return None
    end = closes[-1 - skip]
    start = closes[-1 - skip - sessions]
    if start <= 0:
        return None
    return (end / start - 1) * 100


def annualised_vol(closes: list[float], sessions: int) -> float | None:
    window = _window(closes, sessions)
    if window is None:
        return None
    rets = [math.log(b / a) for a, b in zip(window, window[1:]) if a > 0 and b > 0]
    if len(rets) < 19:
        return None
    return statistics.pstdev(rets) * math.sqrt(TRADING_DAYS_PER_YEAR) * 100


def load_benchmarks(calendar: list[str]) -> dict[str, Any]:
    """The factor series the app regresses against, aligned to the calendar.

    One market series and one per sector, each an ETF fetched exactly the way
    every ticker is. Published under its own key rather than as rows -- these
    are funds, not companies, and must never appear in a table.
    """
    symbols = [MARKET_BENCHMARK] + sorted(set(SECTOR_BENCHMARKS.values()))
    histories = load_history(symbols)

    def aligned(symbol: str) -> dict[str, Any]:
        series = histories.get(symbol) or {}
        if len(series) < MIN_CALENDAR_SESSIONS:
            raise PipelineError(f"benchmark {symbol}: only {len(series)} sessions")
        return {"symbol": symbol,
                "history": [round(c, 2) if c is not None else None
                            for c in align(series, calendar)]}

    by_symbol = {s: aligned(s) for s in symbols}
    return {
        "market": by_symbol[MARKET_BENCHMARK],
        "sectors": {sector: by_symbol[etf]
                    for sector, etf in SECTOR_BENCHMARKS.items()},
    }


def benchmarks_for(benchmarks: dict[str, Any], sectors: set[str]) -> dict[str, Any]:
    """The slice of the benchmark set one table actually needs."""
    return {
        "market": benchmarks["market"],
        "sectors": {s: benchmarks["sectors"][s]
                    for s in sorted(sectors) if s in benchmarks["sectors"]},
    }


def max_drawdown(closes: list[float], sessions: int) -> float | None:
    window = _window(closes, sessions)
    if window is None:
        return None
    peak, worst = window[0], 0.0
    for price in window:
        peak = max(peak, price)
        if peak > 0:
            worst = min(worst, price / peak - 1)
    return worst * 100


def ytd_change(dated: list[tuple[str, float]]) -> float | None:
    """From the final close of the previous calendar year to the last close."""
    if not dated:
        return None
    this_year = dated[-1][0][:4]
    base = [close for day, close in dated if day[:4] < this_year]
    if not base or base[-1] <= 0:
        return None
    return (dated[-1][1] / base[-1] - 1) * 100


def compute_metrics(entry: dict[str, Any], aligned: list[float | None],
                    calendar: list[str]) -> dict[str, Any] | None:
    dated = [(d, c) for d, c in zip(calendar, aligned) if c is not None]
    if len(dated) < MIN_TICKER_SESSIONS:
        return None

    closes = [c for _, c in dated]
    price = closes[-1]
    previous = closes[-2] if len(closes) > 1 else price

    returns = {label: pct_change(closes, n) for label, n in WINDOWS.items()}
    returns["ytd"] = ytd_change(dated)

    return {
        **{k: entry[k] for k in ("symbol", "name", "sector", "industry", "exchange", "logo")},
        "marketCap": entry["marketCap"],
        "price": round(price, 2),
        "change": round(price - previous, 2),
        "changePct": round((price / previous - 1) * 100, 2) if previous > 0 else 0.0,
        "asOf": dated[-1][0],
        "returns": {k: (round(v, 2) if v is not None else None) for k, v in returns.items()},
        "volatility": {
            "30d": _round(annualised_vol(closes, 30)),
            "90d": _round(annualised_vol(closes, 90)),
            "1y": _round(annualised_vol(closes, TRADING_DAYS_PER_YEAR)),
        },
        "maxDrawdown1y": _round(max_drawdown(closes, TRADING_DAYS_PER_YEAR)),
        # No momentum score is published. The score is a function of the
        # reader's formula settings, so the app computes it from `history` and
        # the table's `benchmarks` -- publishing one configuration's number
        # here would be a second, contradictory answer.
        "history": [round(c, 2) if c is not None else None for c in aligned],
        "firstSession": dated[0][0],
    }


def _round(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


# Ranks are deliberately not published. Every placing the app shows is measured
# against the rows actually on screen -- filter the Top 300 down to healthcare
# and #1 means the best of those, not the best of three hundred -- and a rank
# frozen at build time could only ever answer the unfiltered question.


# --------------------------------------------------------------------------
# Stage 4 -- validation
# --------------------------------------------------------------------------

def validate(snapshot: dict[str, Any], previous: dict[str, Any] | None,
             expected: int) -> list[str]:
    """Every reason this snapshot must not replace the last good one."""
    errors: list[str] = []
    tickers = snapshot.get("tickers") or []
    calendar = snapshot.get("dates") or []

    minimum = max(int(expected * 0.9), 1)
    if len(tickers) < minimum:
        errors.append(f"only {len(tickers)} tickers, need at least {minimum}")
    if len(calendar) < MIN_CALENDAR_SESSIONS:
        errors.append(f"calendar has {len(calendar)} sessions, need {MIN_CALENDAR_SESSIONS}")

    symbols = [t["symbol"] for t in tickers]
    if len(set(symbols)) != len(symbols):
        dupes = {s for s in symbols if symbols.count(s) > 1}
        errors.append(f"duplicate symbols: {sorted(dupes)}")

    ciks = [t.get("cik") for t in tickers if t.get("cik")]
    if len(set(ciks)) != len(ciks):
        errors.append("two share classes of the same issuer survived dedupe")

    for ticker in tickers:
        symbol = ticker["symbol"]
        if not ticker.get("price") or ticker["price"] <= 0:
            errors.append(f"{symbol}: non-positive price")
        if not ticker.get("marketCap") or ticker["marketCap"] <= 0:
            errors.append(f"{symbol}: non-positive market cap")
        if abs(ticker.get("changePct") or 0) > 50:
            errors.append(f"{symbol}: implausible daily move {ticker['changePct']}%")
        if len(ticker.get("history") or []) != len(calendar):
            errors.append(f"{symbol}: history length != calendar length")

    caps = [t["marketCap"] for t in tickers]
    if caps != sorted(caps, reverse=True):
        errors.append("tickers are not ordered by market cap")

    # The app's scoring cannot run without its factor series, and a benchmark
    # out of step with the calendar would quietly residualise against the
    # wrong days.
    marks = snapshot.get("benchmarks") or {}
    market = (marks.get("market") or {}).get("history") or []
    if len(market) != len(calendar):
        errors.append("market benchmark history length != calendar length")
    elif any(c is None or c <= 0 for c in market):
        errors.append("market benchmark has missing or non-positive closes")
    for sector in sorted({t["sector"] for t in tickers}):
        series = ((marks.get("sectors") or {}).get(sector) or {}).get("history") or []
        if sector in SECTOR_BENCHMARKS and len(series) != len(calendar):
            errors.append(f"benchmark for {sector}: history length != calendar length")

    # The data date must be a genuinely recent session, or we are republishing
    # stale numbers under a fresh timestamp.
    if calendar:
        age = (date.today() - date.fromisoformat(calendar[-1])).days
        if age > 5:
            errors.append(f"latest session {calendar[-1]} is {age} days old")

    # A universe that suddenly shares little with the last good one means the
    # screener misbehaved, not that the market turned over.
    if previous:
        before = {t["symbol"] for t in previous.get("tickers", [])}
        if before:
            # Measure against the smaller set, so a deliberate change to TOP_N
            # is not mistaken for the screener going haywire.
            overlap = len(before & set(symbols)) / min(len(before), len(symbols))
            if overlap < 0.8:
                errors.append(f"universe overlap with previous snapshot only {overlap:.0%}")

    return errors


# --------------------------------------------------------------------------
# Stage 5 -- assemble and write
# --------------------------------------------------------------------------

def read_previous(path: str) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


SLUG = str.maketrans({" ": "-", "/": "-", "&": "and"})


def slugify(sector: str) -> str:
    return sector.lower().translate(SLUG)


def assemble(tickers: list[dict[str, Any]], calendar: list[str],
             title: str, scope: str, benchmarks: dict[str, Any],
             blurb: str | None = None) -> dict[str, Any]:
    """One published table: ranks are computed within it, not inherited.

    A sector file ranks its companies against each other, which is the only
    reading that makes sense inside a sector -- #1 in Utilities means the best
    utility, not the 47th best company overall.
    """
    rows = sorted(tickers, key=lambda t: t["marketCap"], reverse=True)
    rows = [dict(t) for t in rows]
    return {
        "schema": 3,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        # One line saying what this table holds. Written here because only the
        # pipeline knows a table is a rank band rather than a plain "largest N".
        "blurb": blurb or f"{len(rows)} largest {'' if scope == 'all' else title + ' '}companies".replace("  ", " "),
        "dataDate": calendar[-1] if calendar else None,
        "source": "Financial Modeling Prep",
        "title": title,
        "scope": scope,
        "universeSize": len(rows),
        # The factor series the app's configurable score regresses against:
        # the market benchmark plus one series per sector this table contains.
        "benchmarks": benchmarks_for(benchmarks, {t["sector"] for t in rows}),
        "sessions": len(calendar),
        "dates": calendar,
        "tickers": rows,
    }


def build_tables() -> tuple[dict[str, Any], dict[str, Any],
                            dict[str, dict[str, Any]], list[str]]:
    """The overall table, the band below it, one table per sector, and the calendar."""
    universe = build_universe()
    shortlist = wanted(universe)
    histories = load_history([e["symbol"] for e in shortlist])
    calendar = build_calendar(histories)
    benchmarks = load_benchmarks(calendar)

    metrics: list[dict[str, Any]] = []
    for entry in shortlist:
        series = histories.get(entry["symbol"]) or {}
        if not series:
            continue
        computed = compute_metrics(entry, align(series, calendar), calendar)
        if computed is None:
            continue
        computed["cik"] = entry["cik"]
        metrics.append(computed)

    metrics.sort(key=lambda t: t["marketCap"], reverse=True)
    log(f"metrics: {len(metrics)} of {len(shortlist)} shortlisted symbols usable")

    # A symbol that fails to download does not raise -- it simply is not in the
    # table, and a table missing Disney still passes every other check. So the
    # ones that matter most are checked by name.
    have = {t["symbol"] for t in metrics}
    lost = [e["symbol"] for e in shortlist[:TOP_N] if e["symbol"] not in have]
    if lost:
        raise PipelineError(
            f"{len(lost)} of the largest {TOP_N} companies have no usable history "
            f"({', '.join(lost[:12])}) -- refusing to publish a table with holes in it"
        )

    overall = assemble(metrics[:TOP_N], calendar,
                       f"Top {min(TOP_N, len(metrics))}", "all", benchmarks,
                       blurb=f"{min(TOP_N, len(metrics))} largest US companies")

    following = metrics[TOP_N:TOP_N + NEXT_N]
    if len(following) < NEXT_N * 0.9:
        raise PipelineError(
            f"only {len(following)} companies below the top {TOP_N} have usable "
            f"history, expected about {NEXT_N} -- refusing to publish a thin band"
        )
    upcoming = assemble(
        following, calendar, f"Next {len(following)}", "all", benchmarks,
        blurb=f"US companies ranked {TOP_N + 1} to {TOP_N + len(following)} by market cap")

    sectors: dict[str, dict[str, Any]] = {}
    for sector in sorted({t["sector"] for t in metrics}):
        rows = [t for t in metrics if t["sector"] == sector][:SECTOR_N]
        if not rows:
            continue
        sectors[sector] = assemble(rows, calendar, sector, "sector", benchmarks)

    widest = max((len(s) for s in sectors), default=0)
    for sector, table in sorted(sectors.items(), key=lambda kv: -kv[1]["universeSize"]):
        short = "" if table["universeSize"] >= SECTOR_N else "  (all available)"
        log(f"  {sector:<{widest}}  {table['universeSize']:>3}{short}")

    return overall, upcoming, sectors, calendar


def write_atomically(path: str, payload: dict[str, Any]) -> int:
    """Write beside the target then rename, so readers never see a half file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)
    return os.path.getsize(path)


def main() -> int:
    if not API_KEY:
        log("FMP_API_KEY (or API_KEY) is not set")
        return 2

    previous = read_previous(OUTPUT_PATH)

    try:
        overall, upcoming, sectors, calendar = build_tables()
    except PipelineError as exc:
        log(f"REFRESH FAILED: {exc}")
        log("previous files left untouched" if previous else "no previous files exist")
        return 1

    # Every table is validated before any file is written, so a single bad
    # sector cannot leave the set half updated.
    problems: list[str] = []
    problems += [f"overall: {e}" for e in validate(overall, previous, TOP_N)]
    # No previous-overlap check for the band: it sits at the boundary of the
    # screen, so names crossing in and out of it is ordinary, not a red flag.
    problems += [f"next: {e}" for e in validate(upcoming, None, upcoming["universeSize"])]
    for sector, table in sectors.items():
        problems += [f"{sector}: {e}" for e in validate(table, None, min(SECTOR_N, table["universeSize"]))]

    if problems:
        log(f"VALIDATION FAILED ({len(problems)} problems):")
        for problem in problems[:25]:
            log(f"  - {problem}")
        log("previous files left untouched" if previous else "no previous files exist")
        return 1

    total = write_atomically(OUTPUT_PATH, overall)
    total += write_atomically(os.path.join(DATA_DIR, NEXT_FILE), upcoming)
    index = {
        "generatedAt": overall["generatedAt"],
        "dataDate": overall["dataDate"],
        "sessions": overall["sessions"],
        "universes": [
            {"key": "all", "title": overall["title"], "scope": "all",
             "size": overall["universeSize"], "file": "snapshot.json"},
            {"key": "next", "title": upcoming["title"], "scope": "all",
             "size": upcoming["universeSize"], "file": NEXT_FILE},
        ],
    }
    for sector, table in sorted(sectors.items()):
        name = f"{slugify(sector)}.json"
        total += write_atomically(os.path.join(SECTOR_DIR, name), table)
        index["universes"].append({
            "key": slugify(sector), "title": sector, "scope": "sector",
            "size": table["universeSize"], "file": f"sectors/{name}",
        })

    write_atomically(os.path.join(DATA_DIR, "index.json"), index)

    log(f"wrote {2 + len(sectors)} tables plus an index, {total / 1024 / 1024:.1f} MB, "
        f"data date {overall['dataDate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

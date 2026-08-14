#!/usr/bin/env python3
"""
Top-100 market-cap snapshot builder.

One script, one job: turn the Financial Modeling Prep API into a single
validated ``data/snapshot.json`` that a phone app can fetch straight from
GitHub with no backend in between.

Pipeline stages
---------------
1. universe   -- screen for eligible US common stocks, drop share-class and
                 debt/preferred duplicates, take the top N by market cap, then
                 extend it with names chosen to spread across sectors
2. prices     -- pull ~2 years of dividend-adjusted daily closes per ticker
3. metrics    -- returns, annualised volatility, drawdown, rankings
4. validate   -- refuse to publish a snapshot that fails any sanity check
5. write      -- atomic replace, so a failed refresh leaves the last good
                 snapshot exactly where it was

Only the standard library is used, so CI needs no dependency install.

Environment
-----------
FMP_API_KEY / API_KEY   required
TOP_N                   size of the market-cap core (default 100)
BALANCED_N              extra names chosen to spread sectors (default 100)
SELECTION               "collar" (default) or "lookahead"
SECTOR_CAP_PCT          most of the universe any one sector may hold (default 20)
SECTOR_FLOOR_PCT        least any sector present may hold (default 4)
LOOKAHEAD               candidates the lookahead method weighs (default 5)
HISTORY_DAYS            calendar days of history to request (default 760)
OUTPUT                  snapshot path (default data/snapshot.json)
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

# The universe is built in two parts. The core is the largest companies, full
# stop. Beyond it, taking the next N by market cap would just deepen whichever
# sectors are already largest -- another twenty technology names before a second
# utility -- so the expansion is chosen to spread across sectors instead.
CORE_N = int(os.environ.get("TOP_N", "100"))
BALANCED_N = int(os.environ.get("BALANCED_N", "100"))
TARGET_N = CORE_N + BALANCED_N

# Balance is expressed as a share of the finished universe, not a count, so the
# same numbers mean the same thing whether the table holds fifty names or five
# thousand. A ceiling alone would leave the smallest sectors as tokens and a
# floor alone would leave the largest dominant, so it takes both.
SECTOR_CAP_PCT = float(os.environ.get("SECTOR_CAP_PCT", "20"))
SECTOR_FLOOR_PCT = float(os.environ.get("SECTOR_FLOOR_PCT", "4"))
SELECTION = os.environ.get("SELECTION", "collar")
LOOKAHEAD = int(os.environ.get("LOOKAHEAD", "5"))
HISTORY_DAYS = int(os.environ.get("HISTORY_DAYS", "760"))
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "8"))

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.environ.get("OUTPUT") or os.path.join(REPO_ROOT, "data", "snapshot.json")

# Screen a deliberately oversized candidate pool: dual share classes, baby
# bonds and preferreds all carry their parent's market cap and would otherwise
# crowd genuine companies out of the top 100.
CANDIDATE_POOL = max((TARGET_N + max(25, BALANCED_N)) * 2, 300)
# Enough spare candidates that the balancer has something to choose between:
# picking 100 from a remainder of 100 is not a choice, it is the whole list.
UNIVERSE_RESERVE = max(25, BALANCED_N)
MIN_MARKET_CAP = 5_000_000_000
MIN_DOLLAR_VOLUME = 20_000_000  # average daily traded value

# A recent listing can still be a genuine mega cap, so the bar for including a
# ticker is only "enough sessions to draw a chart and measure short-horizon
# risk" -- longer windows simply report null. The shared calendar is held to a
# much higher bar, since that reflects the whole universe.
MIN_TICKER_SESSIONS = 25
MIN_CALENDAR_SESSIONS = 200

TRADING_DAYS_PER_YEAR = 252
WINDOWS = {"1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": 252, "2y": 504}

# Momentum deliberately ignores the most recent month. Very short-term moves
# tend to reverse rather than persist, so a window running right up to today
# measures noise on top of the trend. Skipping it is the standard construction.
MOMENTUM_SKIP = 21
MOMENTUM_WINDOWS = {"3m": 63, "6m": 126, "9m": 189, "12m": 252}

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
          attempts: int = 4) -> Any:
    """GET an FMP endpoint, retrying transient failures with backoff."""
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
    """Screen, enrich, dedupe by issuer, and take the top N by market cap."""
    candidates = screen_candidates()[:CANDIDATE_POOL]
    profiles = load_profiles([c["symbol"] for c in candidates])

    # One entry per issuer (CIK). Alphabet's GOOGL/GOOG, Berkshire's A/B
    # shares and Verizon's baby bonds all share their parent's CIK, and all
    # report the parent's full market cap -- keeping more than one would both
    # double-count the company and push a real one out of the table.
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
            if incumbent:
                log(f"  dedupe: {entry['symbol']} replaces {incumbent['symbol']} ({name})")
            by_issuer[entry["cik"]] = entry
        else:
            log(f"  dedupe: dropping {entry['symbol']} in favour of {incumbent['symbol']}")

    ranked = sorted(by_issuer.values(), key=lambda e: e["marketCap"], reverse=True)
    # Carry a reserve past the target so thin-history names can be replaced and
    # the sector balancer has candidates to choose between.
    universe = ranked[:TARGET_N + UNIVERSE_RESERVE]
    log(f"universe: {len(ranked)} issuers deduped, carrying {len(universe)} candidates "
        f"for a target of {TARGET_N} from {universe[0]['symbol']}")
    return universe


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


def collar_bounds(target: int, sectors: int) -> tuple[int, int]:
    """Turn the percentages into counts, then make them arithmetically possible.

    Percentages can describe an impossible table. Ten sectors under a 5% ceiling
    cannot hold a hundred names, and eleven sectors each guaranteed 20% would
    need two hundred percent of one. So the ceiling rises far enough to hold the
    universe and the floor drops far enough to fit inside it -- always in that
    order, because a table that cannot be filled is a worse failure than one
    that is less balanced than requested.
    """
    if sectors <= 0:
        return target, 0

    cap = max(1, round(target * SECTOR_CAP_PCT / 100))
    floor = int(target * SECTOR_FLOOR_PCT / 100)

    cap = max(cap, -(-target // sectors))       # ceil: the ceiling must hold the table
    if floor * sectors > target:
        floor = target // sectors               # the floors must fit under it
    floor = min(floor, cap)
    return cap, floor


def select_collar(candidates: list[dict[str, Any]], counts: dict[str, int],
                  target: int, cap: int, floor: int) -> list[dict[str, Any]]:
    """Pick `target` names in market-cap order, held between a floor and a cap.

    Three passes: lift every sector to the floor, then fill by market cap while
    no sector exceeds the cap, then -- only if the cap left the table short --
    relax it rather than publish fewer names than asked for.

    Unlike a lookahead, this states a guarantee instead of describing a
    procedure: no sector above the cap, none below the floor, and everything
    else in plain market-cap order.
    """
    by_sector: dict[str, list[dict[str, Any]]] = {}
    for entry in candidates:
        by_sector.setdefault(entry["sector"], []).append(entry)

    chosen: list[dict[str, Any]] = []
    taken: set[str] = set()

    for sector, rows in by_sector.items():
        shortfall = floor - counts.get(sector, 0)
        for entry in rows[:max(0, shortfall)]:
            if len(chosen) >= target:
                break
            chosen.append(entry)
            taken.add(entry["symbol"])
            counts[sector] = counts.get(sector, 0) + 1

    overflow: list[dict[str, Any]] = []
    for entry in candidates:
        if len(chosen) >= target:
            break
        if entry["symbol"] in taken:
            continue
        if counts.get(entry["sector"], 0) < cap:
            chosen.append(entry)
            taken.add(entry["symbol"])
            counts[entry["sector"]] = counts.get(entry["sector"], 0) + 1
        else:
            overflow.append(entry)

    relaxed = 0
    for entry in overflow:
        if len(chosen) >= target:
            break
        chosen.append(entry)
        counts[entry["sector"]] = counts.get(entry["sector"], 0) + 1
        relaxed += 1

    # The cap is a promise, so breaking it should never be quiet. This only
    # happens when the candidate pool is too thin to fill the table any other
    # way, which means the screen needs widening rather than the cap loosening.
    if relaxed:
        log(f"  NOTE: cap of {cap} relaxed for {relaxed} names -- "
            f"too few candidates to fill {target} otherwise")

    return chosen


def select_balanced(candidates: list[dict[str, Any]], counts: dict[str, int],
                    target: int, lookahead: int) -> list[dict[str, Any]]:
    """Pick `target` names, spreading them across sectors.

    Walking the remaining candidates in market-cap order, look at the next
    `lookahead` and take the one whose sector is currently least represented,
    breaking ties by market cap. Then count it and look again.

    The lookahead is what keeps this honest. Choosing purely by smallest sector
    would trawl the whole list for one more utility however far down it sat;
    restricting the choice to the next few means a name still has to be roughly
    next in line by size to be picked at all, and the balancing happens between
    near-equals rather than across the entire tail.
    """
    chosen: list[dict[str, Any]] = []
    pool = list(candidates)

    while pool and len(chosen) < target:
        window = pool[:lookahead]
        # Least-represented sector wins; among equals, the largest company.
        pick = min(window, key=lambda t: (counts.get(t["sector"], 0), -t["marketCap"]))
        chosen.append(pick)
        counts[pick["sector"]] = counts.get(pick["sector"], 0) + 1
        pool.remove(pick)

    return chosen


# --------------------------------------------------------------------------
# Stage 3 -- metrics
# --------------------------------------------------------------------------

def pct_change(closes: list[float], sessions: int) -> float | None:
    if len(closes) <= sessions:
        return None
    past, now = closes[-1 - sessions], closes[-1]
    if past <= 0:
        return None
    return (now / past - 1) * 100


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
    """Measured from the final close of the previous calendar year."""
    if not dated:
        return None
    this_year = dated[-1][0][:4]
    base = [c for d, c in dated if d[:4] < this_year]
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

    vol_1y = annualised_vol(closes, TRADING_DAYS_PER_YEAR)
    ret_1y = returns.get("1y")

    return {
        **{k: entry[k] for k in ("symbol", "name", "sector", "industry", "exchange", "logo")},
        "marketCap": entry["marketCap"],
        "price": round(price, 2),
        "change": round(price - previous, 2),
        "changePct": round((price / previous - 1) * 100, 2) if previous > 0 else 0.0,
        "asOf": dated[-1][0],
        "returns": {k: (round(v, 2) if v is not None else None) for k, v in returns.items()},
        # The skip-a-month windows momentum is built from, kept in the snapshot
        # so the score can be checked rather than taken on trust.
        "momentumReturns": {
            label: _round(pct_change_skip(closes, n, MOMENTUM_SKIP))
            for label, n in MOMENTUM_WINDOWS.items()
        },
        "volatility": {
            "30d": _round(annualised_vol(closes, 30)),
            "90d": _round(annualised_vol(closes, 90)),
            "1y": _round(vol_1y),
        },
        "maxDrawdown1y": _round(max_drawdown(closes, TRADING_DAYS_PER_YEAR)),
        # Return per unit of risk -- the cheap Sharpe stand-in, no risk-free rate.
        "riskAdjusted1y": (round(ret_1y / vol_1y, 3)
                           if ret_1y is not None and vol_1y else None),
        "history": [round(c, 2) if c is not None else None for c in aligned],
        "firstSession": dated[0][0],
    }


def _round(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


def apply_rankings(tickers: list[dict[str, Any]]) -> None:
    """Attach 1-based ranks; rank 1 is always the most desirable end."""
    def rank_by(key: str, extract, *, descending: bool) -> None:
        scored = [t for t in tickers if extract(t) is not None]
        scored.sort(key=extract, reverse=descending)
        for position, ticker in enumerate(scored, start=1):
            ticker["ranks"][key] = position
        for ticker in tickers:
            ticker["ranks"].setdefault(key, None)

    for ticker in tickers:
        ticker["ranks"] = {}

    rank_by("marketCap", lambda t: t["marketCap"], descending=True)
    for horizon in ("1w", "1m", "3m", "6m", "ytd", "1y", "2y"):
        rank_by(f"return_{horizon}", lambda t, h=horizon: t["returns"].get(h), descending=True)
    rank_by("volatility", lambda t: t["volatility"]["1y"], descending=False)
    rank_by("riskAdjusted", lambda t: t["riskAdjusted1y"], descending=True)

    # Momentum blends the four skip-a-month horizons by average percentile.
    # These per-horizon placings are not published as ranks of their own: the
    # ranks the app shows are plain trailing returns, and two sets of
    # near-identical numbers would invite exactly the confusion the score is
    # meant to resolve.
    total = len(tickers)
    horizons = list(MOMENTUM_WINDOWS)
    placings: dict[str, dict[str, int]] = {t["symbol"]: {} for t in tickers}
    for horizon in horizons:
        scored = [t for t in tickers if t["momentumReturns"].get(horizon) is not None]
        scored.sort(key=lambda t: t["momentumReturns"][horizon], reverse=True)
        for position, ticker in enumerate(scored, start=1):
            placings[ticker["symbol"]][horizon] = position

    for ticker in tickers:
        places = [placings[ticker["symbol"]].get(h) for h in horizons]
        # The score is defined as a blend of all four horizons; computing it
        # from whichever happen to be available would be a different statistic
        # wearing the same name. A ticker without ~13 months of history -- the
        # 12-month window plus the skipped month -- simply has no momentum yet.
        if any(p is None for p in places):
            ticker["momentumScore"] = None
            continue
        average = sum(places) / len(places)
        ticker["momentumScore"] = round(100 * (1 - (average - 1) / max(total - 1, 1)), 1)

    rank_by("momentum", lambda t: t["momentumScore"], descending=True)


# --------------------------------------------------------------------------
# Stage 4 -- validation
# --------------------------------------------------------------------------

def validate(snapshot: dict[str, Any], previous: dict[str, Any] | None) -> list[str]:
    """Every reason this snapshot must not replace the last good one."""
    errors: list[str] = []
    tickers = snapshot.get("tickers") or []
    calendar = snapshot.get("dates") or []

    minimum = max(int(TARGET_N * 0.9), 1)
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
        if ticker["ranks"].get("marketCap") is None:
            errors.append(f"{symbol}: missing market-cap rank")

    caps = [t["marketCap"] for t in tickers]
    if caps != sorted(caps, reverse=True):
        errors.append("tickers are not ordered by market cap")

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


def build_snapshot() -> dict[str, Any]:
    universe = build_universe()
    histories = load_history([e["symbol"] for e in universe])
    calendar = build_calendar(histories)

    # Work out metrics for every candidate first, in market-cap order. Selecting
    # before knowing which names survive would mean balancing sectors across
    # tickers that then drop out for want of history.
    eligible: list[dict[str, Any]] = []
    for entry in universe:
        series = histories.get(entry["symbol"]) or {}
        if not series:
            log(f"  skip {entry['symbol']}: no price history")
            continue
        metrics = compute_metrics(entry, align(series, calendar), calendar)
        if metrics is None:
            log(f"  skip {entry['symbol']}: fewer than {MIN_TICKER_SESSIONS} sessions")
            continue
        metrics["cik"] = entry["cik"]
        eligible.append(metrics)

    core = eligible[:CORE_N]
    counts: dict[str, int] = {}
    for ticker in core:
        counts[ticker["sector"]] = counts.get(ticker["sector"], 0) + 1
    log(f"core: {len(core)} by market cap, {len(counts)} sectors")

    sectors = len({t["sector"] for t in eligible})
    cap, floor = collar_bounds(TARGET_N, sectors)
    if SELECTION == "lookahead":
        balanced = select_balanced(eligible[CORE_N:], counts, BALANCED_N, LOOKAHEAD)
        detail = f"lookahead {LOOKAHEAD}"
    else:
        balanced = select_collar(eligible[CORE_N:], counts, BALANCED_N, cap, floor)
        detail = (f"cap {cap} ({SECTOR_CAP_PCT:g}%), floor {floor} ({SECTOR_FLOOR_PCT:g}%) "
                  f"over {sectors} sectors")
    if balanced:
        log(f"balanced: {len(balanced)} added from {len(eligible) - len(core)} "
            f"candidates via {detail}")

    tickers = core + balanced
    tickers.sort(key=lambda t: t["marketCap"], reverse=True)
    apply_rankings(tickers)

    spread = sorted(counts.items(), key=lambda kv: -kv[1])
    log("sectors: " + ", ".join(f"{name} {n}" for name, n in spread))

    latest = calendar[-1] if calendar else None
    return {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "dataDate": latest,
        "source": "Financial Modeling Prep",
        "universeSize": len(tickers),
        # How the universe was chosen, so a consumer can tell a pure market-cap
        # table from one that has been spread across sectors.
        "selection": {
            "method": SELECTION,
            "core": len(core),
            "balanced": len(balanced),
            **({"lookahead": LOOKAHEAD} if SELECTION == "lookahead" else {
                "sectorCapPct": SECTOR_CAP_PCT,
                "sectorFloorPct": SECTOR_FLOOR_PCT,
                "sectorCap": cap,
                "sectorFloor": floor,
            }),
        },
        "sessions": len(calendar),
        "dates": calendar,
        "tickers": tickers,
    }


def main() -> int:
    if not API_KEY:
        log("FMP_API_KEY (or API_KEY) is not set")
        return 2

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    previous = read_previous(OUTPUT_PATH)

    try:
        snapshot = build_snapshot()
    except PipelineError as exc:
        log(f"REFRESH FAILED: {exc}")
        log("previous snapshot left untouched" if previous else "no previous snapshot exists")
        return 1

    errors = validate(snapshot, previous)
    if errors:
        log(f"VALIDATION FAILED ({len(errors)} problems):")
        for err in errors[:25]:
            log(f"  - {err}")
        log("previous snapshot left untouched" if previous else "no previous snapshot exists")
        return 1

    # Write beside the target then rename: readers never observe a partial file,
    # and a crash mid-write cannot destroy the last good snapshot.
    tmp_path = f"{OUTPUT_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp_path, OUTPUT_PATH)

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    log(f"wrote {OUTPUT_PATH}: {snapshot['universeSize']} tickers, "
        f"{snapshot['sessions']} sessions, {size_kb:.0f} KB, data date {snapshot['dataDate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

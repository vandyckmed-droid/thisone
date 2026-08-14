# Top 300

Daily rankings for 300 large US common stocks — the 100 largest by market cap,
plus 200 more chosen to spread across sectors — on your phone, with no backend.

```
FMP  ->  build_snapshot.py  ->  validated snapshot.json  ->  GitHub  ->  Expo Go
```

A GitHub Action runs the pipeline after the US close and commits a single
static JSON file. The phone app fetches that file straight from GitHub. There
is no server, no database and no account anywhere in the loop.

---

## Repository layout

| Path | What it is |
| --- | --- |
| `scripts/build_snapshot.py` | The whole pipeline: universe, prices, metrics, validation, write |
| `scripts/bundle_snack.sh` | Folds `app/` into the single-file `app/snack/App.js` |
| `scripts/publish_snack.py` | Publishes that bundle as a Snack, prints a tap-to-open link |
| `scripts/make_snack_url.py` | A Snack link that keeps the project modular, for editing |
| `data/snapshot.json` | The published snapshot — the only file the app reads |
| `.github/workflows/refresh-snapshot.yml` | Post-close refresh |
| `app/` | React Native app for Expo Snack / Expo Go |

---

## 1. The pipeline

One script, standard library only, no `pip install` step.

```bash
export FMP_API_KEY=your_key
python3 scripts/build_snapshot.py
```

It runs in about 100 seconds at 300 names and does five things in order.

**Builds the universe.** The FMP screener is asked for a candidate pool several
times the size of the target, restricted to actively traded US common stocks on
NYSE and NASDAQ.

That pool needs real cleaning, because FMP reports every listing of an issuer
with the issuer's *entire* market cap. Left alone, the top of the table fills up
with duplicates and debt:

| Symbol | What FMP calls it | Reported cap |
| --- | --- | --- |
| `GOOG` | Alphabet Inc. | $4.17T — the same company as `GOOGL` |
| `BRK-A` | Berkshire Hathaway Inc. | $1.10T — the same company as `BRK-B` |
| `VZA` | Verizon Communications, 5.9% 15 Feb 2054 | $241B — a bond, not a share |
| `SOJE` | Southern Company (The) Series 2 | $107B — a preferred line |

Three filters remove all of it:

1. Names carrying a coupon, `NTS`, `PFD`, `Series N` or similar are dropped as
   debt and preferred lines.
2. Everything remaining is grouped by **CIK**, the SEC issuer number. Share
   classes and baby bonds share their parent's CIK, so each issuer collapses to
   one row and the most heavily traded listing wins — `BRK-B` over `BRK-A`,
   `VZ` over its 2054 notes.
3. A minimum average dollar volume drops anything too thin to be a real
   large-cap listing.

### Selecting the universe

The universe is then built in two parts.

The **core** is simply the largest `TOP_N` companies by market cap.

The **expansion** is chosen under a sector **collar** — a ceiling and a floor,
both expressed as a share of the finished universe:

```
SECTOR_CAP_PCT    = 20    no sector may hold more than 20% of the table
SECTOR_FLOOR_PCT  =  4    no sector present may hold less than 4%
```

Selection then runs in three passes: lift every sector to the floor, fill the
rest in plain market-cap order while no sector exceeds the cap, and — only if
the cap left the table short — relax it rather than publish fewer names than
asked for. That last case is logged loudly, because a breached guarantee should
never be quiet; it means the screen needs widening, not the cap loosening.

The point of percentages is that the same two numbers mean the same thing at
any size:

| Universe | Cap | Floor |
| --- | --- | --- |
| 25 | 5 | 1 |
| 100 | 20 | 4 |
| 200 | 40 | 8 |
| 300 | 60 | 12 |
| 1000 | 200 | 40 |
| 5000 | 1000 | 200 |

Percentages can also describe an impossible table, so the counts are made
feasible before use. Three sectors cannot fill 200 names under a 20% ceiling,
so the ceiling rises to 67; forty sectors cannot each be guaranteed 4% of 200,
so the floor drops to 5. The ceiling is fixed first, because a table that
cannot be filled is a worse failure than one less balanced than requested.

The shipped table of 300 lands on both bounds exactly:

| Sector | Names | Share |
| --- | --- | --- |
| Technology | 60 | 20.0% *(at the cap)* |
| Industrials | 49 | 16.3% |
| Financial Services | 47 | 15.7% |
| Healthcare | 32 | 10.7% |
| Consumer Cyclical | 25 | 8.3% |
| Energy | 19 | 6.3% |
| Consumer Defensive | 17 | 5.7% |
| Utilities | 15 | 5.0% |
| Communication Services | 12 | 4.0% *(at the floor)* |
| Real Estate | 12 | 4.0% *(at the floor)* |
| Basic Materials | 12 | 4.0% *(at the floor)* |

Measured at 200 names, the same collar cost six names and 0.1% of the market
cap it would otherwise have covered — every name it dropped sat at #167 or
below, the tail of the technology block rather than its household names.
Tightening the cap to 16% is where Adobe, Intuit and ADP start to fall out, so
20% is deliberately the gentle end of the dial.

### Why not a lookahead

An earlier version walked the candidates in market-cap order, looked at the next
five, and took the one from the least-represented sector. It is still in the
script and still selectable with `SELECTION=lookahead`, but the collar replaced
it as the default for one reason: **the collar states a guarantee, the lookahead
describes a procedure.** "No sector above 20%, none below 4%" can be checked
against the output. "Lookahead 5" can only be measured — and measuring it showed
it changed four names out of two hundred, which is far less than the name
suggests. Its whole effect is bounded by how far it can see: a starved sector
forty places down is unreachable, and a run of six same-sector names is taken in
full.

### Growing the universe

Nothing structural has to change to get bigger:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOP_N` | `100` | The market-cap core |
| `BALANCED_N` | `200` | Names added under the collar |
| `SECTOR_CAP_PCT` | `20` | Most of the table any one sector may hold |
| `SECTOR_FLOOR_PCT` | `4` | Least any sector present may hold |
| `SELECTION` | `collar` | Or `lookahead` for the earlier method |

`BALANCED_N=0` gives a pure market-cap table of `TOP_N`. The candidate pool and
the reserve size themselves off the target, so raising either number widens the
screen automatically.

**Downloads prices.** Roughly two years of dividend-adjusted daily closes per
ticker, fetched concurrently with retry and backoff.

**Computes metrics.** Returns over 1W/1M/3M/6M/YTD/1Y/2Y, annualised
volatility over 30d/90d/1Y, 1-year max drawdown, a return-per-unit-of-risk
ratio, and a momentum score blending the 3/6/9/12-month returns, with a rank
for each across the universe.

Every window long enough to afford it stops short of today by a share of its own
length -- 20 sessions per 250, so 5 off a quarter and 40 off two years. It is all
or nothing: skipping inside momentum but not in the returns table would put two
numbers labelled "6 month" on one screen measuring different things. Windows
below a quarter skip nothing, and `MOMENTUM_SKIP_RATIO=0` turns it off
everywhere. Rank 1 is always the desirable end, including for volatility, where
it means the *lowest*.

A window only produces a number when it is genuinely filled. A company that
listed six weeks ago reports a 30-day volatility and a null 1-year one, rather
than passing six weeks of noise off as a year.

**Validates.** Roughly a dozen checks: universe size, duplicate symbols,
surviving duplicate CIKs, non-positive prices or caps, implausible daily moves,
history lengths matching the shared calendar, cap ordering, staleness of the
latest session, and how much the universe overlaps the previous snapshot.

**Writes.** Only if every check passed, and then by atomic rename.

### Preserving the last good snapshot

Validation happens entirely in memory, before anything touches disk. A failed
refresh exits non-zero and leaves `data/snapshot.json` byte-for-byte
untouched, so the app keeps serving the last good data instead of a broken
file. Verified against a bad key, a missing key and a genuine validation
failure:

```
$ API_KEY=bogus python3 scripts/build_snapshot.py
REFRESH FAILED: company-screener: HTTP 401
previous snapshot left untouched                     exit 1, snapshot unchanged

$ HISTORY_DAYS=40 python3 scripts/build_snapshot.py
VALIDATION FAILED (1 problems):
  - calendar has 29 sessions, need 200
previous snapshot left untouched                     exit 1, snapshot unchanged
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FMP_API_KEY` | — | Required. `API_KEY` also works. |
| `TOP_N` | `100` | Size of the market-cap core |
| `BALANCED_N` | `200` | Names added under the sector collar |
| `SECTOR_CAP_PCT` | `20` | Ceiling per sector, as a share of the universe |
| `SECTOR_FLOOR_PCT` | `4` | Floor per sector, as a share of the universe |
| `SELECTION` | `collar` | Or `lookahead` for the earlier method |
| `MOMENTUM_SKIP_RATIO` | `0.08` | Share of **every** return window left off its recent end; `0` disables |
| `HISTORY_DAYS` | `850` | Calendar days requested; must cover the longest window plus its skip |
| `MAX_WORKERS` | `8` | Concurrent API requests |
| `OUTPUT` | `data/snapshot.json` | Where to write |

---

## 2. The snapshot

One file. Histories share a single top-level date axis, so each ticker stores
only a bare array of closes rather than repeating 523 date strings.

```jsonc
{
  "schema": 1,
  "generatedAt": "2026-08-14T00:04:30+00:00",
  "dataDate": "2026-08-13",
  "universeSize": 300,
  "selection": { "method": "collar", "core": 100, "balanced": 200,
                 "sectorCapPct": 20, "sectorFloorPct": 4,
                 "sectorCap": 60, "sectorFloor": 12 },
  "sessions": 523,
  "dates": ["2024-07-15", "..."],          // shared calendar
  "tickers": [
    {
      "symbol": "NVDA",
      "name": "NVIDIA Corporation",
      "sector": "Technology",
      "industry": "Semiconductors",
      "logo": "https://images.financialmodelingprep.com/symbol/NVDA.png",
      "cik": "0001045810",
      "marketCap": 5456991300000,
      "price": 225.3,
      "change": 1.21,
      "changePct": 0.54,
      "asOf": "2026-08-13",
      "returns":    { "1w": 2.1, "1m": 5.4, "3m": 9.9, "6m": 14.2,
                      "ytd": 18.0, "1y": 23.17, "2y": 61.4 },
      "volatility": { "30d": 39.02, "90d": 39.61, "1y": 36.65 },
      "maxDrawdown1y": -20.22,
      "riskAdjusted1y": 0.632,
      "momentumScore": 49.0,
      "ranks": { "marketCap": 1, "return_1y": 52, "volatility": 67, "...": 0 },
      "history": [118.42, null, "..."],    // aligned to `dates`
      "firstSession": "2024-07-15"
    }
  ]
}
```

`history` is padded with `null` before a ticker's first session, so a recent
listing charts from its IPO instead of dragging a flat line back through two
years it never traded. At 300 tickers over 584 sessions the file is about
**1.37 MB**.

---

## 3. Automation

`.github/workflows/refresh-snapshot.yml` runs at **22:30 UTC on weekdays** —
6:30pm ET in summer, 5:30pm ET in winter, both comfortably after the close and
after FMP settles its end-of-day bars. It can also be run by hand from the
Actions tab, optionally with a different universe size.

The commit step only runs if the build step succeeded, so a bad refresh leaves
the committed snapshot in place and simply shows up as a red run.

**Setup:** add the API key under *Settings → Secrets and variables → Actions →
New repository secret*, named `FMP_API_KEY`.

---

## 4. The app

```bash
python3 scripts/make_snack_url.py --branch main --check
```

That prints a Snack URL that loads every app file straight from GitHub — open
it, scan the QR code with Expo Go, done. See [`app/README.md`](app/README.md)
for the details and for pasting it in by hand.

Four screens — **Ranks**, **Watchlist**, **Ticker detail**, **Settings** —
in a dark, minimal, industrial theme with a single acid-green accent. The
watchlist, settings and last-fetched snapshot are held in `AsyncStorage` on the
phone. Fetching is cache-backed, so the app opens and stays usable with no
signal.

---

## 5. Expanding

Raise `TOP_N` for a bigger market-cap core, or `BALANCED_N` for more of the
sector-balanced expansion described above. Nothing else has to change.

Size scales linearly at roughly 4 KB per ticker: 100 tickers is 425 KB, 200 is
839 KB, 300 is 1.2 MB. All of it is still one fetch, and the app caches the last
good copy, so the practical ceiling is how long a cold open may take on a phone
rather than anything structural. Splitting chart histories into per-ticker files
is the escape hatch when that stops being comfortable — worth doing when it
actually bites, not before.

Splitting histories into per-ticker files is worth doing only once the single
JSON actually becomes too big to fetch comfortably. Until then one file is one
request, one cache entry and one thing that can fail.

---

Prices are dividend-adjusted daily closes from
[Financial Modeling Prep](https://financialmodelingprep.com). For information
only — not investment advice.

# Top 300

Daily rankings for large US common stocks on your phone, with no backend — the
300 largest by market cap, plus the 100 largest inside each of the eleven
sectors, as twelve static JSON files.

```
FMP  ->  build_snapshot.py  ->  validated JSON  ->  GitHub  ->  Expo Go
```

The pipeline is run by hand and commits static files. The phone app fetches
them straight from GitHub. There is no server, no database and no account
anywhere in the loop.

---

## Repository layout

| Path | What it is |
| --- | --- |
| `scripts/build_snapshot.py` | The whole pipeline: universe, prices, metrics, validation, write |
| `scripts/bundle_snack.sh` | Folds `app/` into the single-file `app/snack/App.js` |
| `scripts/publish_snack.py` | Publishes that bundle as a Snack, prints a tap-to-open link |
| `scripts/make_snack_url.py` | A Snack link that keeps the project modular, for editing |
| `data/index.json` | The list of universes — the first file the app reads |
| `data/snapshot.json` | The Top 300 |
| `data/sectors/*.json` | One file per sector, the 100 largest in each |
| `app/` | React Native app for Expo Snack / Expo Go |

---

## 1. The pipeline

One script, standard library only, no `pip install` step.

```bash
export FMP_API_KEY=your_key
python3 scripts/build_snapshot.py
```

It takes a few minutes and does five things in order.

**Builds the universe.** The FMP screener is asked for a candidate pool of
several thousand actively traded US common stocks on NYSE and NASDAQ.

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
   listing.

### Selecting the universes

Twelve tables, every one of them a plain "largest by market cap" list:

| Table | Contents |
| --- | --- |
| `snapshot.json` | The largest `TOP_N` companies overall |
| `sectors/<sector>.json` | The largest `SECTOR_N` companies within that sector |

There is no balancing, no quota and no collar. An earlier version selected the
universe under a sector cap and floor, which existed only to stop one sector
swamping a single table. Publishing the sectors as their own files answers that
directly: a sector file *is* the sector, so nothing needs spreading, and the
overall table is free to be the plain market-cap ordering it claims to be.

Each file **ranks its own members**. `LLY` is #41 of 300 on momentum in the
overall table and #23 of 100 in healthcare — the same company measured against
two different fields. The app says which field a placing came from everywhere it
shows one, because a bare `#23` would otherwise mean nothing.

Two sectors come up short of `SECTOR_N`: after the screen and the CIK dedupe,
Communication Services has 83 eligible names and Utilities 72. They are
published at whatever they reach rather than padded, and `index.json` reports
the real size.

The screen floor is `$250M`, well below large-cap, precisely so the smaller
sectors can reach a hundred names at all — at a $5B floor only five of the
eleven could.

**Downloads prices.** Roughly two years of dividend-adjusted daily closes per
ticker, fetched concurrently with retry and backoff. FMP rate-limits hard
enough to matter: concurrency is capped at 4, `429` is retried seven times
honouring `Retry-After`, and the run refuses to publish if any of the largest
`TOP_N` companies ended up without usable history. That guard exists because a
silent rate-limit once dropped `VZ`, `SCHW`, `BLK`, `BA`, `DIS`, `NEE` and `UNP`
from the table without failing the build.

**Computes metrics.** Returns over 1W/1M/3M/6M/YTD/1Y/2Y, annualised
volatility over 30d/90d/1Y, 1-year max drawdown, a return-per-unit-of-risk
ratio, and a momentum score blending the 3/6/9/12-month returns, with a rank for
each — computed separately inside every table.

Every window long enough to afford it stops short of today by a share of its own
length — 20 sessions per 250, so 5 off a quarter and 40 off two years. It is all
or nothing: skipping inside momentum but not in the returns table would put two
numbers labelled "6 month" on one screen measuring different things. Windows
below a quarter skip nothing, and `MOMENTUM_SKIP_RATIO=0` turns it off
everywhere. Rank 1 is always the desirable end, including for volatility, where
it means the *lowest*.

A window only produces a number when it is genuinely filled. A company that
listed six weeks ago reports a 30-day volatility and a null 1-year one, rather
than passing six weeks of noise off as a year.

**Validates.** Roughly a dozen checks per table: size, duplicate symbols,
surviving duplicate CIKs, non-positive prices or caps, implausible daily moves,
history lengths matching the shared calendar, cap ordering, staleness of the
latest session, and how much the universe overlaps the previous copy of that
same file.

**Writes.** Only if every check passed, and then by atomic rename.

### Preserving the last good files

Validation happens entirely in memory, before anything touches disk. A failed
refresh exits non-zero and leaves every published file byte-for-byte untouched,
so the app keeps serving the last good data instead of a broken one. Verified
against a bad key, a missing key and a genuine validation failure:

```
$ API_KEY=bogus python3 scripts/build_snapshot.py
REFRESH FAILED: company-screener: HTTP 401
previous snapshot left untouched                     exit 1, files unchanged

$ HISTORY_DAYS=40 python3 scripts/build_snapshot.py
VALIDATION FAILED (1 problems):
  - calendar has 29 sessions, need 200
previous snapshot left untouched                     exit 1, files unchanged
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FMP_API_KEY` | — | Required. `API_KEY` also works. |
| `TOP_N` | `300` | Size of the overall table |
| `SECTOR_N` | `100` | Size of each sector table |
| `MIN_MARKET_CAP` | `250000000` | Screen floor |
| `MIN_DOLLAR_VOLUME` | `3000000` | Average daily traded value floor |
| `CANDIDATE_POOL` | `4000` | How many names the screener is asked for |
| `MOMENTUM_SKIP_RATIO` | `0.08` | Share of **every** return window left off its recent end; `0` disables |
| `HISTORY_DAYS` | `850` | Calendar days requested; must cover the longest window plus its skip |
| `MAX_WORKERS` | `4` | Concurrent API requests |
| `DATA_DIR` | `data/` | Where to write |

---

## 2. The files

### `index.json`

The only path the app has to know. Everything else is discovered from it, so
adding a universe is a matter of writing a file and adding a line here.

```jsonc
{
  "generatedAt": "2026-08-14T06:48:21+00:00",
  "dataDate": "2026-08-13",
  "sessions": 584,
  "universes": [
    { "key": "all",        "title": "Top 300",   "scope": "all",
      "size": 300, "file": "snapshot.json" },
    { "key": "healthcare", "title": "Healthcare","scope": "sector",
      "size": 100, "file": "sectors/healthcare.json" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `key` | Stable id — the app's cache key and remembered selection |
| `title` | What the picker shows |
| `scope` | `all` or `sector`; drives whether the app offers a sector or an industry filter |
| `size` | Row count, shown in the picker before the file is fetched |
| `file` | Path relative to the directory `index.json` was read from |

### A universe file

Histories share a single top-level date axis, so each ticker stores only a bare
array of closes rather than repeating 584 date strings.

```jsonc
{
  "schema": 2,
  "generatedAt": "2026-08-14T06:48:21+00:00",
  "dataDate": "2026-08-13",
  "title": "Top 300",
  "scope": "all",
  "universeSize": 300,
  "sessions": 584,
  "skip":     { "ratio": 0.08, "returns": { "1y": 20, "...": 0 },
                "momentum": { "3m": 5, "6m": 10, "9m": 15, "12m": 20 } },
  "momentum": { "windows": { "3m": 63, "6m": 126, "9m": 189, "12m": 252 } },
  "dates": ["2024-04-16", "..."],          // shared calendar
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
      "returns":         { "1w": 2.88, "1m": 6.02, "3m": 5.49, "6m": 1.96,
                           "ytd": 5.76, "1y": 21.66, "2y": 71.83 },
      "momentumReturns": { "3m": 5.49, "6m": 1.96, "9m": 14.44, "12m": 21.66 },
      "volatility":      { "30d": 39.02, "90d": 39.61, "1y": 36.65 },
      "maxDrawdown1y": -20.22,
      "riskAdjusted1y": 0.591,
      "momentumScore": 46.4,
      "ranks": { "marketCap": 1, "return_1y": 154, "volatility": 202, "...": 0 },
      "history": [118.42, null, "..."],    // aligned to `dates`
      "firstSession": "2024-04-16"
    }
  ]
}
```

`history` is padded with `null` before a ticker's first session, so a recent
listing charts from its IPO instead of dragging a flat line back through two
years it never traded.

Sizes: the Top 300 is **1.37 MB**, each sector file 310–460 KB, **5.9 MB** for
all twelve. Nothing fetches all of them at once — the app pulls the index, then
one universe, then others only as they are opened.

---

## 3. Updating

By hand, whenever the data should move:

```bash
export FMP_API_KEY=your_key
python3 scripts/build_snapshot.py
git add data && git commit -m "Refresh data" && git push
```

That is the whole procedure. The app reads `data/` from `main` at runtime, so a
push reaches every already-published Snack link without republishing anything —
data and app are refreshed independently, and only an app change needs a new
Snack.

There is no scheduled workflow. An earlier version ran the pipeline nightly from
GitHub Actions; it was removed in favour of updating deliberately, which is also
one fewer place for an API key to live.

---

## 4. The app

```bash
scripts/bundle_snack.sh
python3 scripts/publish_snack.py
```

That folds `app/src` into one file, publishes it as a Snack and prints a
tap-to-open `exp://` link. See [`app/README.md`](app/README.md) for the details,
including why the SDK version is the whole difficulty.

Four screens — **Ranks**, **Watchlist**, **Ticker detail**, **Settings** — in a
dark, minimal, industrial theme with a single acid-green accent.

**Ranks** heads with the universe itself as the control: tap the title to swap
between the Top 300 and any sector. A table already visited is painted from
cache instantly and freshened behind you; one never opened before leaves the
current list in place until its replacement is in hand, rather than blanking the
screen. The sector filter is offered on the whole-market table and an *industry*
filter inside a sector table, since every row there already shares a sector.

**Watchlist** spans universes. A name starred in Energy and a name starred in
the Top 300 sit in one list, and the numbers down the left are places within
that list — a rank carried over from a table would put #4 of 300 beside #4 of
100 as though they were comparable. If a star belongs to a table not loaded yet,
the app pulls it in the background and says so.

The watchlist, settings and every table opened are held in `AsyncStorage` on the
phone. Fetching is cache-backed at both levels, so the app opens and stays
usable with no signal.

---

## 5. Adding a universe

The app has no list of universes compiled into it — it reads `index.json`. So
any table matching the schema above appears in the picker as soon as it is
listed there: an industry, a theme, a personal basket. Point the app's data URL
(Settings → Advanced) at any directory holding an `index.json` and its files,
including a branch or a local server, and it will serve that instead.

---

Prices are dividend-adjusted daily closes from
[Financial Modeling Prep](https://financialmodelingprep.com). For information
only — not investment advice.

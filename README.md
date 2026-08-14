# Top 300

Daily rankings for large US common stocks, with no backend — the 600 largest by
market cap as two bands of 300, plus the 100 largest inside each of the eleven
sectors, as thirteen static JSON files.

```
FMP  ->  build_snapshot.py  ->  validated JSON  ->  build_web.py  ->  one HTML file
```

The pipeline is run by hand and commits static files. The app is a single
self-contained web page built from them. There is no server, no database and no
account anywhere in the loop.

---

## Repository layout

| Path | What it is |
| --- | --- |
| `scripts/build_snapshot.py` | The whole pipeline: universe, prices, benchmarks, metrics, validation, write |
| `scripts/remetric.py` | Replays changed formulas over the committed history; `--fetch-benchmarks` refreshes the factor series |
| `scripts/fetch_logos.py` | Caches every company logo into `web/logos.json` |
| `scripts/build_web.py` | Folds `data/` and the logos into one self-contained page |
| `web/index.template.html` | The app itself — edit here |
| `web/logos.json` | Base64 WebP logos by symbol, plus which are opaque |
| `data/index.json` | The list of universes — the first file the app reads |
| `data/snapshot.json` | The Top 300 |
| `data/next300.json` | The next 300, ranks 301-600 by market cap |
| `data/sectors/*.json` | One file per sector, the 100 largest in each |
| `app/src/` | The retired React Native original, kept for reference |

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

Thirteen tables, every one of them a plain "largest by market cap" list:

| Table | Contents |
| --- | --- |
| `snapshot.json` | The largest `TOP_N` companies overall |
| `next300.json` | The `NEXT_N` companies ranked just below them |
| `sectors/<sector>.json` | The largest `SECTOR_N` companies within that sector |

The two whole-market bands are separate universes rather than one list of six
hundred, for the same reason a sector file ranks itself: a placing only means
something against the field it was measured in, so a company is #1 of the next
300 rather than #301 overall.

There is no balancing, no quota and no collar. An earlier version selected the
universe under a sector cap and floor, which existed only to stop one sector
swamping a single table. Publishing the sectors as their own files answers that
directly: a sector file *is* the sector, so nothing needs spreading, and the
overall table is free to be the plain market-cap ordering it claims to be.

Nothing here is ranked. Every placing and every score the app shows is measured
against the rows the reader has on screen at that moment — the Top 300, one
sector, or the Top 300 filtered down to healthcare, which is a different field
again. A rank frozen at build time could only ever answer the unfiltered
question, so the files publish the raw measures and the app does the ranking.

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

**Downloads benchmarks.** The same fetch again for thirteen funds: `VTI` as
the whole-market factor and one SPDR fund per sector (`XLK`, `XLV`, `XLF`,
`XLY`, `XLP`, `XLE`, `XLI`, `XLB`, `XLU`, `XLRE`, `XLC`), aligned to the same
shared calendar and published under each table's `benchmarks` key. They are
funds, not companies, so they never appear as rows -- they exist because the
app's scoring regresses against them.

**Computes metrics.** Returns over 1W/1M/3M/6M/YTD/1Y/2Y, annualised
volatility over 30d/90d/1Y, and 1-year max drawdown.

Every return window runs to the last close. A "3 month return" is the plain move
over three months, so it can be checked against any other source.

**Momentum is deliberately not computed here.** The score is built by the app
at view time, because every part of its formula is a control the reader can
change -- and a score frozen at build time could only ever answer one
configuration. The formula system:

| Setting | Meaning | Default |
| --- | --- | --- |
| Lookback | 63 / 126 / 189 / 252 trading days | 252 and 126, blended |
| Skip | exclude the most recent round(lookback/12) sessions: 5 / 10 / 16 / 21 | on |
| Volatility adjust | divide the window's mean daily log return by its own daily volatility | on |
| Market residual | regress on VTI over the 504 sessions ending at the window's cutoff; score return − β·VTI | on |
| Sector residual | regress on VTI + the sector's SPDR fund together; score what neither explains | off |
| Blend | score two windows independently, combine the raw scores 50/50 | on |

So the default score is

```
0.5 · score(12M, skip 21)  +  0.5 · score(6M, skip 10)

where score(w) = mean daily residual log return(w) / daily volatility of those residuals(w)
      residual = stock return − β·VTI,  β estimated over the 504 sessions ending at w's cutoff
```

Windows are counted in trading days from the as-of date rather than snapped to
calendar months, which keeps the skip a fixed stretch behind the last close
every day of the year. Nothing is annualised: a constant sqrt(252) reorders
nothing, and annualising one half of a ratio inflates exactly the most extreme
names.

A window is all-or-nothing -- a company must have traded every session of it,
and carry at least 252 sessions of paired history when a residual toggle needs
a beta -- otherwise it scores nothing. A partial window would hand a younger
company a different question, not a worse answer. The same discipline applies
to the plain windows: a company that listed six weeks ago reports a 30-day
volatility and a null 1-year one, rather than passing six weeks of noise off
as a year.

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
| `HISTORY_DAYS` | `850` | Calendar days requested; must cover the 504-session beta estimation plus the deepest skip |
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
  "schema": 3,
  "generatedAt": "2026-08-14T06:48:21+00:00",
  "dataDate": "2026-08-13",
  "title": "Top 300",
  "scope": "all",
  "universeSize": 300,
  "sessions": 584,
  "benchmarks": {                          // the factor series the score
    "market":  { "symbol": "VTI",          // regresses against, aligned to
                 "history": [242.27, "..."] },  // the same shared calendar
    "sectors": { "Technology": { "symbol": "XLK", "history": ["..."] },
                 "Healthcare": { "symbol": "XLV", "history": ["..."] } }
  },
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
      "volatility":      { "30d": 39.02, "90d": 39.61, "1y": 36.65 },
      "maxDrawdown1y": -20.22,
      "history": [118.42, null, "..."],    // aligned to `dates`
      "firstSession": "2024-04-16"
    }
  ]
}
```

There is no momentum field anywhere in the file. The score depends on the
reader's formula settings, so the app computes it from `history` and
`benchmarks` at view time; a sector file carries only its own sector's factor
series, the overall table carries all eleven.

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
python3 scripts/fetch_logos.py           # only if the universe gained symbols
python3 scripts/build_web.py             # then republish web/top300.html
git add -A && git commit -m "Refresh data" && git push
```

The rebuild and republish are not optional. The published page is
self-contained — it makes no network requests at all — so committing fresh
`data/` changes nothing anyone can see until the page is rebuilt from it and
published over the same URL.

There is no scheduled workflow. An earlier version ran the pipeline nightly from
GitHub Actions; it was removed in favour of updating deliberately, which is also
one fewer place for an API key to live.

---

## 4. The app

```bash
python3 scripts/build_web.py
```

That folds `data/` and `web/logos.json` into `web/top300.html`, one file with no
external references of any kind, which is then published as a Claude Artifact
and opened by URL on a phone or a desktop.

Everything is inlined because the artifact host's Content-Security-Policy blocks
every outbound request — no data fetch, no logo CDN, no fonts. That is also why
the logos are cached into the repo as base64 WebP rather than loaded from the
issuer's CDN the way the original app loaded them. Logos come in two kinds and
the tile has a mode for each: a transparent mark sits inset on the dark tile,
while art baked onto its own background fills the tile edge to edge like an app
icon. `fetch_logos.py` sorts them out by measuring the alpha channel.

The app was previously an Expo Snack. Expo's own Snack runtime began returning
`HTTP 429 — Monthly Updating Users exceeded` for hours at a time, which left
every Snack in the world stuck on "Connecting…" before a line of app code ran,
and no anonymous Snack link could be updated in place. The web edition owes
Expo nothing and republishes over one stable URL.

Three screens — **Ranks**, **Watchlist**, **Ticker detail** — in a dark,
minimal, industrial theme with a single acid-green accent. The watchlist and
the score formula persist in `localStorage`; everything positional resets.

The **score formula is built in the app**, from the ƒ chip beside the sort
chips: pick one lookback window or a 50/50 blend of two, and toggle the skip,
the volatility adjustment, and the market or sector residual. Every change
applies immediately — scores, standings and orderings are recomputed on the
spot against whatever rows are on screen, because none of it is precomputed in
the data. With the skip on, the charts grey the sessions the score cannot see.

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

Every table is already in the page, so switching universes and opening a ticker
are instant and the app works with no signal at all.

---

## 5. Adding a universe

The app has no list of universes compiled into it — the build reads
`index.json`. So any table matching the schema above appears in the picker as
soon as it is listed there and the page is rebuilt: an industry, a theme, a
personal basket.

---

Prices are dividend-adjusted daily closes from
[Financial Modeling Prep](https://financialmodelingprep.com). For information
only — not investment advice.

# Top 300

Daily rankings for large US common stocks, with no backend — the 300 largest by
market cap, plus the 100 largest inside each of the eleven sectors, as twelve
static JSON files.

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
| `scripts/build_snapshot.py` | The whole pipeline: universe, prices, metrics, validation, write |
| `scripts/remetric.py` | Replays changed formulas over the committed history, no refetch |
| `scripts/fetch_logos.py` | Caches every company logo into `web/logos.json` |
| `scripts/build_web.py` | Folds `data/` and the logos into one self-contained page |
| `web/index.template.html` | The app itself — edit here |
| `web/logos.json` | Base64 WebP logos by symbol, plus which are opaque |
| `data/index.json` | The list of universes — the first file the app reads |
| `data/snapshot.json` | The Top 300 |
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

**Computes metrics.** Returns over 1W/1M/3M/6M/YTD/1Y/2Y, annualised
volatility over 30d/90d/1Y, 1-year max drawdown, and momentum.

Every return window runs to the last close. A "3 month return" is the plain move
over three months, so it can be checked against any other source, and the
skipping that momentum needs lives inside momentum rather than being spread
across the whole table.

**Momentum (`mom`)** scores eleven blocks of 21 trading days one at a time and
adds the results. For each block: average every daily log return inside it, then
divide by the daily volatility of the 63 sessions ending at that block's last
close.

```
                11
mom  =         SUM   mean daily log return(block b)
              b = 1  ───────────────────────────────
                     daily volatility(63 sessions to end of block b)
```

The blocks roll with the as-of date rather than snapping to calendar months. The
most recent 21 trading days are skipped, and the 231 before them divide into the
eleven blocks -- 252 sessions in all, so the measure spans a year ending a month
back. That is twelve-minus-one counted in sessions.

Counting in sessions keeps the cutoff a fixed month behind the last close every
day of the year. Waiting for the calendar to turn instead would mean that by the
end of a month the score is blind to nearly two, with the skip breathing between
one month and two depending on when the pipeline happened to run.

Each table records its blocks and the last session the score covers in
`mom.through`, and the app greys everything after it. The month labels the app
puts under the bars are only where each block happens to end.

Volatility spans 63 sessions rather than the block itself because 21 returns are
far too few for a stable estimate when it sits in the denominator of every term.

Both halves of each term are daily quantities, so a monthly score is a unitless
daily Sharpe and the sum needs no annualising. Annualising both halves only
multiplies the result by a constant -- for the record, sqrt(252) -- which
changes no ordering at all.

Summing eleven terms rather than measuring one long window is what makes this a
consistency measure. A company that climbed steadily all year scores in every
term; one that doubled in a fortnight and drifted for ten blocks collects once
and contributes nothing across the rest. Values run about -2 to +3.

All eleven blocks or nothing: a sum over whichever blocks happened to exist
would give a younger company a smaller number rather than a worse one, which is
not a ranking. Block boundaries come from the shared calendar as dates, so every
company in a table is scored over exactly the same stretches of trading.

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
  "mom": { "blocks": [ { "from": "2025-08-13", "to": "2025-09-11",
                         "volFrom": "2025-06-12" }, "..." ],
           "blockSessions": 21, "skipSessions": 21, "volSessions": 63,
           "through": "2026-07-15" },
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
      "momBlocks":       [ 0.238, -0.031, 0.194, "..." ],
      "volatility":      { "30d": 39.02, "90d": 39.61, "1y": 36.65 },
      "maxDrawdown1y": -20.22,
      "mom": 0.320,
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
minimal, industrial theme with a single acid-green accent. Sort, open universe
and watchlist persist in `localStorage`.

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

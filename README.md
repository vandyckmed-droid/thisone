# Top 100

Daily market-cap rankings for the 100 largest US common stocks, on your phone,
with no backend.

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

It runs in about 30 seconds and does five things in order.

**Builds the universe.** The FMP screener is asked for a candidate pool three
times the size of the target, restricted to actively traded US common stocks on
NYSE and NASDAQ.

That pool needs real cleaning, because FMP reports every listing of an issuer
with the issuer's *entire* market cap. Left alone, the top 100 fills up with
duplicates and debt:

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

**Downloads prices.** Roughly two years of dividend-adjusted daily closes per
ticker, fetched concurrently with retry and backoff.

**Computes metrics.** Returns over 1W/1M/3M/6M/YTD/1Y/2Y, annualised
volatility over 30d/90d/1Y, 1-year max drawdown, a return-per-unit-of-risk
ratio, a blended momentum score, and a rank for each of those across the
universe. Rank 1 is always the desirable end, including for volatility, where
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
| `TOP_N` | `100` | Universe size |
| `HISTORY_DAYS` | `760` | Calendar days of history requested |
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
  "universeSize": 100,
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
years it never traded. At 100 tickers the file is about **417 KB**.

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

See [`app/README.md`](app/README.md) for the two-minute Expo Snack setup.

Four screens — **Ranks**, **Watchlist**, **Ticker detail**, **Settings** —
in a dark, minimal, industrial theme with a single acid-green accent. The
watchlist, settings and last-fetched snapshot are held in `AsyncStorage` on the
phone. Fetching is cache-backed, so the app opens and stays usable with no
signal.

---

## 5. Expanding

Raise `TOP_N`. Nothing else has to change — the structure is identical and the
workflow accepts it as an input. A 400-ticker run produces a 1.6 MB file, which
is still a single fetch.

Splitting histories into per-ticker files is worth doing only once the single
JSON actually becomes too big to fetch comfortably. Until then one file is one
request, one cache entry and one thing that can fail.

---

Prices are dividend-adjusted daily closes from
[Financial Modeling Prep](https://financialmodelingprep.com). For information
only — not investment advice.

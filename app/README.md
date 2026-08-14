# Top 100 — phone app

React Native for [Expo Snack](https://snack.expo.dev), opened through Expo Go
on an iPhone. No build step, no App Store, no accounts.

## Running it

Generate a one-click Snack link:

```bash
python3 scripts/make_snack_url.py --branch main --check
```

Open the printed URL, install **Expo Go** from the App Store, and scan the QR
code with the iPhone camera. There is nothing to copy and paste.

Snack's `files` query parameter accepts externally hosted code, so the URL
lists each file's `raw.githubusercontent.com` address rather than inlining the
source. You get the real modular project in the Snack editor — not a flattened
bundle — and a push to the branch shows up on the next load. The two
dependencies are passed as their own query parameter, so Snack resolves
versions matching whichever SDK it is running; both ship with Expo Go, so
nothing installs on the phone.

`--check` verifies every referenced file resolves before printing the link,
which is worth running after a rename.

While the app lives on an unmerged branch, point it at both that branch's code
*and* its snapshot:

```bash
python3 scripts/make_snack_url.py \
  --branch claude/financial-modeling-top-100-9g4jp3 \
  --data-branch claude/financial-modeling-top-100-9g4jp3 --check
```

`--data-branch` inlines a one-line override of `src/source.js`. Without it the
app reads from `main`, which has no `snapshot.json` until the branch merges,
and opens on the error screen. Once merged, drop the flag.

### Pasting it in by hand

If you would rather not use a generated link, create a blank Snack and
recreate this tree, adding `react-native-svg` and
`@react-native-async-storage/async-storage` in the dependencies pane:

```
App.js
src/source.js   src/theme.js   src/storage.js   src/data.js
src/components/{Sparkline,PriceChart,TickerRow,UI}.js
src/screens/{Ranks,Watchlist,Ticker,Settings}Screen.js
```

## Pointing it at your data

The default source is:

```
https://raw.githubusercontent.com/vandyckmed-droid/thisone/main/data/snapshot.json
```

Change it under **CONFIG → DATA SOURCE** to read from a fork, a branch, or a
local server while you are working on the pipeline. The app appends a
cache-buster to every request, because GitHub's raw CDN would otherwise keep
serving yesterday's file for several minutes after a refresh lands.

## Screens

**RANKS** — the full universe. Eleven sort columns along the top (market cap,
1D through 1Y, YTD, momentum, return/risk, volatility); tap the active one
again to invert it. Below that, sector filters and a symbol/name search. Each
row carries a rank, logo, 90-session sparkline, price and the metric being
sorted on. Tap to open a ticker, press and hold to star it.

Sorting is always best-first, which for the volatility column means the
*lowest* — so `#1` reads the same way in every column.

**WATCH** — starred tickers only, with the same sort columns and an unweighted
average of the day's moves. It is a watchlist, not a portfolio: no positions,
no sizes, no cost basis.

**Ticker detail** — price and day change, a scrubable chart over
1M/3M/6M/1Y/2Y/MAX (drag across it to read any session), then returns, risk and
this ticker's rank in each metric. Figures the ticker has not traded long
enough to support are blank rather than misleading.

**CONFIG** — snapshot URL, default sort, logo and sparkline toggles,
refresh-on-open, what the current snapshot contains, and buttons to clear the
watchlist or reset everything.

## Storage

`AsyncStorage`, three keys, all on the phone:

| Key | Holds |
| --- | --- |
| `@top100/watchlist` | Starred symbols |
| `@top100/settings` | Source URL, default sort, display toggles |
| `@top100/snapshot` | Last successfully fetched snapshot |

That third key is why the app opens offline. Every fetch falls back to it when
the network fails, when GitHub returns an error, or when the payload comes back
malformed — the cached snapshot is only replaced by a response that parses and
contains tickers. The banner tells you when you are looking at cached data.
With no cache and no network, the app shows an error screen with a retry and a
shortcut into CONFIG.

Stored settings are merged over defaults on load, so a key added in a later
version does not come back undefined for anyone who already has settings saved.

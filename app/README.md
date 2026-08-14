# Top 300 — phone app

React Native for [Expo Snack](https://snack.expo.dev), opened through Expo Go
on an iPhone. No build step, no App Store, no accounts.

## Running it

The shortest link uses Snack's `sourceUrl`, which loads a single file:

```bash
scripts/bundle_snack.sh                 # writes app/snack/App.js
```

```
https://snack.expo.dev/?sourceUrl=<raw url to app/snack/App.js>
  &dependencies=react-native-svg,@react-native-async-storage/async-storage,expo-haptics
  &platform=mydevice&theme=dark
```

`app/snack/App.js` is a **generated artifact** — edit `app/src/`, then
regenerate. Pass `--data-branch BRANCH` to pin the bundled data directory to a
branch while previewing before a merge.

### Or keep the project modular

Generate a link that loads every module separately:

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
*and* its data:

```bash
python3 scripts/make_snack_url.py \
  --branch claude/financial-modeling-top-100-9g4jp3 \
  --data-branch claude/financial-modeling-top-100-9g4jp3 --check
```

`--data-branch` inlines a replacement `src/source.js`. Without it the app reads
from `main`, which may not yet hold the files the branch expects, and opens on
the error screen. Once merged, drop the flag.

### Pasting it in by hand

If you would rather not use a generated link, create a blank Snack and
recreate this tree, adding `react-native-svg`,
`@react-native-async-storage/async-storage` and `expo-haptics` in the
dependencies pane:

```
App.js
src/source.js   src/theme.js   src/storage.js   src/data.js
src/haptics.js
src/components/{svg,Sparkline,PriceChart,TickerRow,UI}.js
src/screens/{Ranks,Watchlist,Ticker,Settings}Screen.js
```

`src/components/svg.js` is the only module allowed to import
`react-native-svg`; everything else goes through it. Importing the package from
three files evaluates it three times and Expo Go dies with *"Tried to register
two views with the same name RNSVGCircle"*.

## Pointing it at your data

The default source is a **directory**, not a file:

```
https://raw.githubusercontent.com/vandyckmed-droid/thisone/main/data/
```

The app reads `index.json` from it, then whichever file that index names. So
there is no list of universes compiled into the app — anything listed in the
index appears in the picker.

Change it under **SETTINGS → ADVANCED** to read from a fork, a branch, or a
local server while you are working on the pipeline. A pasted `snapshot.json` or
`index.json` URL is trimmed back to its directory rather than rejected. The app
appends a cache-buster to every request, because GitHub's raw CDN would
otherwise keep serving yesterday's file for several minutes after a refresh
lands.

## Screens

**RANKS** — one universe at a time, and the heading *is* the control: tap
`TOP 300` to swap to any sector. A table visited before is painted from cache
instantly and freshened behind you; one opened for the first time leaves the
current list in place until its replacement arrives, rather than blanking the
screen while it loads.

Ten sort columns along the top (market cap, 1D through 1Y, momentum,
return/risk, volatility); tap the active one again to invert it. Above them, a
symbol/name search sharing its row with a single filter — **sector** on the
whole-market table, **industry** inside a sector table, since every row there
already shares a sector. Either opens a sheet listing the values and how many
tickers each holds.

Each row carries a rank, logo, 90-session sparkline, price and the metric being
sorted on, and a trailing star that adds it to the watchlist. Tracked rows carry
an acid left edge and a faint tint. Tap anywhere else on the row to open the
ticker.

Ranks are computed inside each file, so `#4` in the Top 300 and `#4` in
Utilities are different claims. Every placing the app shows names the universe
it was measured against.

The sparkline is coloured by its own 90-session direction, not by the day, so
a stock can show a red trend line beside a green daily move — the line is
telling you about the quarter, the number about today.

Sorting is always best-first, which for the volatility column means the
*lowest* — so `#1` reads the same way in every column.

**WATCH** — starred tickers only, spanning universes: a name starred in Energy
sits beside one starred in the Top 300. The numbers down the left are places
*within this list*, because a rank carried over from a table would put #4 of 300
next to #4 of 100 as though they were comparable. If a star belongs to a table
not loaded yet, the app fetches it in the background and the subtitle says so.

Same sort columns, plus an unweighted average of the day's moves. It is a
watchlist, not a portfolio: no positions, no sizes, no cost basis.

**Ticker detail** — price and market cap, a scrubable chart over
1M/3M/6M/9M/1Y/2Y/MAX (drag across it to read any session), then returns, risk,
momentum and this ticker's rank in each metric. Momentum carries a
`HOW MOMENTUM WORKS ›` row that explains the construction on demand rather than
parking a paragraph under every ticker. Figures the ticker has not traded long
enough to support are blank rather than misleading.

**SETTINGS** — default sort, logo, sparkline and haptics toggles,
refresh-on-open, what the open table contains, the whole index behind a
disclosure, the data directory URL under ADVANCED, and buttons to clear the
watchlist or reset everything.

## Storage

`AsyncStorage`, all on the phone:

| Key | Holds |
| --- | --- |
| `@top100/watchlist` | Starred symbols |
| `@top100/settings` | Data URL, open universe, default sort, display toggles |
| `@top100/index` | Last successfully fetched `index.json` |
| `@top100/universe/<key>` | Last successfully fetched copy of that universe |

The cache is per universe, which is why switching back to a sector is instant
and why every table you have opened still works on a plane. Every fetch falls
back to its own cached copy when the network fails, when GitHub returns an
error, or when the payload comes back malformed — a cached table is only
replaced by a response that parses and contains tickers. The banner tells you
when you are looking at cached data. With no cache and no network, the app shows
an error screen with a retry and a shortcut into SETTINGS.

Only the open universe is fetched at launch; the rest arrive as they are opened,
so a cold start is one ~1.4 MB file rather than all 5.9 MB.

Stored settings are merged over defaults on load, so a key added in a later
version does not come back undefined for anyone who already has settings saved.

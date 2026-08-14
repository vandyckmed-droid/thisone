# Top 100 — phone app

React Native for [Expo Snack](https://snack.expo.dev), opened through Expo Go
on an iPhone. No build step, no App Store, no accounts.

## Running it

1. Open [snack.expo.dev](https://snack.expo.dev).
2. Recreate this file tree in the Snack file panel and paste each file in:

   ```
   App.js
   package.json
   src/theme.js
   src/storage.js
   src/data.js
   src/components/Sparkline.js
   src/components/PriceChart.js
   src/components/TickerRow.js
   src/components/UI.js
   src/screens/RanksScreen.js
   src/screens/WatchlistScreen.js
   src/screens/TickerScreen.js
   src/screens/SettingsScreen.js
   ```

   Snack reads dependencies from `package.json`, so
   `react-native-svg` and `@react-native-async-storage/async-storage` resolve
   on their own. Both ship with Expo Go — nothing needs installing on the phone.

3. Install **Expo Go** from the App Store, then scan the QR code in the Snack
   toolbar with the iPhone camera.

Snack can also import this folder directly from GitHub — use *Import from
GitHub* and point it at the `app/` directory — which saves the copy-paste.

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

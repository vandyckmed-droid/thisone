import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Banner, Loading, Snackbar } from './src/components/UI';
import {
  changeOver, downsample, fetchIndex, fetchUniverse, findUniverse, seriesFor,
} from './src/data';
import { setHapticsEnabled, tick } from './src/haptics';
import RanksScreen from './src/screens/RanksScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TickerScreen from './src/screens/TickerScreen';
import WatchlistScreen from './src/screens/WatchlistScreen';
import {
  DEFAULT_SETTINGS,
  clearAll,
  loadCachedIndex,
  loadCachedUniverse,
  loadSettings,
  loadWatchlist,
  saveSettings,
  saveWatchlist,
} from './src/storage';
import { C, MONO, S, T } from './src/theme';

const TABS = [
  { key: 'ranks', label: 'RANKS' },
  { key: 'watchlist', label: 'WATCH' },
  { key: 'settings', label: 'SETTINGS' },
];

const SPARK_SESSIONS = 90;
const SPARK_POINTS = 24;
const FEEDBACK_MS = 6000;
const UNDO_MS = 6000;

/** Sparkline geometry, derived once per table rather than once per render. */
const decorate = (table) =>
  table.tickers.map((t) => {
    const points = seriesFor(t, table.dates, SPARK_SESSIONS);
    return { ...t, spark: downsample(points, SPARK_POINTS), sparkChange: changeOver(points) };
  });

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [watchlist, setWatchlist] = useState([]);

  // The index names the universes on offer; `tables` holds the ones fetched so
  // far, keyed the same way, so switching back to a sector already visited is
  // instant and the watchlist can reach across all of them.
  const [index, setIndex] = useState(null);
  const [tables, setTables] = useState({});
  const [pendingKey, setPendingKey] = useState(null);

  const [tab, setTab] = useState('ranks');
  const [openSymbol, setOpenSymbol] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);
  const [undoItem, setUndoItem] = useState(null);

  // Sort, search and the sector/industry cut live here rather than inside the
  // screens, so they survive opening a ticker and switching tabs.
  const [ranksState, setRanksState] = useState({
    sortKey: DEFAULT_SETTINGS.defaultSort, direction: 'desc', query: '', sector: 'All', industry: 'All',
  });
  const [watchState, setWatchState] = useState({ sortKey: 'change' });

  const ranksList = useRef(null);
  const watchList = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const indexRef = useRef(index);
  indexRef.current = index;
  // Universes whose fetch failed, so the watchlist hydration below gives up on
  // them instead of retrying in a loop.
  const skipHydrate = useRef(new Set());

  const patchRanks = useCallback((p) => setRanksState((prev) => ({ ...prev, ...p })), []);
  const patchWatch = useCallback((p) => setWatchState((prev) => ({ ...prev, ...p })), []);

  const universeKey = settings.universeKey;
  const snapshot = tables[universeKey] || null;

  // The haptics module holds its own enabled flag so call sites stay terse.
  useEffect(() => { setHapticsEnabled(settings.haptics); }, [settings.haptics]);

  useEffect(() => {
    if (!refreshResult) return undefined;
    const timer = setTimeout(() => setRefreshResult(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [refreshResult]);

  useEffect(() => {
    if (!undoItem) return undefined;
    const timer = setTimeout(() => setUndoItem(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undoItem]);

  const store = useCallback((key, table) => {
    setTables((prev) => ({ ...prev, [key]: table }));
  }, []);

  /** Pull the index, then whichever universe is open. */
  const refresh = useCallback(async (urlOverride) => {
    const url = typeof urlOverride === 'string' ? urlOverride : settingsRef.current.sourceUrl;
    setRefreshing(true);
    try {
      // The table outweighs the index a thousandfold, so start it downloading
      // now on the guess that the fresh index still lists the open universe
      // under the same file. That holds on every launch except a source swap,
      // and the megabyte of history is in flight during the index round-trip
      // instead of queueing behind it. On the very first run there is no index
      // to guess from, but the default universe's file is a known constant.
      const wanted = settingsRef.current.universeKey;
      const guess = findUniverse(indexRef.current, wanted)
        || (wanted === 'all' ? { key: 'all', title: 'All', scope: 'all', file: 'snapshot.json' } : null);
      const guessed = guess ? fetchUniverse(url, guess).catch(() => null) : null;

      const listing = await fetchIndex(url);
      setIndex(listing.index);

      // A source swapped under our feet may not carry the universe that was
      // open; fall back to whatever it lists first rather than fetching a 404.
      const universe = findUniverse(listing.index, wanted);
      if (!universe) throw new Error('That source lists no universes');

      // The guess only counts when the fresh index agrees where that universe
      // lives; otherwise fetch what the index actually says.
      let result = guess && universe.key === guess.key && universe.file === guess.file
        ? await guessed
        : null;
      if (!result) result = await fetchUniverse(url, universe);
      store(universe.key, result.table);
      if (universe.key !== wanted) {
        setSettings((prev) => {
          const next = { ...prev, universeKey: universe.key };
          saveSettings(next);
          return next;
        });
      }

      setFatal(null);
      setNotice(
        result.fromCache
          ? `OFFLINE — SHOWING CACHED ${result.table.dataDate} (${result.error})`
          : null
      );
      if (result.fetchedAt) setLastFetched(new Date(result.fetchedAt).toISOString());
      setRefreshResult(
        result.fromCache
          ? { ok: false, message: `Could not reach the source (${result.error}). Showing the cached ${result.table.dataDate} copy of ${result.table.title}.` }
          : { ok: true, message: `Updated just now — ${result.table.title}, ${result.table.universeSize} tickers, data date ${result.table.dataDate}.` }
      );
    } catch (err) {
      setFatal(err.message || 'Could not load the data');
      setRefreshResult({ ok: false, message: err.message || 'Could not load the data.' });
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  // Boot: local state first so the app paints immediately, network after.
  useEffect(() => {
    (async () => {
      const [storedSettings, storedWatchlist, cachedIndex] = await Promise.all([
        loadSettings(), loadWatchlist(), loadCachedIndex(),
      ]);
      setSettings(storedSettings);
      setWatchlist(storedWatchlist);
      patchRanks({ sortKey: storedSettings.defaultSort });
      if (cachedIndex) setIndex(cachedIndex);

      const cachedTable = await loadCachedUniverse(storedSettings.universeKey);
      if (cachedTable) store(storedSettings.universeKey, cachedTable);
      setReady(true);
      if (storedSettings.refreshOnOpen || !cachedTable) await refresh();
    })();
  }, [refresh, patchRanks, store]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
    // Changing the default should take effect now, not on next launch.
    if (patch.defaultSort) patchRanks({ sortKey: patch.defaultSort, direction: 'desc' });
  }, [patchRanks]);

  /**
   * Switch universes.
   *
   * A cached copy is painted immediately and freshened behind the reader's
   * back; only a universe never opened before makes anyone wait, and even then
   * the list underneath stays put until the new one is in hand rather than
   * blanking the screen.
   */
  const selectUniverse = useCallback(async (key) => {
    if (key === settingsRef.current.universeKey) return;
    const universe = findUniverse(index, key);
    if (!universe) return;

    const url = settingsRef.current.sourceUrl;
    const commit = () => {
      updateSettings({ universeKey: key });
      // Sector and industry cuts belong to the table they were made in.
      patchRanks({ sector: 'All', industry: 'All' });
      if (ranksList.current) ranksList.current.scrollToOffset({ offset: 0, animated: false });
    };

    setPendingKey(key);
    try {
      if (!tables[key]) {
        const cached = await loadCachedUniverse(key);
        if (cached) { store(key, cached); commit(); }
      }
      const result = await fetchUniverse(url, universe);
      store(key, result.table);
      commit();
      setNotice(
        result.fromCache
          ? `OFFLINE — SHOWING CACHED ${result.table.dataDate} (${result.error})`
          : null
      );
      if (result.fetchedAt) setLastFetched(new Date(result.fetchedAt).toISOString());
    } catch (err) {
      setRefreshResult({ ok: false, message: `Could not load ${universe.title} (${err.message}).` });
    } finally {
      setPendingKey(null);
    }
  }, [index, tables, store, updateSettings, patchRanks]);

  /**
   * A starred name lives in whichever universe it was starred from, so the
   * Watchlist can only show it once that table is loaded. Pull the missing ones
   * in one at a time in the background until every star resolves.
   */
  useEffect(() => {
    if (!ready || !index || !watchlist.length) return;
    const have = new Set();
    for (const table of Object.values(tables)) {
      for (const t of table.tickers) have.add(t.symbol);
    }
    if (watchlist.every((s) => have.has(s))) return;

    const next = index.universes.find((u) => !tables[u.key] && !skipHydrate.current.has(u.key));
    if (!next) return;

    let live = true;
    (async () => {
      try {
        const result = await fetchUniverse(settingsRef.current.sourceUrl, next);
        if (live) store(next.key, result.table);
      } catch (err) {
        skipHydrate.current.add(next.key);
      }
    })();
    return () => { live = false; };
  }, [ready, index, watchlist, tables, store]);

  const toggleStar = useCallback((symbol) => {
    setWatchlist((prev) => {
      const removing = prev.includes(symbol);
      const next = removing ? prev.filter((s) => s !== symbol) : [...prev, symbol];
      saveWatchlist(next);
      // A row vanishing under your thumb is easy to do by accident and, until
      // now, impossible to undo without finding the ticker again.
      setUndoItem(removing ? symbol : null);
      return next;
    });
  }, []);

  const undoRemove = useCallback(() => {
    if (!undoItem) return;
    setWatchlist((prev) => {
      const next = prev.includes(undoItem) ? prev : [...prev, undoItem];
      saveWatchlist(next);
      return next;
    });
    setUndoItem(null);
  }, [undoItem]);

  const clearWatchlist = useCallback(() => {
    setWatchlist([]);
    saveWatchlist([]);
    setUndoItem(null);
  }, []);

  const resetAll = useCallback(async () => {
    await clearAll();
    setWatchlist([]);
    setTables({});
    setSettings(DEFAULT_SETTINGS);
    skipHydrate.current = new Set();
    await refresh(DEFAULT_SETTINGS.sourceUrl);
  }, [refresh]);

  const markScrubbed = useCallback(() => {
    if (!settingsRef.current.hasScrubbed) updateSettings({ hasScrubbed: true });
  }, [updateSettings]);

  const tickers = useMemo(() => (snapshot ? decorate(snapshot) : []), [snapshot]);

  /**
   * Every starred name, drawn from whichever tables are loaded.
   *
   * The open universe wins when a name appears in two of them, so the numbers
   * on the Watchlist match the ones on Ranks rather than depending on which
   * sector happened to load first.
   */
  const watchTickers = useMemo(() => {
    if (!watchlist.length) return [];
    const wanted = new Set(watchlist);
    const found = new Map();
    const order = [
      ...Object.keys(tables).filter((k) => k !== universeKey),
      ...(tables[universeKey] ? [universeKey] : []),
    ];
    for (const key of order) {
      const table = tables[key];
      for (const t of table.tickers) {
        if (wanted.has(t.symbol)) found.set(t.symbol, { table, ticker: t });
      }
    }
    return Array.from(found.values()).map(({ table, ticker }) => {
      const points = seriesFor(ticker, table.dates, SPARK_SESSIONS);
      return { ...ticker, spark: downsample(points, SPARK_POINTS), sparkChange: changeOver(points) };
    });
  }, [watchlist, tables, universeKey]);

  // Opening a ticker from the Watchlist has to work even when it belongs to a
  // sector table that is not the one on screen.
  const openTicker = useMemo(() => {
    if (!openSymbol) return null;
    const here = tickers.find((t) => t.symbol === openSymbol);
    if (here) return { ticker: here, table: snapshot };
    const other = watchTickers.find((t) => t.symbol === openSymbol);
    if (!other) return null;
    const table = Object.values(tables).find((tb) => tb.tickers.some((t) => t.symbol === openSymbol));
    return table ? { ticker: other, table } : null;
  }, [openSymbol, tickers, snapshot, watchTickers, tables]);

  const onTab = (key) => {
    if (key === tab) {
      // Tapping the tab you are already on returns to the top, which on a
      // three-hundred row list saves a lot of thumb.
      const list = key === 'ranks' ? ranksList.current : key === 'watchlist' ? watchList.current : null;
      if (list) { tick(); list.scrollToOffset({ offset: 0, animated: true }); }
      return;
    }
    tick();
    setTab(key);
  };

  if (!ready || (!snapshot && !fatal)) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="light-content" />
        <Loading label="FETCHING DATA" />
      </SafeAreaView>
    );
  }

  if (!snapshot && fatal) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="light-content" />
        <View style={styles.fatal}>
          <Text style={styles.fatalTitle} accessibilityRole="header">NO DATA</Text>
          <Text style={styles.fatalText}>{fatal}</Text>
          <Text style={styles.fatalHint}>Check the data URL under Settings, then try again.</Text>
          <View style={styles.fatalActions}>
            <ActionButton label={refreshing ? 'RETRYING…' : 'RETRY'} busy={refreshing} onPress={() => refresh()} />
            <ActionButton label="OPEN SETTINGS" onPress={() => { setFatal(null); setTab('settings'); }} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const shared = {
    settings,
    watchlist,
    onOpen: (t) => setOpenSymbol(t.symbol),
    onToggleStar: toggleStar,
    onRefresh: refresh,
    refreshing,
  };

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar barStyle="light-content" />

      {/* Every tab stays mounted and inactive ones are merely hidden.
          Unmounting them would throw away scroll position and filters. */}
      <View style={styles.body}>
        <View style={tab === 'ranks' ? styles.pane : styles.paneHidden}>
          <RanksScreen
            snapshot={snapshot}
            tickers={tickers}
            index={index}
            universeKey={universeKey}
            pendingKey={pendingKey}
            onSelectUniverse={selectUniverse}
            staleMessage={notice}
            listState={ranksState}
            onListState={patchRanks}
            listRef={ranksList}
            {...shared}
          />
        </View>
        <View style={tab === 'watchlist' ? styles.pane : styles.paneHidden}>
          <WatchlistScreen
            tickers={watchTickers}
            pending={watchlist.length - watchTickers.length}
            listState={watchState}
            onListState={patchWatch}
            listRef={watchList}
            {...shared}
          />
        </View>
        <View style={tab === 'settings' ? styles.pane : styles.paneHidden}>
          <SettingsScreen
            settings={settings}
            onChange={updateSettings}
            snapshot={snapshot}
            index={index}
            loadedCount={Object.keys(tables).length}
            lastFetched={lastFetched}
            watchlistCount={watchlist.length}
            onClearWatchlist={clearWatchlist}
            onResetAll={resetAll}
            onRefresh={refresh}
            refreshing={refreshing}
            refreshResult={refreshResult}
          />
        </View>

        {/* Over the panes but inside the body, so the tab bar stays reachable
            and the list underneath keeps its place. */}
        {openTicker && (
          <View style={styles.overlay}>
            <TickerScreen
              ticker={openTicker.ticker}
              snapshot={openTicker.table}
              starred={watchlist.includes(openTicker.ticker.symbol)}
              onBack={() => setOpenSymbol(null)}
              onToggleStar={toggleStar}
              hintScrub={!settings.hasScrubbed}
              onScrubbed={markScrubbed}
            />
          </View>
        )}
      </View>

      {tab !== 'ranks' && !!notice && <Banner text={notice} />}

      {!!undoItem && (
        <Snackbar
          text={`${undoItem} removed from watchlist`}
          actionLabel="UNDO"
          onAction={undoRemove}
        />
      )}

      <View style={styles.tabBar} accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => onTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                t.key === 'watchlist' && watchlist.length
                  ? `Watch, ${watchlist.length} tracked`
                  : t.label
              }
            >
              <View style={[styles.tabMark, active && styles.tabMarkActive]} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
                {t.key === 'watchlist' && watchlist.length ? ` ${watchlist.length}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  pane: { ...StyleSheet.absoluteFillObject },
  paneHidden: { ...StyleSheet.absoluteFillObject, display: 'none' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: S.hairline,
    borderTopColor: C.line,
    backgroundColor: C.surface,
  },
  // A full 44pt target even though the label is small.
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: S.tap, paddingVertical: 8 },
  tabMark: { width: 18, height: 2, backgroundColor: 'transparent', marginBottom: 7 },
  tabMarkActive: { backgroundColor: C.acid },
  tabLabel: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1.4 },
  tabLabelActive: { color: C.acid },

  fatal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  fatalTitle: { color: C.text, fontFamily: MONO, fontSize: T.large, letterSpacing: 2 },
  fatalText: { color: C.down, fontFamily: MONO, fontSize: T.small, marginTop: 14, textAlign: 'center' },
  fatalHint: { color: C.faint, fontSize: T.small, marginTop: 16, textAlign: 'center', lineHeight: 19 },
  fatalActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 18 },
});

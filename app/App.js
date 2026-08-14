import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Banner, Loading, Snackbar } from './src/components/UI';
import { changeOver, downsample, fetchSnapshot, seriesFor } from './src/data';
import { setHapticsEnabled, tick } from './src/haptics';
import RanksScreen from './src/screens/RanksScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TickerScreen from './src/screens/TickerScreen';
import WatchlistScreen from './src/screens/WatchlistScreen';
import {
  DEFAULT_SETTINGS,
  clearAll,
  loadCachedSnapshot,
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [watchlist, setWatchlist] = useState([]);
  const [snapshot, setSnapshot] = useState(null);

  const [tab, setTab] = useState('ranks');
  const [openSymbol, setOpenSymbol] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [refreshResult, setRefreshResult] = useState(null);
  const [undoItem, setUndoItem] = useState(null);

  // Sort, search and sector live here rather than inside the screens, so they
  // survive opening a ticker and switching tabs. Each list keeps its own.
  const [ranksState, setRanksState] = useState({
    sortKey: DEFAULT_SETTINGS.defaultSort, direction: 'desc', query: '', sector: 'All',
  });
  const [watchState, setWatchState] = useState({ sortKey: 'change' });

  const ranksList = useRef(null);
  const watchList = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const patchRanks = useCallback((p) => setRanksState((prev) => ({ ...prev, ...p })), []);
  const patchWatch = useCallback((p) => setWatchState((prev) => ({ ...prev, ...p })), []);

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

  const refresh = useCallback(async (urlOverride) => {
    const url = typeof urlOverride === 'string' ? urlOverride : settingsRef.current.sourceUrl;
    setRefreshing(true);
    try {
      const result = await fetchSnapshot(url);
      setSnapshot(result.snapshot);
      setFatal(null);
      setNotice(
        result.fromCache
          ? `OFFLINE — SHOWING CACHED ${result.snapshot.dataDate} (${result.error})`
          : null
      );
      if (result.fetchedAt) setLastFetched(new Date(result.fetchedAt).toISOString());
      setRefreshResult(
        result.fromCache
          ? { ok: false, message: `Could not reach the source (${result.error}). Showing the cached ${result.snapshot.dataDate} snapshot.` }
          : { ok: true, message: `Updated just now — ${result.snapshot.universeSize} tickers, data date ${result.snapshot.dataDate}.` }
      );
    } catch (err) {
      setFatal(err.message || 'Could not load the snapshot');
      setRefreshResult({ ok: false, message: err.message || 'Could not load the snapshot.' });
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Boot: local state first so the app paints immediately, network after.
  useEffect(() => {
    (async () => {
      const [storedSettings, storedWatchlist, cached] = await Promise.all([
        loadSettings(), loadWatchlist(), loadCachedSnapshot(),
      ]);
      setSettings(storedSettings);
      setWatchlist(storedWatchlist);
      patchRanks({ sortKey: storedSettings.defaultSort });
      if (cached) setSnapshot(cached);
      setReady(true);
      if (storedSettings.refreshOnOpen || !cached) await refresh();
    })();
  }, [refresh, patchRanks]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
    // Changing the default should take effect now, not on next launch.
    if (patch.defaultSort) patchRanks({ sortKey: patch.defaultSort, direction: 'desc' });
  }, [patchRanks]);

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
    setSettings(DEFAULT_SETTINGS);
    await refresh(DEFAULT_SETTINGS.sourceUrl);
  }, [refresh]);

  const markScrubbed = useCallback(() => {
    if (!settingsRef.current.hasScrubbed) updateSettings({ hasScrubbed: true });
  }, [updateSettings]);

  // Sparkline geometry is derived once per snapshot rather than per render: a
  // few hundred rows recomputing their own trend line on every scroll is the
  // difference between a smooth list and a stuttering one.
  const tickers = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.tickers.map((t) => {
      const points = seriesFor(t, snapshot.dates, SPARK_SESSIONS);
      return { ...t, spark: downsample(points, SPARK_POINTS), sparkChange: changeOver(points) };
    });
  }, [snapshot]);

  const openTicker = useMemo(
    () => tickers.find((t) => t.symbol === openSymbol) || null,
    [tickers, openSymbol]
  );

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
        <Loading label="FETCHING SNAPSHOT" />
      </SafeAreaView>
    );
  }

  if (!snapshot && fatal) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="light-content" />
        <View style={styles.fatal}>
          <Text style={styles.fatalTitle} accessibilityRole="header">NO SNAPSHOT</Text>
          <Text style={styles.fatalText}>{fatal}</Text>
          <Text style={styles.fatalHint}>Check the snapshot URL under Settings, then try again.</Text>
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
            staleMessage={notice}
            listState={ranksState}
            onListState={patchRanks}
            listRef={ranksList}
            {...shared}
          />
        </View>
        <View style={tab === 'watchlist' ? styles.pane : styles.paneHidden}>
          <WatchlistScreen
            tickers={tickers}
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
              ticker={openTicker}
              snapshot={snapshot}
              starred={watchlist.includes(openTicker.symbol)}
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

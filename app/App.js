import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Banner, Loading } from './src/components/UI';
import { downsample, changeOver, fetchSnapshot, seriesFor } from './src/data';
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
import { C, MONO, S } from './src/theme';

const TABS = [
  { key: 'ranks', label: 'RANKS' },
  { key: 'watchlist', label: 'WATCH' },
  { key: 'settings', label: 'CONFIG' },
];

const SPARK_SESSIONS = 90;
const SPARK_POINTS = 24;

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

  // Settings live in state for rendering but are also read inside refresh();
  // the ref keeps that callback stable instead of re-created on every change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetchSnapshot(settingsRef.current.sourceUrl);
      setSnapshot(result.snapshot);
      setFatal(null);
      setNotice(
        result.fromCache
          ? `OFFLINE — SHOWING CACHED ${result.snapshot.dataDate} (${result.error})`
          : null
      );
      if (result.fetchedAt) setLastFetched(new Date(result.fetchedAt).toISOString());
    } catch (err) {
      setFatal(err.message || 'Could not load the snapshot');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Boot: local state first so the app paints immediately, network after.
  useEffect(() => {
    (async () => {
      const [storedSettings, storedWatchlist, cached] = await Promise.all([
        loadSettings(),
        loadWatchlist(),
        loadCachedSnapshot(),
      ]);
      setSettings(storedSettings);
      setWatchlist(storedWatchlist);
      if (cached) setSnapshot(cached);
      setReady(true);

      if (storedSettings.refreshOnOpen || !cached) {
        await refresh();
      }
    })();
  }, [refresh]);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const toggleStar = useCallback((symbol) => {
    setWatchlist((prev) => {
      const next = prev.includes(symbol)
        ? prev.filter((s) => s !== symbol)
        : [...prev, symbol];
      saveWatchlist(next);
      return next;
    });
  }, []);

  const clearWatchlist = useCallback(() => {
    setWatchlist([]);
    saveWatchlist([]);
  }, []);

  const resetAll = useCallback(async () => {
    await clearAll();
    setWatchlist([]);
    setSettings(DEFAULT_SETTINGS);
    await refresh();
  }, [refresh]);

  // Sparkline geometry is derived once per snapshot rather than per render:
  // a hundred rows recomputing their own trend line on every scroll is the
  // difference between a smooth list and a stuttering one.
  const tickers = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.tickers.map((t) => {
      const points = seriesFor(t, snapshot.dates, SPARK_SESSIONS);
      return {
        ...t,
        spark: downsample(points, SPARK_POINTS),
        sparkChange: changeOver(points),
      };
    });
  }, [snapshot]);

  const openTicker = useMemo(
    () => tickers.find((t) => t.symbol === openSymbol) || null,
    [tickers, openSymbol]
  );

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
          <Text style={styles.fatalTitle}>NO SNAPSHOT</Text>
          <Text style={styles.fatalText}>{fatal}</Text>
          <Text style={styles.fatalHint}>
            Check the snapshot URL under CONFIG, then try again.
          </Text>
          <Pressable style={styles.retry} onPress={refresh}>
            <Text style={styles.retryText}>RETRY</Text>
          </Pressable>
          <Pressable onPress={() => { setFatal(null); setTab('settings'); }}>
            <Text style={styles.fatalLink}>OPEN CONFIG</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // The detail view sits above the tab bar rather than beside it, so returning
  // to a list keeps its scroll position and filters intact.
  if (openTicker) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="light-content" />
        <TickerScreen
          ticker={openTicker}
          snapshot={snapshot}
          starred={watchlist.includes(openTicker.symbol)}
          onBack={() => setOpenSymbol(null)}
          onToggleStar={toggleStar}
        />
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

      <View style={styles.body}>
        {tab === 'ranks' && (
          <RanksScreen
            key={settings.defaultSort}
            snapshot={snapshot}
            tickers={tickers}
            staleMessage={notice}
            {...shared}
          />
        )}
        {tab === 'watchlist' && <WatchlistScreen tickers={tickers} {...shared} />}
        {tab === 'settings' && (
          <SettingsScreen
            settings={settings}
            onChange={updateSettings}
            snapshot={snapshot}
            lastFetched={lastFetched}
            watchlistCount={watchlist.length}
            onClearWatchlist={clearWatchlist}
            onResetAll={resetAll}
            onRefresh={refresh}
          />
        )}
      </View>

      {tab !== 'ranks' && !!notice && <Banner text={notice} />}

      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
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

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: S.hairline,
    borderTopColor: C.line,
    backgroundColor: C.surface,
    paddingTop: 8,
    paddingBottom: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabMark: { width: 16, height: 2, backgroundColor: 'transparent', marginBottom: 6 },
  tabMarkActive: { backgroundColor: C.acid },
  tabLabel: { color: C.faint, fontFamily: MONO, fontSize: 10, letterSpacing: 1.6 },
  tabLabelActive: { color: C.acid },

  fatal: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  fatalTitle: { color: C.text, fontFamily: MONO, fontSize: 15, letterSpacing: 2 },
  fatalText: { color: C.down, fontFamily: MONO, fontSize: 11, marginTop: 12, textAlign: 'center' },
  fatalHint: { color: C.faint, fontSize: 11, marginTop: 14, textAlign: 'center', lineHeight: 17 },
  retry: {
    marginTop: 22,
    borderWidth: S.hairline,
    borderColor: C.acid,
    borderRadius: 6,
    paddingHorizontal: 22,
    paddingVertical: 9,
  },
  retryText: { color: C.acid, fontFamily: MONO, fontSize: 11, letterSpacing: 2 },
  fatalLink: { color: C.dim, fontFamily: MONO, fontSize: 10, letterSpacing: 1, marginTop: 18 },
});

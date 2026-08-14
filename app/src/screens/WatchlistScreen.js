import React, { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import TickerRow from '../components/TickerRow';
import { Chip, ChipRow, Empty } from '../components/UI';
import { SORTS, arrange, sortByKey } from '../data';
import { C, MONO, S, T, fmtPct, tone } from '../theme';

export default function WatchlistScreen({
  tickers,
  settings,
  watchlist,
  onOpen,
  onToggleStar,
  onRefresh,
  refreshing,
  listState,
  onListState,
  listRef,
}) {
  const { sortKey } = listState;

  const held = useMemo(
    () => tickers.filter((t) => watchlist.includes(t.symbol)),
    [tickers, watchlist]
  );
  const rows = useMemo(() => arrange(held, { sortKey, direction: 'desc' }), [held, sortKey]);

  // Unweighted mean of the day's moves: a rough read on the list as a whole,
  // not a portfolio return -- there are no positions or sizes here, which is
  // why the label says equal-weight rather than leaving it to be assumed.
  const average = useMemo(() => {
    if (!held.length) return null;
    return held.reduce((sum, t) => sum + (t.changePct || 0), 0) / held.length;
  }, [held]);

  const sort = sortByKey(sortKey);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">WATCHLIST</Text>
          <Text style={styles.subtitle}>
            {held.length} {held.length === 1 ? 'TICKER' : 'TICKERS'} TRACKED
          </Text>
        </View>
        {average !== null && (
          <View
            style={styles.avgBox}
            accessibilityLabel={`Equal weight average move today, ${fmtPct(average)}`}
          >
            <Text style={styles.avgLabel}>EQUAL-WEIGHT AVG 1D</Text>
            <Text style={[styles.avgValue, { color: tone(average) }]}>{fmtPct(average)}</Text>
          </View>
        )}
      </View>

      {held.length > 0 && (
        <ChipRow accessibilityLabel="Sort watchlist by metric">
          {SORTS.map((s) => (
            <Chip
              key={s.key}
              label={s.short}
              active={s.key === sortKey}
              onPress={() => onListState({ sortKey: s.key })}
              accessibilityLabel={s.key === sortKey ? `${s.label}, selected` : `Sort by ${s.label}`}
            />
          ))}
        </ChipRow>
      )}

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(t) => t.symbol}
        renderItem={({ item, index }) => (
          <TickerRow
            ticker={item}
            position={item.ranks[sort.rank] ?? index + 1}
            sort={sort}
            settings={settings}
            starred
            onPress={onOpen}
            onToggleStar={onToggleStar}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.acid} />
        }
        ListEmptyComponent={
          <Empty
            title="NOTHING TRACKED YET"
            hint="Tap the star beside any row on the Ranks screen, or open a ticker and tap WATCH."
          />
        }
        contentContainerStyle={rows.length ? null : { flexGrow: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: S.gutter,
    paddingTop: 6,
    paddingBottom: 14,
  },
  headerText: { flexShrink: 1, paddingRight: 12 },
  title: { color: C.text, fontFamily: MONO, fontSize: T.title, letterSpacing: 3 },
  subtitle: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.8, marginTop: 6 },
  avgBox: { alignItems: 'flex-end' },
  avgLabel: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.6 },
  avgValue: { fontFamily: MONO, fontSize: T.large, marginTop: 4 },
});

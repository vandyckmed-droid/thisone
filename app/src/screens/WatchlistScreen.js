import React, { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import TickerRow from '../components/TickerRow';
import { Chip, ChipRow, Empty } from '../components/UI';
import { SORTS, arrange, sortByKey } from '../data';
import { C, MONO, S, fmtPct, tone } from '../theme';

export default function WatchlistScreen({
  tickers,
  settings,
  watchlist,
  onOpen,
  onToggleStar,
  onRefresh,
  refreshing,
}) {
  const [sortKey, setSortKey] = useState('change');

  const held = useMemo(
    () => tickers.filter((t) => watchlist.includes(t.symbol)),
    [tickers, watchlist]
  );
  const rows = useMemo(
    () => arrange(held, { sortKey, direction: 'desc' }),
    [held, sortKey]
  );

  // Unweighted mean of the day's moves: a rough read on the list as a whole,
  // not a portfolio return -- there are no positions or sizes here.
  const average = useMemo(() => {
    if (!held.length) return null;
    return held.reduce((sum, t) => sum + (t.changePct || 0), 0) / held.length;
  }, [held]);

  const sort = sortByKey(sortKey);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>WATCHLIST</Text>
          <Text style={styles.subtitle}>
            {held.length} {held.length === 1 ? 'TICKER' : 'TICKERS'} TRACKED
          </Text>
        </View>
        {average !== null && (
          <View style={styles.avgBox}>
            <Text style={styles.avgLabel}>AVG 1D</Text>
            <Text style={[styles.avgValue, { color: tone(average) }]}>{fmtPct(average)}</Text>
          </View>
        )}
      </View>

      {held.length > 0 && (
        <ChipRow>
          {SORTS.map((s) => (
            <Chip
              key={s.key}
              label={s.short}
              active={s.key === sortKey}
              onPress={() => setSortKey(s.key)}
            />
          ))}
        </ChipRow>
      )}

      <FlatList
        data={rows}
        keyExtractor={(t) => t.symbol}
        renderItem={({ item, index }) => (
          <TickerRow
            ticker={item}
            position={index + 1}
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
            hint="Open any ticker and tap WATCH, or press and hold a row on the Ranks screen."
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
  title: { color: C.text, fontFamily: MONO, fontSize: 19, letterSpacing: 3 },
  subtitle: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1, marginTop: 4 },
  avgBox: { alignItems: 'flex-end' },
  avgLabel: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  avgValue: { fontFamily: MONO, fontSize: 15, marginTop: 3 },
});

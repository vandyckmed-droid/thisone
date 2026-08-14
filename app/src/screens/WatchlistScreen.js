import React, { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import TickerRow from '../components/TickerRow';
import { Chip, ChipRow, Empty } from '../components/UI';
import { SORTS, arrange, sortByKey } from '../data';
import { C, MONO, S, T, fmtPct, tone } from '../theme';

export default function WatchlistScreen({
  tickers,
  pending,
  settings,
  onOpen,
  onToggleStar,
  onRefresh,
  refreshing,
  listState,
  onListState,
  listRef,
}) {
  const { sortKey } = listState;

  // App has already resolved the stars against every loaded universe, so this
  // screen just sorts what it is handed.
  const rows = useMemo(() => arrange(tickers, { sortKey, direction: 'desc' }), [tickers, sortKey]);

  // Unweighted mean of the day's moves: a rough read on the list as a whole,
  // not a portfolio return -- there are no positions or sizes here, which is
  // why the label says equal-weight rather than leaving it to be assumed.
  const average = useMemo(() => {
    if (!tickers.length) return null;
    return tickers.reduce((sum, t) => sum + (t.changePct || 0), 0) / tickers.length;
  }, [tickers]);

  const sort = sortByKey(sortKey);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">WATCHLIST</Text>
          <Text style={styles.subtitle}>
            {tickers.length} {tickers.length === 1 ? 'TICKER' : 'TICKERS'} TRACKED
            {pending > 0 ? ` · LOADING ${pending} MORE` : ''}
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

      {tickers.length > 0 && (
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

      {tickers.length > 0 && (
        // The numbers down the left are places within this list. A rank carried
        // over from a table would be meaningless here: these names come from
        // whichever universes they were starred in, and #4 of the Top 300 sits
        // beside #4 of a hundred utilities without the two being comparable.
        <View style={styles.columns}>
          <Text style={styles.colLeft}>#  IN THIS LIST</Text>
          <Text style={styles.colRight}>
            PRICE / <Text style={styles.colMetric}>{sort.label}</Text>
          </Text>
        </View>
      )}

      <FlatList
        ref={listRef}
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
            hint="Tap the star beside any row on the Ranks screen, or open a ticker and tap WATCH. Stars from every universe land here together."
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

  columns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: S.gutter,
    paddingBottom: 8,
    paddingTop: 4,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.line,
  },
  colLeft: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.8 },
  colRight: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.8 },
  colMetric: { color: C.text },
});

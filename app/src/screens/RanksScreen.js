import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import TickerRow from '../components/TickerRow';
import { Banner, Chip, ChipRow, Empty, SelectButton, SelectSheet } from '../components/UI';
import { SORTS, arrange, sectorOptions, sortByKey } from '../data';
import { C, MONO, S } from '../theme';

const ROW_HEIGHT = 57;

export default function RanksScreen({
  snapshot,
  tickers,
  settings,
  watchlist,
  staleMessage,
  onOpen,
  onToggleStar,
  onRefresh,
  refreshing,
}) {
  const [sortKey, setSortKey] = useState(settings.defaultSort);
  const [direction, setDirection] = useState('desc');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('All');

  const [sectorOpen, setSectorOpen] = useState(false);

  const sort = sortByKey(sortKey);
  const sectors = useMemo(() => sectorOptions(tickers), [tickers]);
  const sectorLabel = sector === 'All' ? 'ALL SECTORS' : sector.toUpperCase();
  const rows = useMemo(
    () => arrange(tickers, { sortKey, query, sector, direction }),
    [tickers, sortKey, query, sector, direction]
  );

  const pickSort = (key) => {
    // Tapping the active column flips it; tapping a new one starts at best-first.
    if (key === sortKey) {
      setDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setDirection('desc');
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>RANKS</Text>
          <Text style={styles.subtitle}>
            TOP {snapshot.universeSize} BY MARKET CAP · {snapshot.dataDate}
          </Text>
        </View>
        <Pressable onPress={() => setDirection((d) => (d === 'desc' ? 'asc' : 'desc'))}>
          <Text style={styles.direction}>{direction === 'desc' ? 'BEST ▼' : 'WORST ▲'}</Text>
        </Pressable>
      </View>

      {!!staleMessage && <Banner text={staleMessage} />}

      <View style={styles.filterRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="SEARCH SYMBOL OR NAME"
          placeholderTextColor={C.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.search}
        />
        <SelectButton
          label={sectorLabel}
          active={sector !== 'All'}
          onPress={() => setSectorOpen(true)}
        />
      </View>

      <ChipRow>
        {SORTS.map((s) => (
          <Chip
            key={s.key}
            label={s.short}
            active={s.key === sortKey}
            onPress={() => pickSort(s.key)}
          />
        ))}
      </ChipRow>

      <View style={styles.columns}>
        <Text style={styles.colLeft}>#  TICKER</Text>
        <Text style={styles.colRight}>PRICE / {sort.short === 'CAP' ? '1D' : sort.short}</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(t) => t.symbol}
        renderItem={({ item, index }) => (
          <TickerRow
            ticker={item}
            // Numbering follows the sort, except under market cap where the
            // pipeline's own rank is the more meaningful label.
            position={sort.rank === 'marketCap' ? item.ranks.marketCap : index + 1}
            sort={sort}
            settings={settings}
            starred={watchlist.includes(item.symbol)}
            onPress={onOpen}
            onToggleStar={onToggleStar}
          />
        )}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        initialNumToRender={14}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.acid} />
        }
        ListEmptyComponent={
          <Empty title="NO MATCHES" hint="Nothing in the universe matches that filter." />
        }
        contentContainerStyle={rows.length ? null : { flexGrow: 1 }}
      />
      <SelectSheet
        title="FILTER BY SECTOR"
        options={sectors}
        value={sector}
        visible={sectorOpen}
        onSelect={setSector}
        onClose={() => setSectorOpen(false)}
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
    paddingBottom: 12,
  },
  title: { color: C.text, fontFamily: MONO, fontSize: 19, letterSpacing: 3 },
  subtitle: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1, marginTop: 4 },
  direction: { color: C.acid, fontFamily: MONO, fontSize: 10, letterSpacing: 1, paddingTop: 6 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: S.gutter,
    marginBottom: 10,
  },
  search: {
    flex: 1,
    marginRight: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: C.surface,
    borderWidth: S.hairline,
    borderColor: C.line,
    borderRadius: S.radius,
    color: C.text,
    fontFamily: MONO,
    fontSize: 12,
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: S.gutter,
    paddingBottom: 7,
    paddingTop: 3,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.line,
  },
  colLeft: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  colRight: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
});

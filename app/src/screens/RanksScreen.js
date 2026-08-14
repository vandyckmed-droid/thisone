import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  SORTS, arrange, describeUniverse, findUniverse, industryOptions, sectorOptions,
  sortByKey, universeOptions,
} from '../data';
import { tick } from '../haptics';
import { C, MONO, S, T, slop } from '../theme';

export default function RanksScreen({
  snapshot,
  tickers,
  index,
  universeKey,
  pendingKey,
  onSelectUniverse,
  settings,
  watchlist,
  staleMessage,
  onOpen,
  onToggleStar,
  onRefresh,
  refreshing,
  // Held by App rather than here, so opening a ticker or switching tabs does
  // not quietly reset the view the reader set up.
  listState,
  onListState,
  listRef,
}) {
  const { sortKey, direction, query, sector, industry } = listState;
  const [universeOpen, setUniverseOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);

  const sort = sortByKey(sortKey);
  // A sector table is one sector all the way down, so the useful cut inside it
  // is the industry; only the whole-market table needs a sector filter.
  const bySector = snapshot.scope !== 'sector';
  const cut = bySector ? sector : industry;
  const cutOptions = useMemo(
    () => (bySector ? sectorOptions(tickers) : industryOptions(tickers)),
    [bySector, tickers]
  );

  const rows = useMemo(
    () => arrange(tickers, { sortKey, query, sector, industry, direction }),
    [tickers, sortKey, query, sector, industry, direction]
  );

  const universes = useMemo(() => universeOptions(index), [index]);
  const switching = !!pendingKey && pendingKey !== universeKey;
  const switchingTo = switching ? findUniverse(index, pendingKey) : null;

  const bestFirst = direction === 'desc';
  const filtered = cut !== 'All' || !!query.trim();

  const pickSort = (key) => {
    // Tapping the active column flips it; tapping a new one starts best-first.
    if (key === sortKey) onListState({ direction: bestFirst ? 'asc' : 'desc' });
    else onListState({ sortKey: key, direction: 'desc' });
  };

  return (
    <View style={styles.wrap}>
      {/* The universe is the first decision on this screen, so it heads it as a
          control rather than sitting in a settings list three taps away. */}
      <Pressable
        onPress={() => { tick(); setUniverseOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel={`Universe, ${snapshot.title}, ${snapshot.universeSize} companies. Tap to change.`}
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {snapshot.title.toUpperCase()}
            </Text>
            <Text style={styles.caret}>▾</Text>
            {switching && <ActivityIndicator size="small" color={C.acid} style={styles.spinner} />}
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>
            {switching && switchingTo
              ? `LOADING ${switchingTo.title.toUpperCase()}…`
              : `${describeUniverse(snapshot)} · ${snapshot.dataDate}`}
          </Text>
        </View>
      </Pressable>

      {!!staleMessage && <Banner text={staleMessage} />}

      <View style={styles.filterRow}>
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={(v) => onListState({ query: v })}
            placeholder="SEARCH SYMBOL OR NAME"
            placeholderTextColor={C.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Search by symbol or company name"
            style={styles.search}
          />
          {!!query && (
            <Pressable
              onPress={() => { tick(); onListState({ query: '' }); }}
              hitSlop={slop(26)}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={styles.clear}
            >
              <Text style={styles.clearMark}>×</Text>
            </Pressable>
          )}
        </View>
        <SelectButton
          label={cut === 'All' ? (bySector ? 'ALL SECTORS' : 'ALL INDUSTRIES') : cut.toUpperCase()}
          active={cut !== 'All'}
          onPress={() => setCutOpen(true)}
          accessibilityLabel={
            `${bySector ? 'Sector' : 'Industry'} filter, ${cut === 'All' ? 'showing all' : cut}`
          }
        />
      </View>

      <ChipRow accessibilityLabel="Sort by metric">
        {SORTS.map((s) => (
          <Chip
            key={s.key}
            label={s.short}
            active={s.key === sortKey}
            onPress={() => pickSort(s.key)}
            accessibilityLabel={
              s.key === sortKey
                ? `${s.label}, sorted ${bestFirst ? 'best first' : 'worst first'}. Tap to reverse.`
                : `Sort by ${s.label}`
            }
          />
        ))}
      </ChipRow>

      {/* The active metric spelled out, with its direction attached rather than
          floating in the header where it read as unrelated. */}
      <Pressable
        onPress={() => { tick(); onListState({ direction: bestFirst ? 'asc' : 'desc' }); }}
        accessibilityRole="button"
        accessibilityLabel={`Sorted by ${sort.label}, ${bestFirst ? 'best first' : 'worst first'}. Tap to reverse.`}
        style={styles.columns}
      >
        <Text style={styles.colLeft}>#  TICKER</Text>
        <Text style={styles.colRight}>
          PRICE / <Text style={styles.colMetric}>{sort.label}</Text>
          <Text style={styles.colDir}>{bestFirst ? '  · BEST FIRST ▼' : '  · WORST FIRST ▲'}</Text>
        </Text>
      </Pressable>

      {filtered && (
        <View style={styles.summary}>
          <Text style={styles.summaryText} numberOfLines={1}>
            {cut !== 'All' ? cut : bySector ? 'All sectors' : 'All industries'}
            {query.trim() ? ` · “${query.trim()}”` : ''} · {rows.length}{' '}
            {rows.length === 1 ? 'result' : 'results'}
          </Text>
          <Pressable
            onPress={() => { tick(); onListState({ query: '', sector: 'All', industry: 'All' }); }}
            hitSlop={slop(30)}
            accessibilityRole="button"
            accessibilityLabel="Clear filters"
          >
            <Text style={styles.summaryClear}>CLEAR</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(t) => t.symbol}
        renderItem={({ item, index: i }) => (
          <TickerRow
            ticker={item}
            // The table's own rank for whichever column is sorted, so a row
            // keeps its standing in the whole universe under a filter instead
            // of being renumbered 1..n within the results.
            position={item.ranks[sort.rank] ?? i + 1}
            sort={sort}
            settings={settings}
            starred={watchlist.includes(item.symbol)}
            onPress={onOpen}
            onToggleStar={onToggleStar}
          />
        )}
        // No getItemLayout: rows grow with the reader's text size, so a fixed
        // row height would put the scroll position and the content out of step.
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.acid} />
        }
        ListEmptyComponent={
          <Empty title="NO MATCHES" hint="Nothing in this universe matches that filter." />
        }
        contentContainerStyle={rows.length ? null : { flexGrow: 1 }}
      />

      <SelectSheet
        title="UNIVERSE"
        hint="Each list ranks its own members, so a company places differently against the whole market than against its sector."
        options={universes}
        value={universeKey}
        visible={universeOpen}
        onSelect={onSelectUniverse}
        onClose={() => setUniverseOpen(false)}
      />
      <SelectSheet
        title={bySector ? 'FILTER BY SECTOR' : 'FILTER BY INDUSTRY'}
        options={cutOptions}
        value={cut}
        visible={cutOpen}
        onSelect={(v) => onListState(bySector ? { sector: v } : { industry: v })}
        onClose={() => setCutOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: { paddingHorizontal: S.gutter, paddingTop: 6, paddingBottom: 12, minHeight: S.tap },
  headerPressed: { opacity: 0.6 },
  headerText: { flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { color: C.text, fontFamily: MONO, fontSize: T.title, letterSpacing: 3, flexShrink: 1 },
  caret: { color: C.acid, fontFamily: MONO, fontSize: T.body, marginLeft: 8 },
  spinner: { marginLeft: 10 },
  subtitle: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.6, marginTop: 6 },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginHorizontal: S.gutter,
    marginBottom: 10,
  },
  searchWrap: { flex: 1, marginRight: 8, justifyContent: 'center' },
  search: {
    paddingHorizontal: 12,
    paddingRight: 34,
    paddingVertical: 11,
    backgroundColor: C.surface,
    borderWidth: S.hairline,
    borderColor: C.line,
    borderRadius: S.radius,
    color: C.text,
    fontFamily: MONO,
    fontSize: T.small,
  },
  clear: { position: 'absolute', right: 10, height: 24, width: 24, alignItems: 'center', justifyContent: 'center' },
  clearMark: { color: C.dim, fontSize: 19, lineHeight: 22 },

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
  colDir: { color: C.acid },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.gutter,
    paddingVertical: 9,
    backgroundColor: C.surface,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.line,
  },
  summaryText: { color: C.dim, fontSize: T.micro, flexShrink: 1 },
  summaryClear: { color: C.acid, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1, paddingLeft: 12 },
});

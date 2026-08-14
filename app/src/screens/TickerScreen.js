import React, { useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import PriceChart from '../components/PriceChart';
import { Chip, Disclosure, SectionTitle, Stat } from '../components/UI';
import { RANGES, changeOver, seriesFor } from '../data';
import { confirm, undo } from '../haptics';
import { C, MONO, S, fmtCap, fmtNum, fmtPct, fmtPrice, fmtRank, tone } from '../theme';

const MOMENTUM_ROWS = [
  ['3m', '3 MONTH'],
  ['6m', '6 MONTH'],
  ['9m', '9 MONTH'],
  ['12m', '12 MONTH'],
];

const RETURN_ROWS = [
  ['1w', '1 WEEK'],
  ['1m', '1 MONTH'],
  ['3m', '3 MONTH'],
  ['6m', '6 MONTH'],
  ['1y', '1 YEAR'],
  ['2y', '2 YEAR'],
];

export default function TickerScreen({ ticker, snapshot, starred, onBack, onToggleStar }) {
  const [range, setRange] = useState('1Y');
  // Published alongside the data so the app never has to hardcode what the
  // pipeline actually did; older snapshots simply show a dash.
  const skips = (snapshot.momentum || {}).skips || {};
  const width = Dimensions.get('window').width - S.gutter * 2;

  const sessions = (RANGES.find((r) => r.key === range) || RANGES[3]).sessions;
  const points = useMemo(
    () => seriesFor(ticker, snapshot.dates, sessions),
    [ticker, snapshot.dates, sessions]
  );
  const rangeChange = useMemo(() => changeOver(points), [points]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ BACK</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            (starred ? undo : confirm)();
            onToggleStar(ticker.symbol);
          }}
          hitSlop={12}
        >
          <Text style={[styles.watch, starred && styles.watching]}>
            {starred ? '★ WATCHING' : '☆ WATCH'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.identity}>
        {!!ticker.logo && <Image source={{ uri: ticker.logo }} style={styles.logo} resizeMode="contain" />}
        <View style={styles.identityText}>
          <Text style={styles.symbol}>{ticker.symbol}</Text>
          <Text style={styles.name} numberOfLines={2}>{ticker.name}</Text>
        </View>
      </View>

      <Text style={styles.meta}>
        {ticker.sector.toUpperCase()}
        {ticker.industry ? ` · ${ticker.industry.toUpperCase()}` : ''} · {ticker.exchange}
      </Text>

      <View style={styles.priceBlock}>
        <View>
          <Text style={styles.price}>{fmtPrice(ticker.price)}</Text>
          <Text style={[styles.change, { color: tone(ticker.changePct) }]}>
            {ticker.change >= 0 ? '+' : ''}{fmtNum(ticker.change)} ({fmtPct(ticker.changePct)})
          </Text>
        </View>
        {/* A size, not a ranking -- so it belongs with the company, not in a
            section that is otherwise nothing but #n placings. */}
        <View style={styles.capBlock}>
          <Text style={styles.capLabel}>MARKET CAP</Text>
          <Text style={styles.capValue}>{fmtCap(ticker.marketCap)}</Text>
        </View>
      </View>

      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <Chip
            key={r.key}
            compact
            label={r.key}
            active={r.key === range}
            onPress={() => setRange(r.key)}
          />
        ))}
      </View>

      <View style={styles.chartHead}>
        <Text style={styles.chartLabel}>{range} CHANGE</Text>
        <Text style={[styles.chartChange, { color: tone(rangeChange) }]}>
          {fmtPct(rangeChange)}
        </Text>
      </View>

      <PriceChart points={points} width={width} />

      <SectionTitle>RETURNS</SectionTitle>
      <View style={styles.grid}>
        {RETURN_ROWS.map(([key, label]) => (
          <Stat
            key={key}
            label={label}
            value={fmtPct(ticker.returns[key])}
            color={tone(ticker.returns[key])}
          />
        ))}
      </View>

      <SectionTitle>RISK</SectionTitle>
      <View style={styles.grid}>
        <Stat label="VOL 30D" value={fmtPct(ticker.volatility['30d'], 1)} />
        <Stat label="VOL 90D" value={fmtPct(ticker.volatility['90d'], 1)} />
        <Stat label="VOL 1Y" value={fmtPct(ticker.volatility['1y'], 1)} />
        <Stat
          label="MAX DD 1Y"
          value={fmtPct(ticker.maxDrawdown1y, 1)}
          color={ticker.maxDrawdown1y === null ? C.text : C.down}
        />
        <Stat label="RETURN/RISK" value={fmtNum(ticker.riskAdjusted1y, 2)} />
      </View>

      <SectionTitle>MOMENTUM</SectionTitle>
      <View style={styles.grid}>
        <Stat label="SCORE" value={fmtNum(ticker.momentumScore, 0)} color={C.acid} width="50%" />
        <Stat
          label={`RANK OF ${snapshot.universeSize}`}
          value={fmtRank(ticker.ranks.momentum)}
          width="50%"
        />
      </View>

      {/* The windows the score is built from, with the skip stated on each
          rather than left to the disclosure. A reader who never opens the
          explanation should still never mistake these for the trailing
          returns above. */}
      <View style={styles.windows}>
        <View style={styles.windowHead}>
          <Text style={styles.windowHeadText}>WINDOW</Text>
          <Text style={styles.windowHeadText}>SKIPPED</Text>
          <Text style={[styles.windowHeadText, styles.windowHeadRight]}>RETURN</Text>
        </View>
        {MOMENTUM_ROWS.map(([key, label]) => {
          const skip = skips[key];
          const value = (ticker.momentumReturns || {})[key];
          return (
            <View key={key} style={styles.windowRow}>
              <Text style={styles.windowLabel}>{label}</Text>
              <Text style={styles.windowSkip}>
                {skip === undefined ? '—' : skip === 0 ? 'none' : `last ${skip}d`}
              </Text>
              <Text style={[styles.windowValue, { color: tone(value) }]}>{fmtPct(value)}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.windowNote}>
        These stop short of today. The RETURNS above run to the latest close — momentum is the
        only figure here that skips anything.
      </Text>

      <Disclosure label="HOW MOMENTUM WORKS ›">
        <Text style={styles.prose}>
          Four returns are measured for every company: 3, 6, 9 and 12 months. Each stops short of
          today rather than running to the last close, because very short-term moves tend to reverse
          rather than persist — so the most recent stretch is skipped instead of counted.
        </Text>
        <Text style={styles.prose}>
          The skip scales with the window at 20 sessions per 250, so the 12-month figure leaves out
          the last 20 sessions and the 3-month one only the last 5. A single fixed month would take
          a twelfth off the yearly window but a third off the quarterly one — a far heavier hand on
          the short end than the long.
        </Text>
        <Text style={styles.prose}>
          This ticker is then ranked against the other {snapshot.universeSize - 1} on each of those
          four windows, and the four placings are averaged and rescaled so 100 is the strongest of
          the {snapshot.universeSize}. A high score means winning across every timeframe, not
          spiking in one.
        </Text>
        <Text style={styles.prose}>
          It stays blank until a company has traded about 13 months — the 12-month window plus the
          skipped one. Scoring on whichever windows happened to exist would be a different measure
          wearing the same name.
        </Text>
      </Disclosure>

      <SectionTitle>RANK IN TOP {snapshot.universeSize}</SectionTitle>
      <View style={styles.grid}>
        <Stat label="MARKET CAP" value={fmtRank(ticker.ranks.marketCap)} color={C.acid} />
        <Stat label="1 MONTH" value={fmtRank(ticker.ranks.return_1m)} />
        <Stat label="3 MONTH" value={fmtRank(ticker.ranks.return_3m)} />
        <Stat label="6 MONTH" value={fmtRank(ticker.ranks.return_6m)} />
        <Stat label="1 YEAR" value={fmtRank(ticker.ranks.return_1y)} />
        <Stat label="RETURN/RISK" value={fmtRank(ticker.ranks.riskAdjusted)} />
        <Stat label="LOW VOL" value={fmtRank(ticker.ranks.volatility)} />
      </View>

      <Text style={styles.footnote}>
        Dividend-adjusted closes, {ticker.firstSession} to {ticker.asOf}. Volatility is annualised
        from daily log returns; return/risk is the 1Y return over 1Y volatility. A blank figure means
        too little history to fill that window.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingHorizontal: S.gutter, paddingBottom: 40 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 16,
  },
  back: { color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1 },
  watch: { color: C.dim, fontFamily: MONO, fontSize: 11, letterSpacing: 1 },
  watching: { color: C.acid },
  identity: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 40, height: 40, borderRadius: 7, backgroundColor: C.surfaceHi, marginRight: 12 },
  identityText: { flex: 1 },
  symbol: { color: C.text, fontFamily: MONO, fontSize: 24, letterSpacing: 2 },
  name: { color: C.dim, fontSize: 12, marginTop: 3 },
  meta: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 0.8, marginTop: 10 },
  priceBlock: {
    marginTop: 18,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  capBlock: { alignItems: 'flex-end', paddingBottom: 3 },
  capLabel: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 0.8 },
  capValue: { color: C.text, fontFamily: MONO, fontSize: 16, marginTop: 3 },
  prose: { color: C.dim, fontSize: 11, lineHeight: 18, marginBottom: 10 },
  price: { color: C.text, fontFamily: MONO, fontSize: 34 },
  change: { fontFamily: MONO, fontSize: 13, marginTop: 4 },
  rangeRow: { flexDirection: 'row', marginBottom: 14 },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chartLabel: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1.4 },
  chartChange: { fontFamily: MONO, fontSize: 13 },
  windows: {
    marginTop: 12,
    borderTopWidth: S.hairline,
    borderTopColor: C.line,
  },
  windowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  windowHeadText: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1, flex: 1 },
  windowHeadRight: { textAlign: 'right' },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: S.hairline,
    borderTopColor: C.lineSoft,
  },
  windowLabel: { color: C.dim, fontFamily: MONO, fontSize: 11, flex: 1 },
  windowSkip: { color: C.faint, fontFamily: MONO, fontSize: 11, flex: 1 },
  windowValue: { fontFamily: MONO, fontSize: 12, flex: 1, textAlign: 'right' },
  windowNote: { color: C.faint, fontSize: 10, lineHeight: 16, marginTop: 10 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: S.hairline,
    borderTopColor: C.line,
    paddingTop: 4,
    marginTop: 8,
  },
  footnote: {
    color: C.faint,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 26,
    borderTopWidth: S.hairline,
    borderTopColor: C.lineSoft,
    paddingTop: 12,
  },
});

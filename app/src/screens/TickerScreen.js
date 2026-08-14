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
import { Chip, SectionTitle, Stat } from '../components/UI';
import { RANGES, changeOver, seriesFor } from '../data';
import { confirm, undo } from '../haptics';
import { C, MONO, S, fmtCap, fmtNum, fmtPct, fmtPrice, fmtRank, tone } from '../theme';

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
        <Text style={styles.price}>{fmtPrice(ticker.price)}</Text>
        <Text style={[styles.change, { color: tone(ticker.changePct) }]}>
          {ticker.change >= 0 ? '+' : ''}{fmtNum(ticker.change)} ({fmtPct(ticker.changePct)})
        </Text>
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
        <Stat label="MOMENTUM" value={fmtNum(ticker.momentumScore, 0)} color={C.acid} />
      </View>

      <SectionTitle>RANK IN TOP {snapshot.universeSize}</SectionTitle>
      <View style={styles.grid}>
        <Stat label="MARKET CAP" value={fmtRank(ticker.ranks.marketCap)} color={C.acid} />
        <Stat label="1 MONTH" value={fmtRank(ticker.ranks.return_1m)} />
        <Stat label="3 MONTH" value={fmtRank(ticker.ranks.return_3m)} />
        <Stat label="6 MONTH" value={fmtRank(ticker.ranks.return_6m)} />
        <Stat label="1 YEAR" value={fmtRank(ticker.ranks.return_1y)} />
        <Stat label="MOMENTUM" value={fmtRank(ticker.ranks.momentum)} />
        <Stat label="RETURN/RISK" value={fmtRank(ticker.ranks.riskAdjusted)} />
        <Stat label="LOW VOL" value={fmtRank(ticker.ranks.volatility)} />
        <Stat label="MKT CAP USD" value={fmtCap(ticker.marketCap)} />
      </View>

      <Text style={styles.footnote}>
        Adjusted closes from {ticker.firstSession} to {ticker.asOf}. Volatility is annualised from
        daily log returns; return/risk is the 1Y return divided by 1Y volatility. Momentum averages
        this ticker's percentile across the 1M, 3M, 6M and 1Y returns, scaled so 100 is the strongest
        of the {snapshot.universeSize} — a read on consistency across timeframes rather than any one
        of them. Blank figures mean the ticker has not traded long enough to fill that window.
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
  priceBlock: { marginTop: 18, marginBottom: 16 },
  price: { color: C.text, fontFamily: MONO, fontSize: 34 },
  change: { fontFamily: MONO, fontSize: 13, marginTop: 4 },
  rangeRow: { flexDirection: 'row', marginBottom: 14 },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chartLabel: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1.4 },
  chartChange: { fontFamily: MONO, fontSize: 13 },
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

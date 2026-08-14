import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PriceChart from '../components/PriceChart';
import { Chip, ChipRow, Disclosure, SectionTitle, Stat } from '../components/UI';
import { RANGES, changeOver, seriesFor, universeLabel } from '../data';
import { confirm, undo } from '../haptics';
import {
  C, MONO, S, T,
  fmtCap, fmtMagnitude, fmtNum, fmtPct, fmtPrice, fmtRank,
  missingReason, slop, tone,
} from '../theme';

const RETURN_ROWS = [
  ['1w', '1 WEEK'],
  ['1m', '1 MONTH'],
  ['3m', '3 MONTH'],
  ['6m', '6 MONTH'],
  ['ytd', 'YTD'],
  ['1y', '1 YEAR'],
  ['2y', '2 YEAR'],
];

const MOMENTUM_ROWS = [
  ['3m', '3 MONTH'],
  ['6m', '6 MONTH'],
  ['9m', '9 MONTH'],
  ['12m', '12 MONTH'],
];

const EDGE = 28;      // left strip that listens for the back swipe
const SWIPE = 60;     // travel before it counts as a back gesture

export default function TickerScreen({
  ticker, snapshot, starred, onBack, onToggleStar, hintScrub, onScrubbed,
}) {
  const [range, setRange] = useState('1Y');
  const swipeStart = useRef(0);

  // Ranks are computed inside whichever table this ticker came from, so every
  // placing on this screen carries the universe it was measured against.
  const scope = universeLabel(snapshot);
  const skip = snapshot.skip || {};
  const returnSkips = skip.returns || {};
  const momentumSkips = skip.momentum || (snapshot.momentum || {}).skips || {};
  const anySkip = Object.values(returnSkips).some((n) => n > 0);

  const sessions = (RANGES.find((r) => r.key === range) || RANGES[4]).sessions;
  const points = useMemo(
    () => seriesFor(ticker, snapshot.dates, sessions),
    [ticker, snapshot.dates, sessions]
  );
  const rangeChange = useMemo(() => changeOver(points), [points]);

  const suffix = (key) => (returnSkips[key] > 0 ? ` −${returnSkips[key]}D` : '');

  return (
    <View style={styles.wrap}>
      {/* An edge swipe back, because reaching for a control in the top-left
          corner one-handed is exactly what iOS taught people not to do. */}
      <View
        style={styles.edge}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => { swipeStart.current = e.nativeEvent.pageX; }}
        onResponderRelease={(e) => {
          if (e.nativeEvent.pageX - swipeStart.current > SWIPE) onBack();
        }}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={onBack} hitSlop={slop(30)} accessibilityRole="button" accessibilityLabel="Back to list">
            <Text style={styles.back}>‹ BACK</Text>
          </Pressable>
          <Pressable
            onPress={() => { (starred ? undo : confirm)(); onToggleStar(ticker.symbol); }}
            hitSlop={slop(30)}
            accessibilityRole="button"
            accessibilityState={{ selected: starred }}
            accessibilityLabel={starred ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <Text style={[styles.watch, starred && styles.watching]}>
              {starred ? '★ WATCHING' : '☆ WATCH'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.identity}>
          {!!ticker.logo && (
            <View style={styles.logoBox}>
              <Image source={{ uri: ticker.logo }} style={styles.logo} resizeMode="contain" />
            </View>
          )}
          <View style={styles.identityText}>
            <Text style={styles.symbol} accessibilityRole="header">{ticker.symbol}</Text>
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

        <ChipRow accessibilityLabel="Chart range">
          {RANGES.map((r) => (
            <Chip
              key={r.key}
              compact
              label={r.key}
              active={r.key === range}
              onPress={() => setRange(r.key)}
              accessibilityLabel={`${r.key} chart range`}
            />
          ))}
        </ChipRow>

        <View style={styles.chartHead}>
          <Text style={styles.chartLabel}>{range} CHANGE</Text>
          <Text style={[styles.chartChange, { color: tone(rangeChange) }]}>{fmtPct(rangeChange)}</Text>
        </View>

        <PriceChart points={points} showHint={hintScrub} onScrubbed={onScrubbed} />

        <SectionTitle>RETURNS</SectionTitle>
        <View style={styles.grid}>
          {RETURN_ROWS.map(([key, label]) => (
            <Stat
              key={key}
              label={`${label}${suffix(key)}`}
              value={fmtPct(ticker.returns[key])}
              color={tone(ticker.returns[key])}
              reason={missingReason(key)}
            />
          ))}
        </View>
        {anySkip && (
          <Text style={styles.note}>
            −nD means the window stops n sessions short of today. Short-term moves tend to reverse
            rather than persist, so every window long enough to afford it leaves its most recent
            stretch out — the same rule everywhere, scaled to each window's length.
          </Text>
        )}

        <SectionTitle>RISK</SectionTitle>
        <View style={styles.grid}>
          <Stat label="VOL 30D" value={fmtMagnitude(ticker.volatility['30d'])} reason={missingReason('30d')} />
          <Stat label="VOL 90D" value={fmtMagnitude(ticker.volatility['90d'])} reason={missingReason('90d')} />
          <Stat label="VOL 1Y" value={fmtMagnitude(ticker.volatility['1y'])} reason={missingReason('1y')} />
          <Stat
            label="MAX DD 1Y"
            value={fmtMagnitude(ticker.maxDrawdown1y)}
            color={ticker.maxDrawdown1y === null ? undefined : C.down}
            reason={missingReason('maxDrawdown')}
          />
          <Stat label="RETURN/RISK" value={fmtNum(ticker.riskAdjusted1y, 2)} reason={missingReason('riskAdjusted')} />
        </View>

        <Disclosure label="HOW RISK IS MEASURED ›">
          <Text style={styles.prose}>
            Volatility is the standard deviation of daily log returns over the window, annualised.
            It is a magnitude, not a direction — 30% means the price typically moves that much in a
            year either way, which is why it carries no sign.
          </Text>
          <Text style={styles.prose}>
            Max drawdown is the deepest peak-to-trough fall within the last year, measured on closing
            prices. It answers what holding through the worst stretch would have felt like, which an
            annual return on its own hides.
          </Text>
          <Text style={styles.prose}>
            Return/risk divides the 1-year return by 1-year volatility: how much movement was
            rewarded per unit of movement endured. There is no risk-free rate in it, so it compares
            these tickers against each other rather than being a Sharpe ratio.
          </Text>
        </Disclosure>

        <SectionTitle>MOMENTUM</SectionTitle>
        <View style={styles.grid}>
          <Stat
            label="SCORE"
            value={fmtNum(ticker.momentumScore, 0)}
            color={C.acid}
            width="50%"
            reason={missingReason('momentum')}
          />
          <Stat
            label={`RANK IN ${scope}`}
            value={fmtRank(ticker.ranks.momentum)}
            width="50%"
            reason={missingReason('momentum')}
          />
        </View>

        {/* The windows the score is built from, with the skip stated on each
            rather than left to the disclosure. */}
        <View style={styles.windows}>
          <View style={styles.windowHead}>
            <Text style={styles.windowHeadText}>WINDOW</Text>
            <Text style={styles.windowHeadText}>SKIPPED</Text>
            <Text style={[styles.windowHeadText, styles.windowHeadRight]}>RETURN</Text>
          </View>
          {MOMENTUM_ROWS.map(([key, label]) => {
            const s = momentumSkips[key];
            const value = (ticker.momentumReturns || {})[key];
            return (
              <View key={key} style={styles.windowRow}>
                <Text style={styles.windowLabel}>{label}</Text>
                <Text style={styles.windowSkip}>
                  {s === undefined ? '—' : s === 0 ? 'none' : `last ${s}d`}
                </Text>
                <Text style={[styles.windowValue, { color: tone(value) }]}>{fmtPct(value)}</Text>
              </View>
            );
          })}
        </View>

        <Disclosure label="HOW MOMENTUM WORKS ›">
          <Text style={styles.prose}>
            Four returns are measured for every company: 3, 6, 9 and 12 months, each stopping short
            of today rather than running to the last close.
          </Text>
          <Text style={styles.prose}>
            The skip scales with the window at 20 sessions per 250, so the 12-month figure leaves out
            the last 20 sessions and the 3-month one only the last 5. A single fixed month would take
            a twelfth off the yearly window but a third off the quarterly one — a far heavier hand on
            the short end than the long.
          </Text>
          <Text style={styles.prose}>
            This ticker is ranked against the other {snapshot.universeSize - 1} in {snapshot.title}{' '}
            on each of those four windows, and the four placings are averaged and rescaled so 100 is
            the strongest of the {snapshot.universeSize}. A high score means winning across every
            timeframe, not spiking in one.
          </Text>
          <Text style={styles.prose}>
            Every table scores itself, so the same company carries a different score in the Top 300
            than it does among its own sector — the field it is being measured against is not the
            same field.
          </Text>
          <Text style={styles.prose}>
            It stays blank until a company has traded about 13 months — the 12-month window plus the
            skipped one. Scoring on whichever windows happened to exist would be a different measure
            wearing the same name.
          </Text>
        </Disclosure>

        <SectionTitle>RANK IN {scope}</SectionTitle>
        <View style={styles.grid}>
          <Stat label="MARKET CAP" value={fmtRank(ticker.ranks.marketCap)} color={C.acid} />
          <Stat label="1 MONTH" value={fmtRank(ticker.ranks.return_1m)} />
          <Stat label="3 MONTH" value={fmtRank(ticker.ranks.return_3m)} />
          <Stat label="6 MONTH" value={fmtRank(ticker.ranks.return_6m)} />
          <Stat label="YTD" value={fmtRank(ticker.ranks.return_ytd)} />
          <Stat label="1 YEAR" value={fmtRank(ticker.ranks.return_1y)} />
          <Stat label="RETURN/RISK" value={fmtRank(ticker.ranks.riskAdjusted)} />
          <Stat label="LOW VOL" value={fmtRank(ticker.ranks.volatility)} />
        </View>

        <Text style={styles.note}>
          Placings run 1 to {snapshot.universeSize} within {snapshot.title}
          {snapshot.scope === 'sector'
            ? ' — this company against its own sector, not the whole market.'
            : '.'}
        </Text>

        <Text style={styles.footnote}>
          Dividend-adjusted closes, {ticker.firstSession} to {ticker.asOf}.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: S.gutter, paddingBottom: 44 },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE, zIndex: 5 },

  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 6, paddingBottom: 16,
  },
  back: { color: C.dim, fontFamily: MONO, fontSize: T.small, letterSpacing: 1 },
  watch: { color: C.dim, fontFamily: MONO, fontSize: T.small, letterSpacing: 1 },
  watching: { color: C.acid },

  identity: { flexDirection: 'row', alignItems: 'center' },
  logoBox: {
    width: 46, height: 46, borderRadius: 9, backgroundColor: C.surfaceHi,
    borderWidth: S.hairline, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', marginRight: 13, overflow: 'hidden',
  },
  logo: { width: 34, height: 34 },
  identityText: { flex: 1 },
  symbol: { color: C.text, fontFamily: MONO, fontSize: 26, letterSpacing: 2 },
  name: { color: C.dim, fontSize: T.body, marginTop: 4 },
  meta: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.6, marginTop: 11 },

  priceBlock: {
    marginTop: 18, marginBottom: 16,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  price: { color: C.text, fontFamily: MONO, fontSize: T.display },
  change: { fontFamily: MONO, fontSize: T.body, marginTop: 5 },
  capBlock: { alignItems: 'flex-end', paddingBottom: 4 },
  capLabel: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.6 },
  capValue: { color: C.text, fontFamily: MONO, fontSize: T.large, marginTop: 4 },

  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chartLabel: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1.2 },
  chartChange: { fontFamily: MONO, fontSize: T.body },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    borderTopWidth: S.hairline, borderTopColor: C.line,
    paddingTop: 4, marginTop: 8,
  },
  note: { color: C.faint, fontSize: T.micro, lineHeight: T.micro + 6, marginTop: 10 },
  prose: { color: C.dim, fontSize: T.small, lineHeight: T.small + 7, marginBottom: 11 },

  windows: { marginTop: 12, borderTopWidth: S.hairline, borderTopColor: C.line },
  windowHead: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  windowHeadText: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.8, flex: 1 },
  windowHeadRight: { textAlign: 'right' },
  windowRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 9,
    borderTopWidth: S.hairline, borderTopColor: C.lineSoft,
  },
  windowLabel: { color: C.dim, fontFamily: MONO, fontSize: T.small, flex: 1 },
  windowSkip: { color: C.faint, fontFamily: MONO, fontSize: T.small, flex: 1 },
  windowValue: { fontFamily: MONO, fontSize: T.body, flex: 1, textAlign: 'right' },

  footnote: {
    color: C.faint, fontSize: T.micro, lineHeight: T.micro + 5, marginTop: 26,
    borderTopWidth: S.hairline, borderTopColor: C.lineSoft, paddingTop: 12,
  },
});

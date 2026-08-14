import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Sparkline from './Sparkline';
import { C, MONO, S, fmtCap, fmtNum, fmtPct, fmtPrice, tone } from '../theme';

const formatMetric = (format, value) => {
  switch (format) {
    case 'cap': return fmtCap(value);
    case 'pct': return fmtPct(value);
    case 'pct0': return value === null || value === undefined ? '—' : `${value.toFixed(0)}%`;
    case 'ratio': return fmtNum(value, 2);
    case 'score': return fmtNum(value, 0);
    default: return fmtNum(value);
  }
};

function Logo({ uri, symbol, enabled }) {
  const [failed, setFailed] = useState(false);
  if (!enabled || !uri || failed) {
    return (
      <View style={[styles.logo, styles.logoFallback]}>
        <Text style={styles.logoLetter}>{symbol.slice(0, 1)}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.logo}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

function TickerRow({ ticker, position, sort, settings, starred, onPress, onToggleStar }) {
  // Sorting by market cap makes the row number the rank, so the metric column
  // would just repeat it; show the day's move there instead.
  const metricIsCap = sort.format === 'cap';
  const metricValue = metricIsCap ? ticker.changePct : sort.value(ticker);
  const metricColour = metricIsCap || sort.format === 'pct'
    ? tone(metricValue)
    : C.text;

  return (
    <Pressable
      onPress={() => onPress(ticker)}
      onLongPress={() => onToggleStar(ticker.symbol)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.position}>{position}</Text>

      <Logo uri={ticker.logo} symbol={ticker.symbol} enabled={settings.showLogos} />

      <View style={styles.identity}>
        <View style={styles.symbolLine}>
          <Text style={styles.symbol} numberOfLines={1}>{ticker.symbol}</Text>
          {starred && <Text style={styles.star}>★</Text>}
        </View>
        <Text style={styles.name} numberOfLines={1}>{ticker.name}</Text>
      </View>

      {settings.showSparklines && (
        <View style={styles.spark}>
          <Sparkline
            points={ticker.spark}
            color={(ticker.sparkChange ?? 0) >= 0 ? C.acid : C.down}
          />
        </View>
      )}

      <View style={styles.numbers}>
        <Text style={styles.price}>{fmtPrice(ticker.price)}</Text>
        <Text style={[styles.metric, { color: metricColour }]}>
          {formatMetric(metricIsCap ? 'pct' : sort.format, metricValue)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: S.gutter,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
  },
  rowPressed: { backgroundColor: C.surface },
  position: {
    width: 24,
    color: C.faint,
    fontFamily: MONO,
    fontSize: 11,
  },
  logo: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: C.surfaceHi,
    marginRight: 10,
  },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  logoLetter: { color: C.dim, fontFamily: MONO, fontSize: 12 },
  identity: { flex: 1, paddingRight: 8 },
  symbolLine: { flexDirection: 'row', alignItems: 'center' },
  symbol: { color: C.text, fontFamily: MONO, fontSize: 13, letterSpacing: 0.5 },
  star: { color: C.acid, fontSize: 10, marginLeft: 5 },
  name: { color: C.faint, fontSize: 10, marginTop: 2 },
  spark: { width: 56, marginRight: 10 },
  numbers: { alignItems: 'flex-end', minWidth: 74 },
  price: { color: C.text, fontFamily: MONO, fontSize: 13 },
  metric: { fontFamily: MONO, fontSize: 11, marginTop: 2 },
});

export default React.memo(TickerRow);

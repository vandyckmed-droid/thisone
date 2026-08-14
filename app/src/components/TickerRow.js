import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Sparkline from './Sparkline';
import { confirm, tap, undo } from '../haptics';
import { C, MONO, S, T, fmtCap, fmtNum, fmtPct, fmtPrice, slop, tone } from '../theme';

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

/**
 * Logos arrive from the issuers themselves, so some are transparent and some
 * are on white. Dropped straight onto the page the white ones punch bright
 * holes through a dark list, so every logo sits in the same padded container
 * and reads as one column.
 */
function Logo({ uri, symbol, enabled }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.logoBox}>
      {!enabled || !uri || failed ? (
        <Text style={styles.logoLetter}>{symbol.slice(0, 1)}</Text>
      ) : (
        <Image
          source={{ uri }}
          style={styles.logo}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

function TickerRow({ ticker, position, sort, settings, starred, onPress, onToggleStar }) {
  // Sorting by market cap makes the row number the rank, so the metric column
  // would just repeat it; show the day's move there instead.
  const metricIsCap = sort.format === 'cap';
  const metricValue = metricIsCap ? ticker.changePct : sort.value(ticker);
  const metricColour = metricIsCap || sort.format === 'pct' ? tone(metricValue) : C.text;
  const shown = formatMetric(metricIsCap ? 'pct' : sort.format, metricValue);

  return (
    <Pressable
      onPress={() => {
        tap();
        onPress(ticker);
      }}
      accessibilityRole="button"
      accessibilityLabel={
        `${ticker.symbol}, ${ticker.name}. ${fmtPrice(ticker.price)}, ` +
        `${fmtPct(ticker.changePct)} today. ${sort.label} ${shown}.` +
        (position ? ` Rank ${position}.` : '') +
        (starred ? ' On watchlist.' : '')
      }
      style={({ pressed }) => [
        styles.row,
        starred && styles.rowStarred,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={styles.position}>
        {position === null || position === undefined ? '—' : position}
      </Text>

      <Logo uri={ticker.logo} symbol={ticker.symbol} enabled={settings.showLogos} />

      <View style={styles.identity}>
        <Text style={styles.symbol} numberOfLines={1}>{ticker.symbol}</Text>
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
        <Text style={[styles.metric, { color: metricColour }]}>{shown}</Text>
      </View>

      {/* Nested inside the row's Pressable but claiming its own touches, so the
          star never opens the ticker and the row never toggles the watchlist.
          A bare glyph rather than a boxed control: repeated down a hundred rows
          a box is a lot of furniture for a binary. */}
      <Pressable
        onPress={() => {
          (starred ? undo : confirm)();
          onToggleStar(ticker.symbol);
        }}
        hitSlop={slop(24)}
        accessibilityRole="button"
        accessibilityState={{ selected: starred }}
        accessibilityLabel={
          starred ? `Remove ${ticker.symbol} from watchlist` : `Add ${ticker.symbol} to watchlist`
        }
        style={({ pressed }) => [styles.watch, pressed && styles.watchPressed]}
      >
        <Text style={[styles.watchGlyph, starred && styles.watchGlyphOn]}>
          {starred ? '★' : '☆'}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Looser than it was: with the type a size larger, packing the maximum
    // number of rows onto the screen costs more in scanability than it buys.
    paddingVertical: 13,
    paddingRight: S.gutter - 2,
    paddingLeft: S.gutter - 2,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
    // The edge is always present and usually invisible, so marking a row tints
    // it rather than nudging every column two pixels sideways.
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  rowStarred: { borderLeftColor: C.acid, backgroundColor: 'rgba(200,255,0,0.05)' },
  rowPressed: { backgroundColor: C.surface },

  position: { width: 30, color: C.faint, fontFamily: MONO, fontSize: T.micro },

  logoBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: C.surfaceHi,
    borderWidth: S.hairline,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
    overflow: 'hidden',
  },
  logo: { width: 22, height: 22 },
  logoLetter: { color: C.dim, fontFamily: MONO, fontSize: T.small },

  identity: { flex: 1, paddingRight: 8 },
  symbol: { color: C.text, fontFamily: MONO, fontSize: T.body, letterSpacing: 0.5 },
  name: { color: C.faint, fontSize: T.micro, marginTop: 3 },

  spark: { width: 54, marginRight: 10 },
  numbers: { alignItems: 'flex-end', minWidth: 78 },
  price: { color: C.text, fontFamily: MONO, fontSize: T.body },
  metric: { fontFamily: MONO, fontSize: T.small, marginTop: 3 },

  watch: { paddingLeft: 12, alignItems: 'center', justifyContent: 'center' },
  watchPressed: { opacity: 0.5 },
  watchGlyph: { color: C.faint, fontSize: 19, lineHeight: 23 },
  watchGlyphOn: { color: C.acid },
});

export default React.memo(TickerRow);

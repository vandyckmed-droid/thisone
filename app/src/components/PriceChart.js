import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { tick } from '../haptics';
import { C, MONO, T, fmtPrice } from '../theme';

const H = 200;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

/**
 * Detail chart with drag-to-scrub. Colour follows the direction of the selected
 * range rather than the day, so a green line always means "up over what you are
 * looking at".
 *
 * Width is measured rather than taken from the screen, so the chart is right on
 * a rotated phone, a split view or any future layout that is not simply the
 * window minus two gutters.
 */
export default function PriceChart({ points, showHint, onScrubbed }) {
  const [cursor, setCursor] = useState(null);
  const [width, setWidth] = useState(0);

  const geometry = useMemo(() => {
    if (!points || points.length < 2 || width <= 0) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.close < min) min = p.close;
      if (p.close > max) max = p.close;
    }
    // A flat series would divide by zero; give it a nominal band instead.
    const span = max - min || Math.abs(max) * 0.02 || 1;
    const usable = H - PAD_TOP - PAD_BOTTOM;
    const step = width / (points.length - 1);

    const xy = points.map((p, i) => ({
      x: i * step,
      y: PAD_TOP + usable - ((p.close - min) / span) * usable,
    }));

    const line = xy.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ');
    const area = `${line} L${width} ${H - PAD_BOTTOM} L0 ${H - PAD_BOTTOM} Z`;
    return { min, max, xy, line, area, step };
  }, [points, width]);

  const rising = points && points.length > 1 && points[points.length - 1].close >= points[0].close;
  const stroke = rising ? C.acid : C.down;

  const onScrub = (evt) => {
    if (!geometry) return;
    const x = evt.nativeEvent.locationX;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(x / geometry.step)));
    setCursor((previous) => {
      // Only on a change of session, or a slow drag across a dense chart would
      // fire a continuous buzz rather than discrete detents.
      if (previous !== index) tick();
      return index;
    });
    if (onScrubbed) onScrubbed();
  };

  const active = cursor === null || !geometry ? null : points[cursor];

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.readout}>
        {active ? (
          <>
            <Text style={styles.readoutPrice}>{fmtPrice(active.close)}</Text>
            <Text style={styles.readoutDate}>{active.date}</Text>
          </>
        ) : (
          <>
            <Text style={styles.readoutRange}>
              {geometry ? (
                <>
                  <Text style={styles.extremaKey}>LOW </Text>
                  {fmtPrice(geometry.min)}
                  <Text style={styles.extremaKey}>   HIGH </Text>
                  {fmtPrice(geometry.max)}
                </>
              ) : ''}
            </Text>
            <Text style={styles.readoutDate}>{points ? `${points.length} sessions` : ''}</Text>
          </>
        )}
      </View>

      <View
        style={{ height: H }}
        accessibilityLabel={
          geometry
            ? `Price chart, ${points.length} sessions, low ${fmtPrice(geometry.min)}, high ${fmtPrice(geometry.max)}`
            : 'Price chart unavailable'
        }
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onScrub}
        onResponderMove={onScrub}
        onResponderRelease={() => setCursor(null)}
        onResponderTerminate={() => setCursor(null)}
      >
        {geometry ? (
          <Svg width={width} height={H}>
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity="0.22" />
                <Stop offset="1" stopColor={stroke} stopOpacity="0" />
              </LinearGradient>
            </Defs>

            <Line x1="0" y1={H - PAD_BOTTOM} x2={width} y2={H - PAD_BOTTOM} stroke={C.line} strokeWidth="1" />
            <Path d={geometry.area} fill="url(#fade)" />
            <Path d={geometry.line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />

            {active && (
              <>
                <Line
                  x1={geometry.xy[cursor].x}
                  y1={PAD_TOP - 8}
                  x2={geometry.xy[cursor].x}
                  y2={H - PAD_BOTTOM}
                  stroke={C.dim}
                  strokeWidth="1"
                />
                <Circle cx={geometry.xy[cursor].x} cy={geometry.xy[cursor].y} r="4.5" fill={stroke} />
              </>
            )}
          </Svg>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>NOT ENOUGH HISTORY</Text>
          </View>
        )}

        {/* Shown until the reader scrubs their first chart, then never again --
            an affordance nobody discovers is the same as one that is missing. */}
        {geometry && showHint && !active && (
          <View pointerEvents="none" style={styles.hint}>
            <Text style={styles.hintText}>DRAG TO INSPECT</Text>
          </View>
        )}
      </View>

      {geometry && (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{points[0].date}</Text>
          <Text style={styles.axisText}>{points[points.length - 1].date}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  readoutPrice: { color: C.text, fontFamily: MONO, fontSize: T.large },
  readoutRange: { color: C.text, fontFamily: MONO, fontSize: T.micro },
  extremaKey: { color: C.faint },
  readoutDate: { color: C.faint, fontFamily: MONO, fontSize: T.micro },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { color: C.faint, fontFamily: MONO, fontSize: T.micro },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1 },
  hint: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  hintText: {
    color: C.dim,
    fontFamily: MONO,
    fontSize: T.micro,
    letterSpacing: 1.6,
    backgroundColor: 'rgba(20,21,24,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    overflow: 'hidden',
  },
});

import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, MONO, S } from '../theme';

/**
 * Horizontally scrolling row of chips.
 *
 * The fixed height is load-bearing. A horizontal ScrollView placed in a flex
 * column gets compressed by whatever else is competing for the same vertical
 * space -- here the list below it -- which crops the chips mid-glyph and laps
 * one row over the next. Pinning the height and refusing to grow or shrink
 * keeps each row exactly one chip tall.
 */
export function ChipRow({ children }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipRow}
      contentContainerStyle={styles.chipRowContent}
    >
      {children}
    </ScrollView>
  );
}

/** Selectable pill used for sort keys, sectors and chart ranges. */
export function Chip({ label, active, onPress, compact }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        compact && styles.chipCompact,
        active && styles.chipActive,
        pressed && !active && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Label/value pair for the detail screen's stat grid. */
export function Stat({ label, value, color, width = '33.33%' }) {
  return (
    <View style={[styles.stat, { width }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

export function Banner({ text, tone: kind = 'warn' }) {
  return (
    <View style={[styles.banner, kind === 'error' && styles.bannerError]}>
      <Text style={[styles.bannerText, kind === 'error' && styles.bannerTextError]}>{text}</Text>
    </View>
  );
}

export function Loading({ label = 'LOADING' }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={C.acid} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function Empty({ title, hint }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!hint && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 27px of chip (13 line + 12 padding + 2 border) with room to spare.
  chipRow: { flexGrow: 0, flexShrink: 0, height: 30, marginBottom: 9 },
  chipRowContent: { paddingHorizontal: S.gutter, alignItems: 'center' },

  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: S.hairline,
    borderColor: C.line,
    backgroundColor: C.surface,
    marginRight: 6,
  },
  chipCompact: { paddingHorizontal: 9, paddingVertical: 5 },
  chipPressed: { borderColor: C.faint },
  chipActive: { backgroundColor: C.acid, borderColor: C.acid },
  // An explicit lineHeight keeps Menlo's ascenders from being clipped by the
  // pill once letterSpacing is applied.
  chipText: { color: C.dim, fontFamily: MONO, fontSize: 10, lineHeight: 13, letterSpacing: 0.8 },
  chipTextActive: { color: C.bg },

  stat: { paddingVertical: 9, paddingRight: 10 },
  statLabel: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 0.8 },
  statValue: { color: C.text, fontFamily: MONO, fontSize: 14, marginTop: 3 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 2,
  },
  section: { color: C.faint, fontFamily: MONO, fontSize: 10, letterSpacing: 1.6 },

  banner: {
    backgroundColor: C.acidGlow,
    borderLeftWidth: 2,
    borderLeftColor: C.acid,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginHorizontal: S.gutter,
    marginBottom: 8,
    borderRadius: 4,
  },
  bannerError: { backgroundColor: 'rgba(255,83,52,0.10)', borderLeftColor: C.down },
  bannerText: { color: C.acidDim, fontFamily: MONO, fontSize: 10 },
  bannerTextError: { color: C.down },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: C.faint, fontFamily: MONO, fontSize: 10, letterSpacing: 2, marginTop: 10 },

  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingHorizontal: 30 },
  emptyTitle: { color: C.dim, fontFamily: MONO, fontSize: 12, letterSpacing: 1 },
  emptyHint: { color: C.faint, fontSize: 11, marginTop: 8, textAlign: 'center', lineHeight: 17 },
});

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { tick } from '../haptics';
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
      onPress={() => {
        tick();
        onPress();
      }}
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

/**
 * A labelled row that reveals its body when tapped.
 *
 * Methodology belongs on the screen it describes, but a paragraph of it sitting
 * open under every ticker is noise for the ninety-nine visits where you already
 * know how the number is built.
 */
export function Disclosure({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.disclosure}>
      <Pressable
        onPress={() => {
          tick();
          setOpen((wasOpen) => !wasOpen);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.disclosureRow, pressed && styles.disclosurePressed]}
      >
        <Text style={styles.disclosureLabel}>{label}</Text>
        <Text style={styles.disclosureMark}>{open ? '⌄' : '›'}</Text>
      </Pressable>
      {open && <View style={styles.disclosureBody}>{children}</View>}
    </View>
  );
}

/**
 * One control that opens a list, for a setting with more options than deserve
 * permanent space on screen.
 */
export function SelectSheet({ title, options, value, visible, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        {/* The inner press is swallowed so tapping the sheet itself does not
            dismiss it; only the backdrop does. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView bounces={false}>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    tick();
                    onSelect(option.value);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
                >
                  <Text style={[styles.sheetLabel, active && styles.sheetLabelActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.sheetCount, active && styles.sheetLabelActive]}>
                    {active ? `${option.count}  ✓` : option.count}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The control that opens a SelectSheet, showing what is currently chosen. */
export function SelectButton({ label, active, onPress }) {
  return (
    <Pressable
      onPress={() => {
        tick();
        onPress();
      }}
      style={({ pressed }) => [
        styles.select,
        active && styles.selectActive,
        pressed && styles.selectPressed,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.selectText, active && styles.selectTextActive]}
      >
        {label}
      </Text>
      <Text style={[styles.selectMark, active && styles.selectTextActive]}>▾</Text>
    </Pressable>
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

  select: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: S.radius,
    borderWidth: S.hairline,
    borderColor: C.line,
    backgroundColor: C.surface,
    maxWidth: 150,
  },
  selectActive: { borderColor: C.acid },
  selectPressed: { borderColor: C.faint },
  selectText: {
    color: C.dim,
    fontFamily: MONO,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.8,
    flexShrink: 1,
  },
  selectTextActive: { color: C.acid },
  selectMark: { color: C.faint, fontFamily: MONO, fontSize: 10, marginLeft: 6 },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopWidth: S.hairline,
    borderTopColor: C.line,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 16,
    paddingBottom: 28,
    maxHeight: '72%',
  },
  sheetTitle: {
    color: C.faint,
    fontFamily: MONO,
    fontSize: 10,
    letterSpacing: 1.6,
    paddingHorizontal: S.gutter,
    paddingBottom: 10,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.gutter,
    paddingVertical: 13,
    borderTopWidth: S.hairline,
    borderTopColor: C.lineSoft,
  },
  sheetRowPressed: { backgroundColor: C.surfaceHi },
  sheetLabel: { color: C.text, fontFamily: MONO, fontSize: 12, letterSpacing: 0.5 },
  sheetLabelActive: { color: C.acid },
  sheetCount: { color: C.faint, fontFamily: MONO, fontSize: 11 },

  disclosure: {
    marginTop: 18,
    borderTopWidth: S.hairline,
    borderTopColor: C.line,
  },
  disclosureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  disclosurePressed: { opacity: 0.6 },
  disclosureLabel: { color: C.dim, fontFamily: MONO, fontSize: 10, letterSpacing: 1.4 },
  disclosureMark: { color: C.acid, fontFamily: MONO, fontSize: 14 },
  disclosureBody: { paddingBottom: 14 },

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

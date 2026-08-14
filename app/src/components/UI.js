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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { tick } from '../haptics';
import { C, MONO, S, T, slop } from '../theme';

/**
 * Horizontally scrolling row of chips, with a fade at the right edge while
 * there is more to reach.
 *
 * The height is a minimum rather than a fixed value. A fixed height was what
 * originally stopped the row being crushed by the list below it, but it also
 * clips the moment anyone raises their text size, so the row now refuses to
 * grow or shrink under flex instead and is free to get taller.
 */
export function ChipRow({ children, accessibilityLabel }) {
  const [overflow, setOverflow] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [width, setWidth] = useState(0);

  return (
    <View style={styles.chipRowWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
        accessibilityLabel={accessibilityLabel}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onContentSizeChange={(w) => setOverflow(w > width + 1)}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          setAtEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - 2);
        }}
        scrollEventThrottle={32}
      >
        {children}
      </ScrollView>

      {overflow && !atEnd && (
        <View pointerEvents="none" style={styles.fade}>
          <Svg width={36} height="100%">
            <Defs>
              <LinearGradient id="chipFade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={C.bg} stopOpacity="0" />
                <Stop offset="1" stopColor={C.bg} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="36" height="100%" fill="url(#chipFade)" />
          </Svg>
          <Text style={styles.fadeMark}>›</Text>
        </View>
      )}
    </View>
  );
}

/** Selectable pill. The pill stays small; its touch area does not. */
export function Chip({ label, active, onPress, compact, accessibilityLabel }) {
  return (
    <Pressable
      onPress={() => {
        tick();
        onPress();
      }}
      hitSlop={slop(compact ? 30 : 34)}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={accessibilityLabel || label}
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

/**
 * Label/value pair. A metric that cannot be computed says why in place of the
 * value, because a bare dash makes a reader wonder whether the app is broken.
 */
export function Stat({ label, value, color, width = '33.33%', reason }) {
  const blank = value === '—' || value === null || value === undefined;
  return (
    <View style={[styles.stat, { width }]}>
      <Text style={styles.statLabel}>{label}</Text>
      {blank && reason ? (
        <Text style={styles.statReason}>{reason}</Text>
      ) : (
        <Text style={[styles.statValue, color && { color }]}>{value}</Text>
      )}
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

/** One control that opens a list, for a setting with more options than
 *  deserve permanent space on screen. */
export function SelectSheet({ title, options, value, visible, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Dismiss">
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
                >
                  <Text style={[styles.sheetLabel, active && styles.sheetLabelActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.sheetCount, active && styles.sheetLabelActive]}>
                    {option.count === undefined ? (active ? '✓' : '') : active ? `${option.count}  ✓` : option.count}
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
export function SelectButton({ label, active, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={() => {
        tick();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        styles.select,
        active && styles.selectActive,
        pressed && styles.selectPressed,
      ]}
    >
      <Text numberOfLines={1} style={[styles.selectText, active && styles.selectTextActive]}>
        {label}
      </Text>
      <Text style={[styles.selectMark, active && styles.selectTextActive]}>▾</Text>
    </Pressable>
  );
}

/** Text button that reads as an action rather than a filter. */
export function ActionButton({ label, onPress, busy, tone: kind = 'normal' }) {
  return (
    <Pressable
      onPress={busy ? undefined : () => { tick(); onPress(); }}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!busy, busy: !!busy }}
      style={({ pressed }) => [
        styles.action,
        kind === 'danger' && styles.actionDanger,
        busy && styles.actionBusy,
        pressed && !busy && styles.actionPressed,
      ]}
    >
      <Text style={[styles.actionText, kind === 'danger' && styles.actionTextDanger, busy && styles.actionTextBusy]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section} accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

export function Banner({ text, tone: kind = 'warn' }) {
  return (
    <View style={[styles.banner, kind === 'error' && styles.bannerError, kind === 'ok' && styles.bannerOk]}>
      <Text style={[styles.bannerText, kind === 'error' && styles.bannerTextError]}>{text}</Text>
    </View>
  );
}

/** Transient message with an optional single action, for undoing a mistake. */
export function Snackbar({ text, actionLabel, onAction }) {
  return (
    <View style={styles.snack} accessibilityLiveRegion="polite">
      <Text style={styles.snackText} numberOfLines={2}>{text}</Text>
      {!!actionLabel && (
        <Pressable onPress={onAction} hitSlop={slop(28)} accessibilityRole="button">
          <Text style={styles.snackAction}>{actionLabel}</Text>
        </Pressable>
      )}
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
  chipRowWrap: { position: 'relative' },
  chipRow: { flexGrow: 0, flexShrink: 0, marginBottom: 8 },
  chipRowContent: { paddingHorizontal: S.gutter, alignItems: 'center', paddingVertical: 4 },
  fade: { position: 'absolute', right: 0, top: 0, bottom: 8, width: 36, justifyContent: 'center', alignItems: 'flex-end' },
  fadeMark: { position: 'absolute', right: 3, color: C.dim, fontFamily: MONO, fontSize: T.body },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 7,
    borderWidth: S.hairline,
    borderColor: C.line,
    backgroundColor: C.surface,
    marginRight: 7,
  },
  chipCompact: { paddingHorizontal: 10, paddingVertical: 7 },
  chipPressed: { borderColor: C.faint },
  chipActive: { backgroundColor: C.acid, borderColor: C.acid },
  chipText: { color: C.dim, fontFamily: MONO, fontSize: T.micro, lineHeight: T.micro + 3, letterSpacing: 0.8 },
  chipTextActive: { color: C.bg },

  select: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: S.radius,
    borderWidth: S.hairline,
    borderColor: C.line,
    backgroundColor: C.surface,
    maxWidth: 158,
  },
  selectActive: { borderColor: C.acid },
  selectPressed: { borderColor: C.faint },
  selectText: { color: C.dim, fontFamily: MONO, fontSize: T.micro, lineHeight: T.micro + 3, letterSpacing: 0.6, flexShrink: 1 },
  selectTextActive: { color: C.acid },
  selectMark: { color: C.faint, fontFamily: MONO, fontSize: T.micro, marginLeft: 6 },

  action: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 7,
    borderWidth: S.hairline,
    borderColor: C.acid,
    marginRight: 8,
    marginTop: 8,
  },
  actionDanger: { borderColor: C.down },
  actionPressed: { backgroundColor: C.acidGlow },
  actionBusy: { borderColor: C.line },
  actionText: { color: C.acid, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1 },
  actionTextDanger: { color: C.down },
  actionTextBusy: { color: C.faint },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
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
    color: C.dim, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1.4,
    paddingHorizontal: S.gutter, paddingBottom: 10,
  },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.gutter, minHeight: S.tap, paddingVertical: 12,
    borderTopWidth: S.hairline, borderTopColor: C.lineSoft,
  },
  sheetRowPressed: { backgroundColor: C.surfaceHi },
  sheetLabel: { color: C.text, fontFamily: MONO, fontSize: T.body, letterSpacing: 0.4, flexShrink: 1 },
  sheetLabelActive: { color: C.acid },
  sheetCount: { color: C.dim, fontFamily: MONO, fontSize: T.small, marginLeft: 12 },

  disclosure: { marginTop: 18, borderTopWidth: S.hairline, borderTopColor: C.line },
  disclosureRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: S.tap, paddingVertical: 12,
  },
  disclosurePressed: { opacity: 0.6 },
  disclosureLabel: { color: C.dim, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1.3 },
  disclosureMark: { color: C.acid, fontFamily: MONO, fontSize: T.large },
  disclosureBody: { paddingBottom: 14 },

  stat: { paddingVertical: 10, paddingRight: 10 },
  statLabel: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.6 },
  statValue: { color: C.text, fontFamily: MONO, fontSize: T.large, marginTop: 4 },
  statReason: { color: C.faint, fontSize: T.micro, marginTop: 5, fontStyle: 'italic' },

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 24, marginBottom: 2,
  },
  section: { color: C.dim, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1.5 },

  banner: {
    backgroundColor: C.acidGlow, borderLeftWidth: 2, borderLeftColor: C.acid,
    paddingVertical: 9, paddingHorizontal: 11, marginHorizontal: S.gutter,
    marginBottom: 8, borderRadius: 4,
  },
  bannerError: { backgroundColor: 'rgba(255,107,79,0.12)', borderLeftColor: C.down },
  bannerOk: { backgroundColor: 'rgba(200,255,0,0.08)' },
  bannerText: { color: C.dim, fontFamily: MONO, fontSize: T.micro, lineHeight: T.micro + 5 },
  bannerTextError: { color: C.down },

  snack: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.surfaceHi, borderWidth: S.hairline, borderColor: C.line,
    borderRadius: S.radius, marginHorizontal: S.gutter, marginBottom: 8,
    paddingHorizontal: 14, minHeight: S.tap,
  },
  snackText: { color: C.text, fontSize: T.small, flexShrink: 1, paddingVertical: 10 },
  snackAction: { color: C.acid, fontFamily: MONO, fontSize: T.micro, letterSpacing: 1, paddingLeft: 14 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: C.dim, fontFamily: MONO, fontSize: T.micro, letterSpacing: 2, marginTop: 12 },

  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 70, paddingHorizontal: 30 },
  emptyTitle: { color: C.dim, fontFamily: MONO, fontSize: T.body, letterSpacing: 1 },
  emptyHint: { color: C.faint, fontSize: T.small, marginTop: 10, textAlign: 'center', lineHeight: 19 },
});

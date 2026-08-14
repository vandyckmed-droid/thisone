import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  ActionButton, Banner, Disclosure, SectionTitle, SelectButton, SelectSheet,
} from '../components/UI';
import { sortByKey, sortOptions } from '../data';
import { DEFAULT_SOURCE } from '../storage';
import { C, MONO, S, T, fmtWhen } from '../theme';

function Toggle({ label, hint, value, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {!!hint && <Text style={styles.toggleHint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: C.line, true: C.acidDim }}
        thumbColor={value ? C.acid : C.faint}
        ios_backgroundColor={C.line}
      />
    </View>
  );
}

function Fact({ label, value }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factKey}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export default function SettingsScreen({
  settings,
  onChange,
  snapshot,
  lastFetched,
  watchlistCount,
  onClearWatchlist,
  onResetAll,
  onRefresh,
  refreshing,
  refreshResult,
}) {
  const [draftUrl, setDraftUrl] = useState(settings.sourceUrl);
  const [sortOpen, setSortOpen] = useState(false);
  const dirty = draftUrl.trim() !== settings.sourceUrl;

  /** Saving and refreshing are one action: a URL you cannot see the result of
   *  is worse than no URL field at all. */
  const applyUrl = () => {
    const url = draftUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('Invalid URL', 'The snapshot URL must start with http:// or https://');
      return;
    }
    onChange({ sourceUrl: url });
    onRefresh(url);
  };

  const confirm = (title, message, action) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: action },
    ]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">SETTINGS</Text>

      <SectionTitle>DISPLAY</SectionTitle>
      <View style={styles.selectRow}>
        <Text style={styles.fieldLabel}>DEFAULT SORT ON OPEN</Text>
        <SelectButton
          label={sortByKey(settings.defaultSort).label}
          onPress={() => setSortOpen(true)}
          accessibilityLabel={`Default sort, ${sortByKey(settings.defaultSort).label}`}
        />
      </View>

      <Toggle
        label="Company logos"
        hint="Loaded from FMP's image CDN"
        value={settings.showLogos}
        onChange={(v) => onChange({ showLogos: v })}
      />
      <Toggle
        label="Row sparklines"
        hint="90-session trend beside each row"
        value={settings.showSparklines}
        onChange={(v) => onChange({ showSparklines: v })}
      />
      <Toggle
        label="Haptics"
        hint="Taps, chip selections and a tick per session while scrubbing a chart"
        value={settings.haptics}
        onChange={(v) => onChange({ haptics: v })}
      />
      <Toggle
        label="Refresh on open"
        hint="Otherwise the cached snapshot is used until you pull to refresh"
        value={settings.refreshOnOpen}
        onChange={(v) => onChange({ refreshOnOpen: v })}
      />

      <SectionTitle>SNAPSHOT</SectionTitle>
      <Fact label="DATA DATE" value={snapshot?.dataDate || '—'} />
      <Fact
        label="BUILT"
        value={snapshot?.generatedAt?.replace('T', ' ').replace('+00:00', ' UTC') || '—'}
      />
      <Fact label="UNIVERSE" value={`${snapshot?.universeSize ?? '—'} tickers`} />
      <Fact label="SESSIONS" value={snapshot?.sessions ?? '—'} />
      <Fact label="FETCHED" value={fmtWhen(lastFetched)} />

      <View style={styles.actions}>
        <ActionButton
          label={refreshing ? 'REFRESHING…' : 'REFRESH NOW'}
          busy={refreshing}
          onPress={() => onRefresh()}
        />
      </View>
      {!!refreshResult && (
        <View style={styles.feedback}>
          <Banner text={refreshResult.message} tone={refreshResult.ok ? 'ok' : 'error'} />
        </View>
      )}

      <SectionTitle>STORAGE</SectionTitle>
      <Text style={styles.hint}>
        The watchlist, these settings and the last snapshot live on this phone only. There is no
        account and no server holding any of it.
      </Text>
      <View style={styles.actions}>
        <ActionButton
          label={`CLEAR WATCHLIST (${watchlistCount})`}
          tone="danger"
          onPress={() =>
            confirm('Clear watchlist', `Remove all ${watchlistCount} tracked tickers?`, onClearWatchlist)
          }
        />
        <ActionButton
          label="RESET ALL DATA"
          tone="danger"
          onPress={() =>
            confirm('Reset everything', 'Clear the watchlist, settings and cached snapshot?', onResetAll)
          }
        />
      </View>

      {/* A raw GitHub URL is indispensable while working on the pipeline and
          irrelevant every other day, so it folds away rather than heading the
          screen. */}
      <Disclosure label="ADVANCED ›">
        <Text style={styles.fieldLabel}>SNAPSHOT URL</Text>
        <TextInput
          value={draftUrl}
          onChangeText={setDraftUrl}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          placeholder={DEFAULT_SOURCE}
          placeholderTextColor={C.faint}
          accessibilityLabel="Snapshot URL"
          style={styles.input}
        />
        <View style={styles.actions}>
          <ActionButton
            label={dirty ? 'SAVE & REFRESH' : 'SAVED'}
            busy={!dirty || refreshing}
            onPress={applyUrl}
          />
          <ActionButton
            label="RESET URL"
            onPress={() => {
              setDraftUrl(DEFAULT_SOURCE);
              onChange({ sourceUrl: DEFAULT_SOURCE });
              onRefresh(DEFAULT_SOURCE);
            }}
          />
        </View>
        <Text style={styles.hint}>
          Point this at any raw snapshot.json — a fork, a branch, or a local server while you are
          testing the pipeline. Nothing is saved until you tap save, and the result of the fetch is
          reported above.
        </Text>
        <Fact label="SOURCE" value={snapshot?.source || '—'} />
      </Disclosure>

      <Text style={styles.footnote}>
        Prices are dividend-adjusted daily closes from Financial Modeling Prep, refreshed after the
        US close. For information only — not investment advice.
      </Text>

      <SelectSheet
        title="DEFAULT SORT ON OPEN"
        options={sortOptions()}
        value={settings.defaultSort}
        visible={sortOpen}
        onSelect={(v) => onChange({ defaultSort: v })}
        onClose={() => setSortOpen(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingHorizontal: S.gutter, paddingBottom: 48, paddingTop: 6 },
  title: { color: C.text, fontFamily: MONO, fontSize: T.title, letterSpacing: 3 },

  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
  },
  fieldLabel: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.8 },

  input: {
    marginTop: 10,
    padding: 12,
    backgroundColor: C.surface,
    borderWidth: S.hairline,
    borderColor: C.line,
    borderRadius: S.radius,
    color: C.acid,
    fontFamily: MONO,
    fontSize: T.micro,
    minHeight: 68,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  feedback: { marginTop: 12, marginHorizontal: -S.gutter },
  hint: { color: C.faint, fontSize: T.micro, lineHeight: T.micro + 6, marginTop: 12 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
  },
  toggleText: { flex: 1, paddingRight: 14 },
  toggleLabel: { color: C.text, fontSize: T.body },
  toggleHint: { color: C.faint, fontSize: T.micro, marginTop: 4, lineHeight: T.micro + 5 },

  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
  },
  factKey: { color: C.faint, fontFamily: MONO, fontSize: T.micro, letterSpacing: 0.8 },
  factValue: { color: C.dim, fontFamily: MONO, fontSize: T.micro, flexShrink: 1, textAlign: 'right' },

  footnote: {
    color: C.faint,
    fontSize: T.micro,
    lineHeight: T.micro + 6,
    marginTop: 28,
    borderTopWidth: S.hairline,
    borderTopColor: C.lineSoft,
    paddingTop: 14,
  },
});

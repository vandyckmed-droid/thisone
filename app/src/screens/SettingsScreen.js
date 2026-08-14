import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Chip, SectionTitle } from '../components/UI';
import { SORTS } from '../data';
import { DEFAULT_SOURCE } from '../storage';
import { C, MONO, S, fmtWhen } from '../theme';

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
        trackColor={{ false: C.line, true: C.acidDim }}
        thumbColor={value ? C.acid : C.faint}
        ios_backgroundColor={C.line}
      />
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
}) {
  const [draftUrl, setDraftUrl] = useState(settings.sourceUrl);

  const commitUrl = () => {
    const url = draftUrl.trim();
    if (!url) {
      setDraftUrl(settings.sourceUrl);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('Invalid URL', 'The snapshot URL must start with http:// or https://');
      setDraftUrl(settings.sourceUrl);
      return;
    }
    if (url !== settings.sourceUrl) {
      onChange({ sourceUrl: url });
      onRefresh();
    }
  };

  const confirm = (title, message, action) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: action },
    ]);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Text style={styles.title}>SETTINGS</Text>

      <SectionTitle>DATA SOURCE</SectionTitle>
      <TextInput
        value={draftUrl}
        onChangeText={setDraftUrl}
        onBlur={commitUrl}
        onSubmitEditing={commitUrl}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        placeholder={DEFAULT_SOURCE}
        placeholderTextColor={C.faint}
        style={styles.input}
      />
      <View style={styles.inlineActions}>
        <Chip
          compact
          label="RESET URL"
          onPress={() => {
            setDraftUrl(DEFAULT_SOURCE);
            onChange({ sourceUrl: DEFAULT_SOURCE });
            onRefresh();
          }}
        />
        <Chip compact label="REFRESH NOW" onPress={onRefresh} />
      </View>
      <Text style={styles.hint}>
        Point this at any raw snapshot.json — a fork, a branch, or a local server while you are
        testing the pipeline.
      </Text>

      <SectionTitle>DISPLAY</SectionTitle>
      <Text style={styles.fieldLabel}>DEFAULT SORT ON OPEN</Text>
      <View style={styles.chipWrap}>
        {SORTS.map((s) => (
          <Chip
            key={s.key}
            compact
            label={s.short}
            active={settings.defaultSort === s.key}
            onPress={() => onChange({ defaultSort: s.key })}
          />
        ))}
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
        label="Refresh on open"
        hint="Otherwise the cached snapshot is used until you pull to refresh"
        value={settings.refreshOnOpen}
        onChange={(v) => onChange({ refreshOnOpen: v })}
      />

      <SectionTitle>SNAPSHOT</SectionTitle>
      <View style={styles.factRow}><Text style={styles.factKey}>DATA DATE</Text><Text style={styles.factValue}>{snapshot?.dataDate || '—'}</Text></View>
      <View style={styles.factRow}><Text style={styles.factKey}>BUILT</Text><Text style={styles.factValue}>{snapshot?.generatedAt?.replace('T', ' ').replace('+00:00', ' UTC') || '—'}</Text></View>
      <View style={styles.factRow}><Text style={styles.factKey}>UNIVERSE</Text><Text style={styles.factValue}>{snapshot?.universeSize ?? '—'} tickers</Text></View>
      <View style={styles.factRow}><Text style={styles.factKey}>SESSIONS</Text><Text style={styles.factValue}>{snapshot?.sessions ?? '—'}</Text></View>
      <View style={styles.factRow}><Text style={styles.factKey}>FETCHED</Text><Text style={styles.factValue}>{fmtWhen(lastFetched)}</Text></View>
      <View style={styles.factRow}><Text style={styles.factKey}>SOURCE</Text><Text style={styles.factValue}>{snapshot?.source || '—'}</Text></View>

      <SectionTitle>STORAGE</SectionTitle>
      <Text style={styles.hint}>
        The watchlist, these settings and the last snapshot live on this phone only. There is no
        account and no server holding any of it.
      </Text>
      <View style={styles.inlineActions}>
        <Pressable
          style={styles.danger}
          onPress={() =>
            confirm('Clear watchlist', `Remove all ${watchlistCount} tracked tickers?`, onClearWatchlist)
          }
        >
          <Text style={styles.dangerText}>CLEAR WATCHLIST ({watchlistCount})</Text>
        </Pressable>
      </View>
      <View style={styles.inlineActions}>
        <Pressable
          style={styles.danger}
          onPress={() =>
            confirm('Reset everything', 'Clear the watchlist, settings and cached snapshot?', onResetAll)
          }
        >
          <Text style={styles.dangerText}>RESET ALL DATA</Text>
        </Pressable>
      </View>

      <Text style={styles.footnote}>
        Prices are dividend-adjusted daily closes from Financial Modeling Prep, refreshed after the
        US close. For information only — not investment advice.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingHorizontal: S.gutter, paddingBottom: 44, paddingTop: 6 },
  title: { color: C.text, fontFamily: MONO, fontSize: 19, letterSpacing: 3 },
  input: {
    marginTop: 8,
    padding: 11,
    backgroundColor: C.surface,
    borderWidth: S.hairline,
    borderColor: C.line,
    borderRadius: S.radius,
    color: C.acid,
    fontFamily: MONO,
    fontSize: 10,
    minHeight: 62,
  },
  inlineActions: { flexDirection: 'row', marginTop: 10, flexWrap: 'wrap' },
  hint: { color: C.faint, fontSize: 10, lineHeight: 16, marginTop: 10 },
  fieldLabel: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1, marginTop: 12, marginBottom: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
  },
  toggleText: { flex: 1, paddingRight: 14 },
  toggleLabel: { color: C.text, fontSize: 13 },
  toggleHint: { color: C.faint, fontSize: 10, marginTop: 3, lineHeight: 15 },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: S.hairline,
    borderBottomColor: C.lineSoft,
  },
  factKey: { color: C.faint, fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  factValue: { color: C.dim, fontFamily: MONO, fontSize: 10, flexShrink: 1, textAlign: 'right' },
  danger: {
    borderWidth: S.hairline,
    borderColor: C.down,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerText: { color: C.down, fontFamily: MONO, fontSize: 10, letterSpacing: 1 },
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

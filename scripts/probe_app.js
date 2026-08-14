// A deliberately trivial Snack, for finding out which SDK the installed Expo Go
// can actually run.
//
// Nothing reachable from a terminal reports the SDK version of the Expo Go on
// someone's phone, and publishing against the wrong one is the failure that has
// cost the most time on this project. So: publish this at two SDKs, tap both,
// and whichever renders names itself on screen.
//
//   python3 scripts/publish_snack.py --file scripts/probe_app.js \
//     --no-deps --sdk 54.0.0 --name "Probe 54"
//
// No imports beyond react-native, so a failure here cannot be a dependency.
import React from 'react';
import { SafeAreaView, StyleSheet, Text } from 'react-native';

// Replaced at publish time by publish_snack.py --sdk.
const SDK = 'SDK __SDK__';

export default function App() {
  return (
    <SafeAreaView style={styles.app}>
      <Text style={styles.big}>{SDK}</Text>
      <Text style={styles.small}>THIS EXPO GO RUNS IT</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#0A0B0C', alignItems: 'center', justifyContent: 'center' },
  big: { color: '#C8FF00', fontSize: 56, fontWeight: '700' },
  small: { color: '#F0F1F2', fontSize: 15, letterSpacing: 2, marginTop: 14 },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SOURCE } from './source';

// Everything the app remembers lives here. No account, no server: the phone
// owns the watchlist and settings, and the snapshot cache is just a copy of
// the last file we managed to pull from GitHub.
const K = {
  watchlist: '@top100/watchlist',
  settings: '@top100/settings',
  snapshot: '@top100/snapshot',
};

export { DEFAULT_SOURCE };

export const DEFAULT_SETTINGS = {
  sourceUrl: DEFAULT_SOURCE,
  defaultSort: 'marketCap',
  showLogos: true,
  showSparklines: true,
  refreshOnOpen: true,
  haptics: true,
  // Flipped the first time a chart is scrubbed, so the hint appears once.
  hasScrubbed: false,
};

const read = async (key, fallback) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
};

const write = async (key, value) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
};

export const loadWatchlist = () => read(K.watchlist, []);
export const saveWatchlist = (symbols) => write(K.watchlist, symbols);

// Merged against defaults so a settings key added in a later version does not
// come back undefined for anyone who already has stored settings.
export const loadSettings = async () => ({
  ...DEFAULT_SETTINGS,
  ...(await read(K.settings, {})),
});
export const saveSettings = (settings) => write(K.settings, settings);

export const loadCachedSnapshot = () => read(K.snapshot, null);
export const saveCachedSnapshot = (snapshot) => write(K.snapshot, snapshot);

export const clearAll = async () => {
  try {
    await AsyncStorage.multiRemove([K.watchlist, K.settings, K.snapshot]);
    return true;
  } catch (err) {
    return false;
  }
};

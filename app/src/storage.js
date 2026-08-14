import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SOURCE } from './source';

// Everything the app remembers lives here. No account, no server: the phone
// owns the watchlist and settings, and the snapshot cache is just a copy of
// the last file we managed to pull from GitHub.
const K = {
  watchlist: '@top100/watchlist',
  settings: '@top100/settings',
  index: '@top100/index',
  // Each universe caches under its own key, so switching between them is
  // instant after the first visit and every one of them survives going offline.
  universe: (key) => `@top100/universe/${key}`,
};

export { DEFAULT_SOURCE };

export const DEFAULT_SETTINGS = {
  sourceUrl: DEFAULT_SOURCE,
  universeKey: 'all',
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

export const loadCachedIndex = () => read(K.index, null);
export const saveCachedIndex = (index) => write(K.index, index);

export const loadCachedUniverse = (key) => read(K.universe(key), null);
export const saveCachedUniverse = (key, table) => write(K.universe(key), table);

export const clearAll = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('@top100/')));
    return true;
  } catch (err) {
    return false;
  }
};

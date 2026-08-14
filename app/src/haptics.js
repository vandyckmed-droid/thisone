import * as Haptics from 'expo-haptics';

// The toggle lives in settings, but threading it through every button would
// mean passing it to components that otherwise need nothing. A module flag,
// refreshed whenever settings change, keeps call sites down to one word.
let enabled = true;

export const setHapticsEnabled = (value) => {
  enabled = !!value;
};

// Haptics are absent on web and on some devices, and a rejected promise here
// would be an unhandled rejection over a button press. Never let it surface.
const fire = (fn) => {
  if (!enabled) return;
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (err) {
    /* no haptic engine; nothing to do */
  }
};

/** Discrete choice: a chip, a range, a tab. */
export const tick = () => fire(() => Haptics.selectionAsync());

/** Opening something. */
export const tap = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** Watchlist add — the one action worth a firmer confirmation. */
export const confirm = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** Watchlist remove: same weight as adding, but not phrased as success. */
export const undo = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

// Where the app looks for snapshot.json, kept in its own module so a preview
// build can point at a branch without touching anything else. Changeable at
// runtime under CONFIG -> DATA SOURCE; this is only the first-run default.
export const DEFAULT_SOURCE =
  'https://raw.githubusercontent.com/vandyckmed-droid/thisone/main/data/snapshot.json';

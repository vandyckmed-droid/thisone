// Where the app looks for its data. It is a directory now rather than a single
// file: `index.json` lists the universes, and each entry names its own file.
// Changeable at runtime under SETTINGS; this is only the first-run default.
export const DEFAULT_SOURCE =
  'https://raw.githubusercontent.com/vandyckmed-droid/thisone/main/data/';

/** Tolerate a pasted file URL or a missing slash. */
export const normaliseBase = (url) => {
  const trimmed = (url || '').trim();
  const withoutFile = trimmed.replace(/(index|snapshot)\.json$/i, '');
  return withoutFile.endsWith('/') ? withoutFile : `${withoutFile}/`;
};

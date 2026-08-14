import { Platform } from 'react-native';

// Dark, minimal, industrial. One acid accent doing all the signalling work;
// everything else is graphite so the green never competes with itself.
export const C = {
  bg: '#0A0B0C',
  surface: '#141518',
  surfaceHi: '#1C1E22',
  line: '#2A2D32',
  lineSoft: '#1F2226',

  // Secondary text was too dim to carry the weight it was being given. `dim`
  // clears 7:1 on the page background and `faint` clears 4.5:1, so a label at
  // the smallest size in use is still comfortably readable rather than merely
  // present.
  text: '#F0F1F2',
  dim: '#B6BCC4',
  faint: '#8A9098',

  acid: '#C8FF00',
  acidDim: '#A6D400',
  acidGlow: 'rgba(200,255,0,0.10)',

  up: '#C8FF00',
  down: '#FF6B4F',
  flat: '#8A9098',
};

// Tabular figures matter more than typeface here: columns of prices only read
// as a table when the digits line up.
export const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// One type scale, with a floor. Nothing renders below `micro`, and `micro` is
// 11 rather than the 9 this used to reach for -- at arm's length on a phone,
// 9pt mono in graphite is decoration, not information.
export const T = {
  micro: 11,
  small: 12,
  body: 13,
  large: 15,
  title: 20,
  display: 34,
};

export const S = {
  gutter: 16,
  radius: 10,
  hairline: 1,
  // Apple's minimum comfortable target. Visible pills stay small; the touchable
  // area around them does not.
  tap: 44,
};

/** hitSlop that grows a control of `size` out to a full tap target. */
export const slop = (size) => {
  const pad = Math.max(0, Math.round((S.tap - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
};

export const tone = (value) => {
  if (value === null || value === undefined || value === 0) return C.flat;
  return value > 0 ? C.up : C.down;
};

// ---------------------------------------------------------------- formatting

export const fmtCap = (n) => {
  if (!n && n !== 0) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return `${n}`;
};

export const fmtPrice = (n) => {
  if (n === null || n === undefined) return '—';
  // Cents stay until they stop carrying information: LLY reads 1,209.85 rather
  // than a rounded 1,210, while a five-figure share price drops them.
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const fmtPct = (n, digits = 2) => {
  if (n === null || n === undefined) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

/** For magnitudes like volatility, where a leading + would read as a gain. */
export const fmtMagnitude = (n, digits = 1) =>
  n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`;

export const fmtNum = (n, digits = 2) =>
  n === null || n === undefined ? '—' : n.toFixed(digits);

export const fmtRank = (n) => (n === null || n === undefined ? '—' : `#${n}`);

export const fmtWhen = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** Why a metric is blank, so a bare dash never has to speak for itself. */
export const missingReason = (key) => {
  switch (key) {
    case 'momentum': return 'Needs ~13 months';
    case '2y': return 'Needs 2 years';
    case '1y': case 'riskAdjusted': case 'maxDrawdown': return 'Needs 1 year';
    case '9m': return 'Needs 9 months';
    case '6m': case '90d': return 'Needs 6 months';
    case '3m': return 'Needs 3 months';
    case 'ytd': return 'Listed this year';
    default: return 'Not enough history';
  }
};

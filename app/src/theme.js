import { Platform } from 'react-native';

// Dark, minimal, industrial. One acid accent doing all the signalling work;
// everything else is graphite so the green never competes with itself.
export const C = {
  bg: '#0A0B0C',
  surface: '#121316',
  surfaceHi: '#191B1F',
  line: '#232629',
  lineSoft: '#1A1D20',

  text: '#ECEDEE',
  dim: '#9BA1A8',
  faint: '#61666D',

  acid: '#C8FF00',
  acidDim: '#8FB800',
  acidGlow: 'rgba(200,255,0,0.10)',

  up: '#C8FF00',
  down: '#FF5334',
  flat: '#9BA1A8',
};

// Tabular figures matter more than typeface here: columns of prices only read
// as a table when the digits line up.
export const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const S = {
  gutter: 16,
  radius: 10,
  hairline: 1,
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

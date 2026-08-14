import {
  loadCachedIndex, loadCachedUniverse, saveCachedIndex, saveCachedUniverse,
} from './storage';
import { normaliseBase } from './source';

// Columns the Ranks screen can sort by. `value` pulls the number out of a
// ticker, `better` says which end of the scale wins, and `rank` names the
// precomputed rank the pipeline already worked out for us.
export const SORTS = [
  { key: 'marketCap', label: 'MKT CAP', short: 'CAP', rank: 'marketCap', better: 'high', value: (t) => t.marketCap, format: 'cap' },
  { key: 'change', label: '1 DAY', short: '1D', rank: 'change', better: 'high', value: (t) => t.changePct, format: 'pct' },
  { key: 'r1w', label: '1 WEEK', short: '1W', rank: 'return_1w', better: 'high', value: (t) => t.returns['1w'], format: 'pct' },
  { key: 'r1m', label: '1 MONTH', short: '1M', rank: 'return_1m', better: 'high', value: (t) => t.returns['1m'], format: 'pct' },
  { key: 'r3m', label: '3 MONTH', short: '3M', rank: 'return_3m', better: 'high', value: (t) => t.returns['3m'], format: 'pct' },
  { key: 'r6m', label: '6 MONTH', short: '6M', rank: 'return_6m', better: 'high', value: (t) => t.returns['6m'], format: 'pct' },
  { key: 'r1y', label: '1 YEAR', short: '1Y', rank: 'return_1y', better: 'high', value: (t) => t.returns['1y'], format: 'pct' },
  { key: 'momentum', label: 'MOMENTUM', short: 'MOM', rank: 'momentum', better: 'high', value: (t) => t.momentumScore, format: 'score' },
  { key: 'risk', label: 'RISK-ADJ', short: 'R/R', rank: 'riskAdjusted', better: 'high', value: (t) => t.riskAdjusted1y, format: 'ratio' },
  { key: 'vol', label: 'VOLATILITY', short: 'VOL', rank: 'volatility', better: 'low', value: (t) => t.volatility['1y'], format: 'pct0' },
];

export const sortByKey = (key) => SORTS.find((s) => s.key === key) || SORTS[0];

export const RANGES = [
  { key: '1M', sessions: 21 },
  { key: '3M', sessions: 63 },
  { key: '6M', sessions: 126 },
  { key: '9M', sessions: 189 },
  { key: '1Y', sessions: 252 },
  { key: '2Y', sessions: 504 },
  { key: 'MAX', sessions: Infinity },
];

// The buster exists to step past a stale CDN entry once GitHub's five-minute
// window rolls over — not to make every request unique, which is what a raw
// `t=${Date.now()}` did. That defeated the CDN *and* the phone's own HTTP
// cache, so every single launch re-downloaded a megabyte of history it had
// fetched minutes earlier. Busting once per window keeps the same worst-case
// freshness while a relaunch inside it paints from local cache in milliseconds.
const BUST_WINDOW_MS = 5 * 60 * 1000;
const bust = (url) =>
  `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / BUST_WINDOW_MS)}`;

async function getJson(url) {
  const res = await fetch(bust(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * The list of universes on offer. Falls back to the cached copy, and failing
 * that to a single entry, so the app is never left with nothing to show.
 */
export async function fetchIndex(sourceUrl) {
  const base = normaliseBase(sourceUrl);
  try {
    const index = await getJson(`${base}index.json`);
    if (!index || !Array.isArray(index.universes) || !index.universes.length) {
      throw new Error('Index is empty or malformed');
    }
    await saveCachedIndex(index);
    return { index, fromCache: false, error: null };
  } catch (err) {
    const cached = await loadCachedIndex();
    if (cached) return { index: cached, fromCache: true, error: err.message };
    return {
      index: { universes: [{ key: 'all', title: 'All', scope: 'all', file: 'snapshot.json' }] },
      fromCache: false,
      error: err.message,
    };
  }
}

/**
 * One universe's table, falling back to its own cached copy so a sector you
 * have already opened still works on a plane.
 */
export async function fetchUniverse(sourceUrl, universe) {
  const base = normaliseBase(sourceUrl);
  const key = universe.key;
  try {
    const fetched = await getJson(`${base}${universe.file}`);
    if (!fetched || !Array.isArray(fetched.tickers) || !fetched.tickers.length) {
      throw new Error('Table is empty or malformed');
    }
    // The index already names and sizes every universe, so a hand-written table
    // that leaves those out still displays rather than rendering "undefined".
    const table = {
      title: universe.title || universe.key,
      scope: universe.scope || 'all',
      ...fetched,
      universeSize: fetched.universeSize || fetched.tickers.length,
    };
    await saveCachedUniverse(key, table);
    return { table, fromCache: false, error: null, fetchedAt: Date.now() };
  } catch (err) {
    const cached = await loadCachedUniverse(key);
    if (cached) return { table: cached, fromCache: true, error: err.message, fetchedAt: null };
    throw err;
  }
}

/**
 * How a table names itself in a heading: "TOP 300", "HEALTHCARE 100".
 *
 * Ranks are computed inside each file, so every rank on screen needs the
 * universe attached to it — #12 means something completely different in the
 * Top 300 than it does among a hundred healthcare names.
 */
export function universeLabel(table) {
  if (!table) return '';
  return table.scope === 'sector'
    ? `${table.title.toUpperCase()} ${table.universeSize}`
    : `TOP ${table.universeSize}`;
}

/** One line of prose describing what the open table contains. */
export function describeUniverse(table) {
  if (!table) return '';
  return table.scope === 'sector'
    ? `${table.universeSize} LARGEST ${table.title.toUpperCase()} COMPANIES`
    : `${table.universeSize} LARGEST US COMPANIES`;
}

/** The index as sheet options: every universe with how many names it holds. */
export function universeOptions(index) {
  if (!index || !Array.isArray(index.universes)) return [];
  return index.universes.map((u) => ({
    value: u.key,
    label: u.title.toUpperCase(),
    count: u.size,
  }));
}

export const findUniverse = (index, key) => {
  const list = (index && index.universes) || [];
  return list.find((u) => u.key === key) || list[0] || null;
};

/** Filter by symbol/name/sector/industry, then sort, unrankable names last. */
export function arrange(tickers, { sortKey, query, sector, industry, direction = 'desc' }) {
  const sort = sortByKey(sortKey);
  const needle = (query || '').trim().toLowerCase();

  let rows = tickers;
  if (needle) {
    rows = rows.filter(
      (t) =>
        t.symbol.toLowerCase().includes(needle) ||
        t.name.toLowerCase().includes(needle)
    );
  }
  if (sector && sector !== 'All') {
    rows = rows.filter((t) => t.sector === sector);
  }
  if (industry && industry !== 'All') {
    rows = rows.filter((t) => t.industry === industry);
  }

  // "Best first" means lowest for volatility and highest for everything else;
  // the direction toggle flips whatever that happens to be.
  const bestIsHigh = sort.better === 'high';
  const descending = direction === 'desc' ? bestIsHigh : !bestIsHigh;

  return [...rows].sort((a, b) => {
    const av = sort.value(a);
    const bv = sort.value(b);
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return a.marketCap > b.marketCap ? -1 : 1;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return descending ? bv - av : av - bv;
  });
}

/** The sort columns as sheet options, so Settings needs no chip cloud. */
export function sortOptions() {
  return SORTS.map((s) => ({ value: s.key, label: s.label }));
}

/**
 * Values of one field for the filter sheet, each with how many tickers carry
 * it.
 *
 * The count is what makes the list worth opening: it says up front that Energy
 * has three names and Technology thirty, which a row of equal-sized chips could
 * never convey.
 */
function groupOptions(tickers, field, allLabel) {
  const counts = new Map();
  for (const ticker of tickers) {
    const value = ticker[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [
    { value: 'All', label: allLabel, count: tickers.length },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ value: name, label: name.toUpperCase(), count })),
  ];
}

export const sectorOptions = (tickers) => groupOptions(tickers, 'sector', 'ALL SECTORS');

// Inside a sector table every row shares a sector, so the useful cut one level
// down is the industry: Healthcare splits into drug manufacturers, devices,
// insurers and hospitals, which is the distinction a reader is actually after.
export const industryOptions = (tickers) => groupOptions(tickers, 'industry', 'ALL INDUSTRIES');

/**
 * Trailing slice of a ticker's chart series.
 *
 * Histories are aligned to a shared calendar and padded with nulls before a
 * ticker's first session, so a recent listing charts from its IPO rather than
 * dragging a flat line back through two years it never traded.
 */
export function seriesFor(ticker, dates, sessions) {
  const points = [];
  for (let i = 0; i < ticker.history.length; i += 1) {
    const close = ticker.history[i];
    if (close !== null && close !== undefined) {
      points.push({ date: dates[i], close });
    }
  }
  if (!Number.isFinite(sessions) || points.length <= sessions) return points;
  return points.slice(points.length - sessions);
}

/** Even sample down to at most `count` points, always keeping the last one. */
export function downsample(points, count) {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

export function changeOver(points) {
  if (points.length < 2) return null;
  const first = points[0].close;
  const last = points[points.length - 1].close;
  if (!first) return null;
  return (last / first - 1) * 100;
}

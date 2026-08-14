import { loadCachedSnapshot, saveCachedSnapshot } from './storage';

// Columns the Ranks screen can sort by. `value` pulls the number out of a
// ticker, `better` says which end of the scale wins, and `rank` names the
// precomputed rank the pipeline already worked out for us.
export const SORTS = [
  { key: 'marketCap', label: 'MKT CAP', short: 'CAP', rank: 'marketCap', better: 'high', value: (t) => t.marketCap, format: 'cap' },
  { key: 'change', label: '1 DAY', short: '1D', rank: null, better: 'high', value: (t) => t.changePct, format: 'pct' },
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

/**
 * Pull a fresh snapshot, falling back to the cached copy so the app still
 * opens on a plane. Returns the snapshot plus where it came from.
 */
export async function fetchSnapshot(sourceUrl, { allowCache = true } = {}) {
  const cached = allowCache ? await loadCachedSnapshot() : null;
  try {
    // GitHub's raw CDN caches aggressively; the cache-buster keeps a
    // post-close refresh from taking minutes to show up on the phone.
    const url = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const snapshot = await res.json();
    if (!snapshot || !Array.isArray(snapshot.tickers) || !snapshot.tickers.length) {
      throw new Error('Snapshot is empty or malformed');
    }

    await saveCachedSnapshot(snapshot);
    return { snapshot, fromCache: false, error: null, fetchedAt: Date.now() };
  } catch (err) {
    if (cached) {
      return { snapshot: cached, fromCache: true, error: err.message, fetchedAt: null };
    }
    throw err;
  }
}

/** Filter by symbol/name/sector, then sort, keeping unrankable names last. */
export function arrange(tickers, { sortKey, query, sector, direction = 'desc' }) {
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

export function sectorsOf(tickers) {
  return ['All', ...Array.from(new Set(tickers.map((t) => t.sector))).sort()];
}

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

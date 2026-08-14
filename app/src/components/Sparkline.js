import React from 'react';
import { Polyline, Svg } from './svg';
import { C } from '../theme';

/**
 * Row-sized trend line. Deliberately axis-free: at this size the shape is the
 * only readable signal, and 100 of them have to render without stutter.
 */
function Sparkline({ points, width = 56, height = 22, color = C.acid }) {
  if (!points || points.length < 2) {
    return <Svg width={width} height={height} />;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.close < min) min = p.close;
    if (p.close > max) max = p.close;
  }
  const span = max - min || 1;
  const pad = 2;
  const usable = height - pad * 2;
  const step = width / (points.length - 1);

  const coords = points
    .map((p, i) => {
      const x = i * step;
      const y = pad + usable - ((p.close - min) / span) * usable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={coords}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default React.memo(Sparkline);

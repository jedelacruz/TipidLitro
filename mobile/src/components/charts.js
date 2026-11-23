// Lightweight SVG charts (react-native-svg) in the app's colors. Touch and drag on a line or bar
// chart to see the exact values, like the web tooltips.
import { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../lib/theme';
import { Row, Txt } from './ui';

const PAD = { l: 44, r: 10, t: 10, b: 24 };

function niceRange(values, includeZero) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return [0, 1];
  let lo = Math.min(...v); let hi = Math.max(...v);
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [includeZero && lo === 0 ? 0 : lo - pad, hi + pad];
}
const defaultFmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function useWidth() {
  const [w, setW] = useState(0);
  return [w, (e) => setW(e.nativeEvent.layout.width)];
}

function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <Row wrap gap={12} style={{ marginTop: 6 }}>
      {series.map((s) => <Row key={s.label} gap={5}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.color }} /><Txt variant="tiny" tone="muted">{s.label}</Txt></Row>)}
    </Row>
  );
}

function Tooltip({ x, width, title, lines }) {
  const t = useTheme();
  const left = Math.min(Math.max(0, x - 80), Math.max(0, width - 160));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left, width: 160, backgroundColor: t.text, borderRadius: 8, padding: 8, opacity: 0.95 }}>
      <Text style={{ color: t.bg, fontWeight: '700', fontSize: 11 }}>{title}</Text>
      {lines.map((l) => <Text key={l.label} style={{ color: t.bg, fontSize: 11 }}>{l.label}: {l.value}</Text>)}
    </View>
  );
}

function useScrub(count, plotW) {
  const [idx, setIdx] = useState(null);
  const timer = useRef(null);
  const pick = (x) => {
    const step = count > 1 ? plotW / (count - 1) : plotW;
    const i = Math.round((x - PAD.l) / (count > 1 ? step : 1));
    setIdx(Math.max(0, Math.min(count - 1, i)));
  };
  return {
    idx,
    handlers: {
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      onResponderTerminationRequest: () => true,
      onResponderGrant: (e) => { clearTimeout(timer.current); pick(e.nativeEvent.locationX); },
      onResponderMove: (e) => pick(e.nativeEvent.locationX),
      onResponderRelease: () => { timer.current = setTimeout(() => setIdx(null), 2500); },
    },
  };
}

/** series: [{ label, color, data: (number|null)[], fill?: bool, dashed?: bool }] */
export function LineChart({ labels, series, height = 200, yFormat = defaultFmt, valueFormat, title }) {
  const t = useTheme();
  const [w, onLayout] = useWidth();
  const plotW = Math.max(1, w - PAD.l - PAD.r); const plotH = height - PAD.t - PAD.b;
  const [lo, hi] = useMemo(() => niceRange(series.flatMap((s) => s.data), false), [series]);
  const n = labels.length;
  const x = (i) => PAD.l + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v) => PAD.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const { idx, handlers } = useScrub(n, plotW);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const xTickEvery = Math.max(1, Math.ceil(n / 5));
  const fmtV = valueFormat || yFormat;
  return (
    <View>
      {title ? <Txt variant="small" tone="muted" bold style={{ marginBottom: 4 }}>{title}</Txt> : null}
      <View onLayout={onLayout} style={{ height }} {...handlers}>
        {w > 0 && n > 0 ? (
          <Svg width={w} height={height}>
            {ticks.map((v, k) => (
              <G key={k}>
                <Line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} />
                <SvgText x={PAD.l - 6} y={y(v) + 4} fontSize={10} fill={t.faint} textAnchor="end">{yFormat(v)}</SvgText>
              </G>
            ))}
            {labels.map((l, i) => (i % xTickEvery === 0 || i === n - 1 ? <SvgText key={i} x={x(i)} y={height - 6} fontSize={10} fill={t.faint} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{l}</SvgText> : null))}
            {series.map((s) => {
              const pts = s.data.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
              if (!pts.length) return null;
              const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
              return (
                <G key={s.label}>
                  {s.fill ? <Path d={`${d} L${pts[pts.length - 1][0]},${PAD.t + plotH} L${pts[0][0]},${PAD.t + plotH} Z`} fill={s.color} fillOpacity={0.14} /> : null}
                  <Path d={d} stroke={s.color} strokeWidth={2} fill="none" strokeDasharray={s.dashed ? '5,4' : undefined} />
                  {pts.length <= 40 ? pts.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={2} fill={s.color} />) : null}
                </G>
              );
            })}
            {idx != null ? <Line x1={x(idx)} x2={x(idx)} y1={PAD.t} y2={PAD.t + plotH} stroke={t.muted} strokeDasharray="3,3" /> : null}
          </Svg>
        ) : null}
        {idx != null && w > 0 ? <Tooltip x={x(idx)} width={w} title={labels[idx]} lines={series.map((s) => ({ label: s.label, value: s.data[idx] == null ? '—' : fmtV(s.data[idx]) }))} /> : null}
      </View>
      <Legend series={series} />
    </View>
  );
}

/**
 * Vertical bars, grouped or stacked; negative values go below the zero line.
 * series: [{ label, color, data, type?: 'line' }] — 'line' series are drawn on top.
 * barColors: optional per-bar colors for a single series.
 */
export function BarChart({ labels, series, height = 200, stacked, yFormat = defaultFmt, valueFormat, barColors }) {
  const t = useTheme();
  const [w, onLayout] = useWidth();
  const bars = series.filter((s) => s.type !== 'line'); const lines = series.filter((s) => s.type === 'line');
  const plotW = Math.max(1, w - PAD.l - PAD.r); const plotH = height - PAD.t - PAD.b;
  const n = labels.length;
  const values = stacked
    ? labels.flatMap((_, i) => [bars.reduce((a, s) => a + Math.max(0, s.data[i] || 0), 0), bars.reduce((a, s) => a + Math.min(0, s.data[i] || 0), 0)])
    : bars.flatMap((s) => s.data);
  const [lo, hi] = niceRange([...values, ...lines.flatMap((s) => s.data)], true);
  const y = (v) => PAD.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / Math.max(n, 1);
  const groupW = slot * 0.72;
  const barW = stacked ? groupW : groupW / Math.max(bars.length, 1);
  const cx = (i) => PAD.l + slot * i + slot / 2;
  const scrub = useScrub(n, plotW - slot);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const xTickEvery = Math.max(1, Math.ceil(n / 6));
  const fmtV = valueFormat || yFormat;
  const idx = scrub.idx;
  return (
    <View>
      <View onLayout={onLayout} style={{ height }} {...scrub.handlers}>
        {w > 0 && n > 0 ? (
          <Svg width={w} height={height}>
            {ticks.map((v, k) => (
              <G key={k}>
                <Line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} />
                <SvgText x={PAD.l - 6} y={y(v) + 4} fontSize={10} fill={t.faint} textAnchor="end">{yFormat(v)}</SvgText>
              </G>
            ))}
            <Line x1={PAD.l} x2={w - PAD.r} y1={y(0)} y2={y(0)} stroke={t.muted} strokeWidth={1} />
            {labels.map((l, i) => {
              let pos = 0; let neg = 0;
              return (
                <G key={i}>
                  {bars.map((s, k) => {
                    const v = s.data[i]; if (v == null || v === 0) return null;
                    let top; let bottom;
                    if (stacked) { if (v >= 0) { bottom = pos; pos += v; top = pos; } else { top = neg; neg += v; bottom = neg; } }
                    else { top = Math.max(v, 0); bottom = Math.min(v, 0); }
                    const bx = stacked ? cx(i) - barW / 2 : cx(i) - groupW / 2 + k * barW;
                    return <Rect key={k} x={bx} y={y(top)} width={Math.max(1, barW - 1)} height={Math.max(1, y(bottom) - y(top))} rx={2} fill={barColors?.[i] || s.color} opacity={idx == null || idx === i ? 1 : 0.55} />;
                  })}
                  {i % xTickEvery === 0 ? <SvgText x={cx(i)} y={height - 6} fontSize={10} fill={t.faint} textAnchor="middle">{l}</SvgText> : null}
                </G>
              );
            })}
            {lines.map((s) => {
              const pts = s.data.map((v, i) => (v == null ? null : [cx(i), y(v)])).filter(Boolean);
              if (!pts.length) return null;
              return <G key={s.label}><Path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')} stroke={s.color} strokeWidth={2} fill="none" strokeDasharray="5,4" />{pts.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill={s.color} />)}</G>;
            })}
          </Svg>
        ) : null}
        {idx != null && w > 0 ? <Tooltip x={cx(idx)} width={w} title={labels[idx]} lines={series.map((s) => ({ label: s.label, value: s.data[idx] == null ? '—' : fmtV(s.data[idx]) }))} /> : null}
      </View>
      <Legend series={series} />
    </View>
  );
}

/** Horizontal bars (no SVG needed). items: [{ label, value, color?, display? }] */
export function HBarChart({ items, valueFormat = (v) => String(v), color }) {
  const t = useTheme();
  const max = Math.max(...items.map((i) => Math.abs(i.value || 0)), 1);
  return (
    <View style={{ gap: 8 }}>
      {items.map((it) => (
        <View key={it.label} style={{ gap: 3 }}>
          <Row between><Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>{it.label}</Txt><Txt variant="small" bold>{it.display ?? valueFormat(it.value)}</Txt></Row>
          <View style={{ height: 8, backgroundColor: t.surface2, borderRadius: 99, overflow: 'hidden' }}>
            <View style={{ width: `${(Math.abs(it.value || 0) / max) * 100}%`, height: '100%', backgroundColor: it.color || color || t.brand, borderRadius: 99 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Donut with legend. data: [{ label, value, color }] */
export function Donut({ data, size = 150 }) {
  const t = useTheme();
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = size / 2; const inner = r * 0.6;
  const starts = data.map((_, i) => -Math.PI / 2 + (data.slice(0, i).reduce((a, d) => a + d.value, 0) / total) * Math.PI * 2);
  const arcs = data.map((d, i) => {
    const a0 = starts[i]; const a1 = a0 + (d.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rad) => [r + rad * Math.cos(a), r + rad * Math.sin(a)];
    const [x0, y0] = p(a0, r); const [x1, y1] = p(a1 - 0.0001, r); const [x2, y2] = p(a1 - 0.0001, inner); const [x3, y3] = p(a0, inner);
    return { ...d, d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z` };
  });
  return (
    <Row gap={16} align="center">
      <Svg width={size} height={size}>{arcs.map((a) => <Path key={a.label} d={a.d} fill={a.color} />)}<SvgText x={r} y={r + 5} textAnchor="middle" fontSize={15} fontWeight="700" fill={t.text}>{total}</SvgText></Svg>
      <View style={{ flex: 1, gap: 5 }}>
        {data.map((d) => <Row key={d.label} gap={6}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: d.color }} /><Txt variant="small" style={{ flex: 1 }}>{d.label}</Txt><Txt variant="small" bold>{d.value}</Txt></Row>)}
      </View>
    </Row>
  );
}

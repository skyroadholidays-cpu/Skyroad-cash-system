// Monthly cash in vs cash out – server-rendered SVG, no chart library needed.
import { inr, inrShort } from '@/lib/money';
import { fmtMonth } from '@/lib/dates';

export function MonthlyChart({ data }: { data: { month: string; inflow: string; outflow: string; net: string }[] }) {
  const W = 720, H = 240, padL = 56, padB = 28, padT = 12;
  const max = Math.max(1, ...data.flatMap((d) => [Number(d.inflow), Number(d.outflow)]));
  const nice = niceCeil(max);
  const innerW = W - padL - 8, innerH = H - padT - padB;
  const step = innerW / Math.max(data.length, 1);
  const bw = Math.min(16, step / 3);
  const y = (v: number) => padT + innerH - (v / nice) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * nice);
  const empty = data.every((d) => Number(d.inflow) === 0 && Number(d.outflow) === 0);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly cash in and cash out for the last 12 months">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="axis">{inrShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + step * i + step / 2;
          const vin = Number(d.inflow), vout = Number(d.outflow);
          return (
            <g key={d.month}>
              <rect x={cx - bw - 1} y={y(vin)} width={bw} height={Math.max(0, y(0) - y(vin))} rx="3" className="bar-in">
                <title>{`${fmtMonth(d.month)} · Cash in ${inr(d.inflow)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(vout)} width={bw} height={Math.max(0, y(0) - y(vout))} rx="3" className="bar-out">
                <title>{`${fmtMonth(d.month)} · Cash out ${inr(d.outflow)}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" className="axis">{fmtMonth(d.month).slice(0, 3)}</text>
            </g>
          );
        })}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="axis">No cash movements yet</text>}
      </svg>
      <figcaption className="legend">
        <span><i className="dot dot-in" /> Cash in</span>
        <span><i className="dot dot-out" /> Cash out</span>
      </figcaption>
    </figure>
  );
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

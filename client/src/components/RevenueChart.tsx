import { useState } from 'react';
import { naira } from '../lib/format';

/** Single-series monthly revenue bars with a per-bar hover tooltip. */
export function RevenueChart({ data }: { data: { month: string; totalKobo: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.totalKobo));
  const label = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });

  return (
    <div>
      <div className="relative flex h-48 items-end gap-3 border-b border-slate-200 pt-6">
        {data.map((d, i) => {
          const h = (d.totalKobo / max) * 100;
          return (
            <div
              key={d.month}
              className="relative flex h-full flex-1 cursor-default items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {hover === i && (
                <div className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow">
                  <p className="text-slate-300">{new Date(`${d.month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
                  <p className="font-semibold">{naira(d.totalKobo)}</p>
                </div>
              )}
              <div
                className={`w-full max-w-12 rounded-t transition-colors ${hover === i ? 'bg-brand-700' : 'bg-brand-500'}`}
                style={{ height: `${Math.max(h, d.totalKobo ? 2 : 0)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3">
        {data.map((d, i) => (
          <p key={d.month} className={`flex-1 text-center text-xs ${i === data.length - 1 ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
            {label(d.month)}
          </p>
        ))}
      </div>
    </div>
  );
}

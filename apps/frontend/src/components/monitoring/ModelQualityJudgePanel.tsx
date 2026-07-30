'use client';

import { Scale } from 'lucide-react';
import {
  judgeModelQuality,
  verdictStyles,
  type ModelQualityInput,
} from '@/lib/model-quality-judge';

type Props = {
  input: ModelQualityInput;
};

export default function ModelQualityJudgePanel({ input }: Props) {
  const result = judgeModelQuality(input);
  const style = verdictStyles(result.verdict);

  return (
    <div className={`rounded-lg border bg-slate-950/40 p-3 space-y-2 ${style.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Scale className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Quality judge
            </p>
            <p className="text-[11px] text-slate-300 leading-snug mt-0.5">{result.summary}</p>
          </div>
        </div>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${style.badge}`}
        >
          {style.label}
        </span>
      </div>

      <ul className="space-y-1">
        {result.reasons.map((r) => (
          <li key={r} className="text-[10px] text-slate-500 leading-relaxed pl-3 relative">
            <span className="absolute left-0 text-slate-600">·</span>
            {r}
          </li>
        ))}
      </ul>

      {result.nextActions.length > 0 && (
        <div className="pt-1 border-t border-slate-800/80">
          <p className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">
            Next
          </p>
          <ul className="space-y-1">
            {result.nextActions.map((a) => (
              <li key={a} className="text-[10px] text-slate-400 leading-relaxed">
                → {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[9px] text-slate-600">
        Heuristic operator assist — bukan jaminan PnL. Prec BUY → Eval vs EMA → paper/shadow.
      </p>
    </div>
  );
}

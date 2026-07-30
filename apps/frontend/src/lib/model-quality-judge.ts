/**
 * Operator-facing heuristic for ML model quality.
 * Not live PnL — mirrors PHASE_STATUS playbook (Prec BUY → Eval vs EMA → paper/shadow).
 */

export type ModelQualityVerdict =
  | 'INCOMPLETE'
  | 'RETRAIN'
  | 'PAPER_ONLY'
  | 'PROMOTE_CANDIDATE';

export type ModelQualityInput = {
  precisionBuy: number | null;
  recallBuy: number | null;
  f1Buy: number | null;
  accuracy: number | null;
  nTrain: number | null;
  nVal: number | null;
  hasCompatibleProfile: boolean;
  pairBlockBuy: boolean;
  pairMessage?: string | null;
  eval?: {
    mlTrades: number;
    mlWinRate: number | null;
    mlAvgReturn: number | null;
    emaTrades: number;
    emaWinRate: number | null;
    emaAvgReturn: number | null;
  } | null;
};

export type ModelQualityResult = {
  verdict: ModelQualityVerdict;
  summary: string;
  reasons: string[];
  nextActions: string[];
};

const PREC_WEAK = 0.5;
const PREC_OK = 0.55;
const PREC_STRONG = 0.65;
const MIN_EVAL_TRADES = 5;

function pctLabel(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  return `${(v * 100).toFixed(1)}%`;
}

export function judgeModelQuality(input: ModelQualityInput): ModelQualityResult {
  const reasons: string[] = [];
  const nextActions: string[] = [];
  const prec = input.precisionBuy;

  if (prec == null) {
    return {
      verdict: 'INCOMPLETE',
      summary: 'Metrics belum lengkap — tidak bisa menilai Prec BUY.',
      reasons: [
        'precision_buy tidak ada (model error, atau metrics belum tersimpan).',
        'Val accuracy saja tidak cukup untuk keputusan production.',
      ],
      nextActions: [
        'Train ulang dari ML Training (Preview label dulu).',
        'Pastikan status model ready dan metrics muncul di kartu.',
      ],
    };
  }

  reasons.push(
    `Prec BUY ${pctLabel(prec)} — untuk long-only, false BUY mahal (ini filter utama, bukan Val acc).`,
  );
  if (input.accuracy != null) {
    reasons.push(
      `Val acc ${pctLabel(input.accuracy)} diabaikan sebagai penentu utama (mudah menyesatkan saat kelas imbalance).`,
    );
  }
  if (input.recallBuy != null) {
    reasons.push(
      `Recall BUY ${pctLabel(input.recallBuy)} — rendah berarti jarang entry (boleh OK jika Prec bagus).`,
    );
  }

  if (!input.hasCompatibleProfile) {
    reasons.push('Belum ada trading profile yang kompatibel — BUY bisa di-block pair guard.');
    nextActions.push('Create profile from model, lalu aktifkan.');
  } else if (input.pairBlockBuy) {
    reasons.push(
      `Pair guard memblokir BUY: ${input.pairMessage || 'profile ↔ model mismatch'}.`,
    );
    nextActions.push('Samakan SL/TP/horizon profile dengan label model.');
  } else {
    reasons.push('Setup pair/profile terlihat OK — itu syarat eksekusi, bukan bukti profit.');
  }

  if (prec === 0) {
    nextActions.push('Preview label → sesuaikan TP/horizon/history → Train versi baru.');
    nextActions.push('Jangan live; Shadow ON atau tahan entry sampai Prec BUY membaik.');
    return {
      verdict: 'RETRAIN',
      summary: 'Prec BUY 0% — model hampir tidak pernah benar pada label BUY.',
      reasons,
      nextActions: unique(nextActions),
    };
  }

  if (prec < PREC_WEAK) {
    nextActions.push('Preview label → adjust TP/horizon → retrain.');
    nextActions.push('Naikkan min confidence di Risk jika tetap banyak false BUY di paper.');
    return {
      verdict: 'RETRAIN',
      summary: `Prec BUY ${pctLabel(prec)} lemah untuk long-only — false BUY terlalu tinggi.`,
      reasons,
      nextActions: unique(nextActions),
    };
  }

  const ev = input.eval;
  if (!ev) {
    nextActions.unshift('Jalankan Eval (holdout SL/TP vs EMA) di kartu ini.');
    nextActions.push('Setelah Eval, nilai ulang — baru Shadow/paper.');
    const verdict: ModelQualityVerdict =
      prec >= PREC_OK ? 'INCOMPLETE' : 'RETRAIN';
    if (prec >= PREC_OK) {
      reasons.push('Eval belum dijalankan — tanpa bandingkan ke EMA, verdict belum lengkap.');
    }
    return {
      verdict,
      summary:
        prec >= PREC_OK
          ? `Prec BUY ${pctLabel(prec)} lumayan, tapi Eval wajib sebelum promote.`
          : `Prec BUY ${pctLabel(prec)} masih tipis; jalankan Eval dan siapkan retrain.`,
      reasons,
      nextActions: unique(nextActions),
    };
  }

  const mlTrades = ev.mlTrades || 0;
  const emaTrades = ev.emaTrades || 0;
  const mlWr = ev.mlWinRate;
  const emaWr = ev.emaWinRate;
  const mlAvg = ev.mlAvgReturn;
  const emaAvg = ev.emaAvgReturn;

  reasons.push(
    `Eval ML: ${mlTrades} trades · win ${pctLabel(mlWr)} · avg ${pctLabel(mlAvg)} (simulasi holdout, bukan live PnL).`,
  );
  reasons.push(
    `Eval EMA: ${emaTrades} trades · win ${pctLabel(emaWr)} · avg ${pctLabel(emaAvg)}.`,
  );

  const thinSample = mlTrades < MIN_EVAL_TRADES;
  if (thinSample) {
    reasons.push(
      `Sampel Eval ML kecil (< ${MIN_EVAL_TRADES} trades) — angka win/avg kurang andal.`,
    );
  }

  const emaAvgBetter =
    emaAvg != null && mlAvg != null && emaAvg > mlAvg + 0.0005;
  const emaWrBetter =
    emaWr != null &&
    mlWr != null &&
    emaWr > mlWr + 0.08 &&
    emaTrades >= Math.max(1, mlTrades);
  const emaClearlyBetter = emaAvgBetter || emaWrBetter;

  const mlNotLosing =
    mlAvg != null &&
    emaAvg != null &&
    mlAvg >= emaAvg - 0.0005 &&
    (mlWr == null || emaWr == null || mlWr >= emaWr - 0.05);

  if (emaClearlyBetter) {
    reasons.push('Baseline EMA lebih baik di holdout yang sama — filter Eval vs EMA gagal.');
    nextActions.push('Retrain atau ubah label (TP/horizon/history); jangan live.');
    nextActions.push('Boleh Shadow ON untuk observasi sinyal tanpa order.');
    return {
      verdict: 'RETRAIN',
      summary: 'Eval: ML kalah dari EMA baseline — jangan andalkan untuk production.',
      reasons,
      nextActions: unique(nextActions),
    };
  }

  if (thinSample) {
    nextActions.push('Jalankan paper/Shadow lebih lama agar sampel nyata terkumpul.');
    nextActions.push('Pertimbangkan retrain dengan history lebih panjang lalu Eval lagi.');
    return {
      verdict: 'PAPER_ONLY',
      summary: 'Metrik/Eval belum meyakinkan (sampel Eval tipis) — paper/shadow saja.',
      reasons,
      nextActions: unique(nextActions),
    };
  }

  if (prec >= PREC_STRONG && mlNotLosing && mlTrades >= MIN_EVAL_TRADES) {
    nextActions.push('Shadow OFF di Paper — pantau Decision Log + ML trade stats.');
    nextActions.push('Live hanya setelah paper konsisten (jangan lompat dari Val/Eval saja).');
    return {
      verdict: 'PROMOTE_CANDIDATE',
      summary:
        'Prec BUY + Eval vs EMA mendukung kandidat paper penuh — bukan jaminan live profit.',
      reasons,
      nextActions: unique(nextActions),
    };
  }

  if (prec >= PREC_OK && !emaClearlyBetter) {
    nextActions.push('Lanjut paper dengan Shadow OFF; atau Shadow ON dulu 1–2 hari.');
    nextActions.push('Train ulang jika paper/Decision Log menunjukkan banyak false BUY.');
    return {
      verdict: 'PAPER_ONLY',
      summary: 'Cukup untuk uji paper — belum cukup kuat sebagai sinyal production/live.',
      reasons,
      nextActions: unique(nextActions),
    };
  }

  nextActions.push('Preview label → retrain; bandingkan Prec BUY + Eval versi baru.');
  return {
    verdict: 'RETRAIN',
    summary: 'Belum lolos filter Prec BUY / Eval — prioritaskan versi model baru.',
    reasons,
    nextActions: unique(nextActions),
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function verdictStyles(verdict: ModelQualityVerdict): {
  badge: string;
  border: string;
  label: string;
} {
  switch (verdict) {
    case 'PROMOTE_CANDIDATE':
      return {
        badge: 'bg-emerald-500/15 text-emerald-400',
        border: 'border-emerald-500/30',
        label: 'PROMOTE CANDIDATE',
      };
    case 'PAPER_ONLY':
      return {
        badge: 'bg-sky-500/15 text-sky-400',
        border: 'border-sky-500/30',
        label: 'PAPER ONLY',
      };
    case 'RETRAIN':
      return {
        badge: 'bg-red-500/15 text-red-400',
        border: 'border-red-500/30',
        label: 'RETRAIN',
      };
    default:
      return {
        badge: 'bg-amber-500/15 text-amber-400',
        border: 'border-amber-500/30',
        label: 'INCOMPLETE',
      };
  }
}

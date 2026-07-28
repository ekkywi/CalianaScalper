# services/ml-engine/label_config.py
"""Label defaults aligned with Nest DEFAULT_RISK_CONFIG (15m long-only scalper)."""

from dataclasses import dataclass, asdict
import math
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class LabelConfig:
    """
    Training label simulates a long entered at candle close:
    TP hit before SL within max_horizon candles → positive (1).
    Defaults match Nest DEFAULT_RISK_CONFIG until overridden at train time.
    """

    stop_loss_percent: float = 0.03
    take_profit_percent: float = 0.06
    max_horizon_candles: int = 96  # 24h @ 15m — aligns TP 6% with realistic hold window
    round_trip_fee_percent: float = 0.002  # ~0.1% per side spot taker
    label_mode: str = "tp_before_sl"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "LabelConfig":
        if not data:
            return DEFAULT_LABEL_CONFIG
        base = DEFAULT_LABEL_CONFIG
        return cls(
            stop_loss_percent=float(
                data.get("stop_loss_percent", base.stop_loss_percent)
            ),
            take_profit_percent=float(
                data.get("take_profit_percent", base.take_profit_percent)
            ),
            max_horizon_candles=int(
                data.get("max_horizon_candles", base.max_horizon_candles)
            ),
            round_trip_fee_percent=float(
                data.get("round_trip_fee_percent", base.round_trip_fee_percent)
            ),
            label_mode=str(data.get("label_mode", base.label_mode)),
        )


MIN_LABEL_HORIZON_CANDLES = 96


def horizon_for_take_profit(take_profit_percent: float) -> int:
    """Derive label horizon floor from TP % (larger TP → longer forward window)."""
    return max(MIN_LABEL_HORIZON_CANDLES, int(math.ceil(take_profit_percent * 800)))


DEFAULT_LABEL_CONFIG = LabelConfig()

"""Rolling-origin backtest of the variable-spending forecast (fc-1.0-bootstrap).

For each origin date t the model sees only transactions up to t, forecasts total variable spend over the next H days
and is compared with what actually happened. Baseline: naive pace (mean daily spend over the last 30 days times H).

Metrics: MAPE of the median forecast, coverage of the 50% and 80% intervals, mean pinball loss over quantiles
5..95% (a discretised CRPS, FPP3 section 5.9). The baseline is a point forecast, so its CRPS equals its absolute error.

Run from backend/:  python ../evaluation/backtest.py --email you@example.com [--horizon 30] [--step 7] [--paths 2000]
Only aggregate numbers are printed; no transactions are shown."""
import argparse
import sys
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.engine.montecarlo import draw_spend  # noqa: E402
from app.models import User  # noqa: E402
from app.services.ledger import FIXED_CATEGORIES, build_context  # noqa: E402

QUANTILES = np.arange(0.05, 0.951, 0.05)


def pinball(y: float, q_pred: np.ndarray, taus: np.ndarray) -> float:
    diff = y - q_pred
    return float(np.mean(np.maximum(taus * diff, (taus - 1) * diff)) * 2)  # *2: CRPS = 2 * mean pinball


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--horizon", type=int, default=30)
    ap.add_argument("--step", type=int, default=7)
    ap.add_argument("--paths", type=int, default=2000)
    ap.add_argument("--min-history", type=int, default=90)
    a = ap.parse_args()

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == a.email))
        if user is None:
            sys.exit("user not found")
        last = build_context(db, user, __import__("datetime").date.today() + timedelta(days=1))
        spend: dict = defaultdict(float)
        for t in last.txs:
            if t.amount < 0 and t.category not in FIXED_CATEGORIES:
                spend[t.on] += -t.amount
        first, end = min(spend), max(spend)
        origin = first + timedelta(days=a.min_history)
        rows = []
        while origin + timedelta(days=a.horizon) <= end:
            ctx = build_context(db, user, origin)
            sums = draw_spend(ctx, a.horizon, a.paths, seed=int(origin.toordinal())).sum(axis=1)
            q = np.quantile(sums, QUANTILES)
            y = sum(spend.get(origin + timedelta(days=i + 1), 0.0) for i in range(a.horizon))
            pace = float(np.mean([spend.get(origin - timedelta(days=i), 0.0) for i in range(1, 31)])) * a.horizon
            lo50, hi50, lo80, hi80 = np.quantile(sums, [0.25, 0.75, 0.10, 0.90])
            med = float(np.median(sums))
            rows.append((y, med, pace, lo50 <= y <= hi50, lo80 <= y <= hi80, pinball(y, q, QUANTILES), abs(y - pace) * 1.0))
            origin += timedelta(days=a.step)

    if not rows:
        sys.exit("not enough history for a backtest")
    y, med, pace, c50, c80, crps_m, crps_b = map(np.array, zip(*rows))
    ok = y > 0
    print(f"origins: {len(rows)}, horizon: {a.horizon} d, step: {a.step} d, paths: {a.paths}")
    print(f"MAPE model (median): {np.mean(np.abs(y[ok] - med[ok]) / y[ok]) * 100:.1f}%")
    print(f"MAPE baseline (pace): {np.mean(np.abs(y[ok] - pace[ok]) / y[ok]) * 100:.1f}%")
    print(f"coverage 50%: {c50.mean() * 100:.1f}%  (target 50)")
    print(f"coverage 80%: {c80.mean() * 100:.1f}%  (target 80)")
    print(f"CRPS model: {crps_m.mean():,.0f}  baseline: {crps_b.mean():,.0f}  (tenge, lower is better)")
    print("note: overlapping windows (step < horizon) are autocorrelated; treat results as indicative")


if __name__ == "__main__":
    main()

"""What-if / stress-test runs: the same Monte Carlo draws with and without shocks."""
from app.engine import montecarlo as mc
from app.engine import resilience as res
from app.engine.forecast import seed_for
from app.engine.montecarlo import Shocks
from app.services.ledger import Context


def fmt_money(x: float) -> str:
    return ("−" if x < 0 else "") + f"{round(abs(x)):,}".replace(",", " ") + " ₸"


def to_shocks(items: list[dict]) -> Shocks:
    by = {s["type"]: float(s["value"]) for s in items}
    return Shocks(fx=by.get("fx", 0.0), inflation=by.get("inflation", 0.0), income_cut=by.get("income", 0.0),
                  job_loss_months=by.get("jobloss", 0.0))


def _balance_status(v: float) -> str:
    return "risk" if v < 0 else "warn" if v < 100_000 else "ok"


def _prob_status(p: float) -> str:
    return "risk" if p >= 0.3 else "warn" if p >= 0.1 else "ok"


def run(ctx: Context, user_id: int, shock_items: list[dict], days: int, n: int) -> dict:
    shocks = to_shocks(shock_items)
    seed = seed_for(user_id, ctx)
    base = mc.simulate(ctx, days, n, seed)
    scen = mc.simulate(ctx, days, n, seed, shocks)
    bp, sp = mc.percentile_points(ctx, base), mc.percentile_points(ctx, scen)
    b_end, s_end = bp[-1]["p50"], sp[-1]["p50"]
    b_min, s_min = min(p["p50"] for p in bp), min(p["p50"] for p in sp)
    b_risk = int(sum(p["p10"] < 0 for p in bp))
    s_risk = int(sum(p["p10"] < 0 for p in sp))
    b_prob, s_prob = mc.p_shortfall(base), mc.p_shortfall(scen)
    b_res = res.compute(ctx, b_prob)
    s_res = res.compute(ctx, s_prob, shocks)
    share = s_risk / max(days + 1, 1)
    deltas = [
        {"label": f"Баланс через {days} дней", "base": fmt_money(b_end), "scenario": fmt_money(s_end), "status": _balance_status(s_end)},
        {"label": "Минимальный баланс", "base": fmt_money(b_min), "scenario": fmt_money(s_min), "status": _balance_status(s_min)},
        {"label": "Дней с риском разрыва", "base": str(b_risk), "scenario": str(s_risk),
         "status": "risk" if share > 0.2 else "warn" if share > 0.05 else "ok"},
        {"label": "Вероятность кассового разрыва", "base": f"{round(b_prob * 100)}%", "scenario": f"{round(s_prob * 100)}%",
         "status": _prob_status(s_prob)},
        {"label": "Индекс устойчивости", "base": str(b_res.score), "scenario": str(s_res.score),
         "status": "risk" if s_res.score < 40 else "warn" if s_res.score < 65 else "ok"},
    ]
    return {"base": bp, "scenario": sp, "deltas": deltas, "p_base": b_prob, "p_scenario": s_prob}

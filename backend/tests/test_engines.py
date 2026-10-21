from datetime import date, timedelta

import numpy as np
import pytest

from app.engine import forecast as fc
from app.engine import montecarlo as mc
from app.engine import resilience as res
from app.engine.montecarlo import Shocks
from app.services import goals as goal_svc
from app.services import macro as macro_svc
from app.services.ledger import Context, Inc, Ob, _fill_variable_spend

AS_OF = date(2026, 10, 20)


def make_ctx(balance=500_000.0, daily=10_000.0, incomes=True, jitter=1000.0) -> Context:
    from app.services.ledger import Tx

    txs = [Tx(AS_OF - timedelta(days=i), -daily - (i % 5) * jitter, "food") for i in range(1, 91)]
    ctx = Context(as_of=AS_OF, balance=balance, obligations=[Ob("Аренда", "rent", 200_000, 1)],
                  incomes=[Inc("Зарплата", 600_000, 5)] if incomes else [], txs=txs, cat_names={"food": "Продукты"},
                  cat_fx={"food": 0.25}, cpi_now=9.3)
    _fill_variable_spend(ctx)
    return ctx


def test_simulation_is_deterministic_and_starts_at_balance():
    ctx = make_ctx()
    a, b = mc.simulate(ctx, 60, 300, seed=1), mc.simulate(ctx, 60, 300, seed=1)
    assert np.array_equal(a, b)
    assert (a[:, 0] == ctx.balance).all()


def test_known_flows_are_applied_on_their_day():
    ctx = make_ctx(daily=0.0, jitter=0.0)  # no variable spend -> only income and rent move the balance
    paths = mc.simulate(ctx, 30, 50, seed=3)
    # 2026-10-20 + 12 days = 11-01 rent, 11-05 salary
    assert paths[0, 12] == pytest.approx(500_000 - 200_000)
    assert paths[0, 16] == pytest.approx(500_000 - 200_000 + 600_000)


@pytest.mark.parametrize("shocks", [Shocks(fx=15), Shocks(inflation=15), Shocks(income_cut=20), Shocks(job_loss_months=3)])
def test_shocks_never_improve_the_outcome(shocks):
    ctx = make_ctx()
    base, scen = mc.simulate(ctx, 90, 400, seed=5), mc.simulate(ctx, 90, 400, seed=5, shocks=shocks)
    assert scen[:, -1].mean() <= base[:, -1].mean() + 1e-6
    assert mc.p_shortfall(scen) >= mc.p_shortfall(base) - 1e-9


def test_zero_shocks_equal_base():
    ctx = make_ctx()
    assert np.array_equal(mc.simulate(ctx, 30, 100, 9), mc.simulate(ctx, 30, 100, 9, Shocks()))


def test_percentiles_are_ordered():
    ctx = make_ctx()
    for p in mc.percentile_points(ctx, mc.simulate(ctx, 30, 400, 2)):
        assert p["p10"] <= p["p25"] <= p["p50"] <= p["p75"] <= p["p90"]


def test_month_end_interval_and_naive_baseline():
    ctx = make_ctx()
    me = fc.month_end(ctx, user_id=1, n=500)
    assert me.low <= me.median <= me.high
    assert me.naive > 0 and me.pace_per_day > 0


def test_resilience_score_bounds_and_job_loss_lowers_it():
    ctx = make_ctx()
    paths = mc.simulate(ctx, 90, 400, 4)
    base = res.compute(ctx, mc.p_shortfall(paths))
    job = Shocks(job_loss_months=3)
    stressed = res.compute(ctx, mc.p_shortfall(mc.simulate(ctx, 90, 400, 4, job)), job)
    assert 0 <= stressed.score <= base.score <= 100
    assert {c["key"] for c in base.components} == {"buffer", "dti", "volatility", "income", "fx"}


def test_no_data_does_not_crash():
    ctx = make_ctx(balance=0.0, daily=0.0, incomes=False)
    ctx.txs.clear()
    _fill_variable_spend(ctx)
    paths = mc.simulate(ctx, 30, 50, 1)
    assert res.compute(ctx, mc.p_shortfall(paths)).score >= 0


def test_goal_projection():
    p = goal_svc.projection(target=1_000_000, saved=400_000, monthly=100_000, deadline="2027-03", as_of=AS_OF)
    assert p["etaMonth"] == "2027-04" and p["onTrack"] is False and p["requiredMonthly"] == 120_000
    assert goal_svc.projection(1_000_000, 400_000, 100_000, "2027-06", AS_OF)["onTrack"] is True


NBK_XML = """<?xml version="1.0" encoding="utf-8"?><rates><item><title>USD</title><pubDate>20.10.2026</pubDate>
<description>452.59</description><quant>1</quant><index>UP</index><change>+0.47</change><link></link></item>
<item><title>JPY</title><pubDate>20.10.2026</pubDate><description>290.10</description><quant>100</quant></item></rates>"""


def test_nbk_rates_parser():
    published, rates = macro_svc.parse_nbk_rates(NBK_XML)
    assert published == date(2026, 10, 20)
    assert rates["USD"] == pytest.approx(452.59) and rates["JPY"] == pytest.approx(2.901)

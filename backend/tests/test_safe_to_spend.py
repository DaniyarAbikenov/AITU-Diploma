"""Server Safe-to-Spend against the control example of the spec (same as frontend/src/lib/safe-to-spend.test.ts)."""
from datetime import date

from app.services.safe_to_spend import Payment, compute, safe_daily


def test_control_example():
    due = [0, 90_000_00] + [0] * 8
    assert safe_daily(100_000_00, due)[:2] == (1_000_00, 0)
    due = [0, 110_000_00] + [0] * 8
    daily, deficit, first = safe_daily(100_000_00, due)
    assert (daily, deficit, first) == (0, 10_000_00, 1)


def test_horizon_two_payouts_rules_and_overdue_one_off():
    r = compute(date(2026, 11, 21), 100_000_00, [1], [(22, 90_000_00, "Аренда", "ob_1", None, None)])
    assert (r.days, r.until, r.safe_daily_minor) == (10, date(2026, 11, 30), 1_000_00)
    r = compute(date(2026, 11, 8), 120_000_00, [5, 20], [])
    assert r.until == date(2026, 11, 19) and r.safe_daily_minor == 10_000_00
    r = compute(date(2026, 11, 30), 400_000_00, [], [(30, 1, "Питание", "ob_2", None, {"2026-11": 150_000_00})])
    assert r.committed_minor == 150_000_00
    r = compute(date(2026, 11, 21), 10_000_00, [1], [], [Payment(date(2026, 11, 1), 20_000_00, "Взнос")])
    assert r.deficit_minor == 10_000_00 and r.first_deficit_day == date(2026, 11, 21)

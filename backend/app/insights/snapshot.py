"""One consistent snapshot of a user's data for the signal evaluators: same as_of, perimeter and entities for all."""
import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from fractions import Fraction
from functools import cached_property

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import as_of as app_today
from app.core.money import to_minor
from app.models import (
    Account,
    AccountCheckpoint,
    DailyNeed,
    Goal,
    ImportBatch,
    IncomeAllocation,
    IncomeSource,
    Obligation,
    PlannedPayment,
    Transaction,
    User,
)
from app.services import accounts as acc_svc
from app.services import fx
from app.services import rules as rule_svc
from app.services import safe_to_spend as sts_svc
from app.services.ledger import month_key

HISTORY_DAYS = 120


@dataclass
class Snapshot:
    db: Session
    user: User
    as_of: date = field(default_factory=app_today)

    @cached_property
    def th(self):
        from app.insights.settings import for_user

        return for_user(self.user.insight_settings)

    @property
    def id(self) -> str:
        return f"u{self.user.id}@{self.as_of.isoformat()}"

    @property
    def month(self) -> str:
        return month_key(self.as_of)

    # ---- entities
    @cached_property
    def accounts(self) -> list[Account]:
        return list(self.db.scalars(select(Account).where(Account.user_id == self.user.id).order_by(Account.id)))

    @cached_property
    def account_views(self) -> dict[int, object]:
        return {a.id: acc_svc.account_out(self.db, a) for a in self.accounts}

    @cached_property
    def usable_accounts(self) -> list[Account]:
        """Confirmed, typed accounts with a known balance and a tenge rate (same rule as the overview)."""
        out = []
        for a in self.accounts:
            v = self.account_views[a.id]
            if a.confirmed and a.kind and v.balanceKnown and v.currentBalanceKzt is not None:
                out.append(a)
        return out

    def kzt_minor(self, amount_minor: int, currency: str) -> int | None:
        return fx.to_kzt_minor(amount_minor, fx.latest(self.db, currency))

    def available_kzt_minor(self, a: Account) -> int:
        v = self.account_views[a.id]
        return to_minor(v.availableKzt if v.availableKzt is not None else v.currentBalanceKzt)

    @cached_property
    def checkpoints(self) -> dict[int, AccountCheckpoint | None]:
        return {a.id: acc_svc.latest_checkpoint(self.db, a) for a in self.accounts}

    @cached_property
    def batches(self) -> list[ImportBatch]:
        return list(self.db.scalars(select(ImportBatch).where(ImportBatch.user_id == self.user.id)))

    @cached_property
    def transactions(self) -> list[Transaction]:
        """Operations of the last HISTORY_DAYS days (cancelled ones excluded)."""
        start = self.as_of - timedelta(days=HISTORY_DAYS)
        return list(self.db.scalars(select(Transaction).where(
            Transaction.user_id == self.user.id, Transaction.voided.is_(False), acc_svc.eff_date >= start,
            acc_svc.eff_date <= self.as_of)))

    @cached_property
    def obligations(self) -> list[Obligation]:
        return list(self.db.scalars(select(Obligation).where(Obligation.user_id == self.user.id,
                                                             Obligation.rejected.is_(False))))

    @cached_property
    def incomes(self) -> list[IncomeSource]:
        return list(self.db.scalars(select(IncomeSource).where(IncomeSource.user_id == self.user.id,
                                                               IncomeSource.rejected.is_(False))))

    @property
    def confirmed_incomes(self) -> list[IncomeSource]:
        return [i for i in self.incomes if i.confirmed]

    @cached_property
    def planned(self) -> list[PlannedPayment]:
        return list(self.db.scalars(select(PlannedPayment).where(PlannedPayment.user_id == self.user.id,
                                                                 PlannedPayment.cancelled.is_(False))))

    @cached_property
    def goals(self) -> list[Goal]:
        return list(self.db.scalars(select(Goal).where(Goal.user_id == self.user.id)))

    def rule_amount_minor(self, target_type: str, target_id: int, month: str) -> int | None:
        c = rule_svc.compute(self.db, self.user, target_type, target_id, month, self.as_of)
        return None if c is None or c.amount is None else int(c.amount * 100)

    def planned_left_minor(self, p: PlannedPayment) -> int:
        from app.routers.planned import out

        return to_minor(out(self.db, p).left)

    def amount(self, t: Transaction) -> int:
        return t.user_amount_minor if t.user_amount_minor is not None else t.amount_minor

    def day(self, t: Transaction):
        return t.user_booked_on or t.booked_on

    def is_own_transfer(self, t: Transaction) -> bool:
        return t.user_kind == "transfer_own" or (t.user_kind is None and t.internal)

    def cashflow(self, start, end, currency: str = "KZT") -> list[Transaction]:
        """Income and spending operations in [start, end] (own transfers excluded)."""
        return [t for t in self.transactions if start <= self.day(t) <= end and t.currency == currency
                and not self.is_own_transfer(t)]

    @property
    def essential_minor(self) -> int | None:
        return self.user.essential_expenses_minor

    @cached_property
    def income_floor_minor(self) -> int | None:
        """Cautious monthly income: the lower bound of each confirmed payout (FR-29), None when none is confirmed."""
        inc = self.confirmed_incomes
        return sum(i.amount_min_minor or i.amount_minor for i in inc) if inc else None

    def obligation_month_minor(self, o: Obligation, month: str) -> int:
        r = self.rule_amount_minor("obligation", o.id, month)
        return o.amount_minor if r is None else r

    @cached_property
    def obligations_month_minor(self) -> int:
        return sum(self.obligation_month_minor(o, self.month) for o in self.obligations
                   if o.confirmed and (not o.ends_at or o.ends_at >= self.month))

    @cached_property
    def savings_plan_minor(self) -> int:
        return sum(g.monthly_minor for g in self.goals if g.saved_minor < g.target_minor)

    @cached_property
    def savings_available_minor(self) -> int | None:
        accs = [a for a in self.usable_accounts if a.kind in ("savings", "deposit")]
        return sum(self.available_kzt_minor(a) for a in accs) if accs else None

    @cached_property
    def savings_total_minor(self) -> int | None:
        accs = [a for a in self.usable_accounts if a.kind in ("savings", "deposit")]
        return sum(to_minor(self.account_views[a.id].currentBalanceKzt) for a in accs) if accs else None

    # ---- derived, single source of truth with the overview
    @cached_property
    def liquid_minor(self) -> int | None:
        accs = [a for a in self.usable_accounts if a.kind in ("current", "cash")]
        return sum(self.available_kzt_minor(a) for a in accs) if accs else None

    @cached_property
    def needs(self) -> list[DailyNeed]:
        return list(self.db.scalars(select(DailyNeed).where(DailyNeed.user_id == self.user.id).order_by(DailyNeed.id)))

    def _covered(self, n: DailyNeed) -> bool:
        """The need is already a confirmed payment or an active planned item."""
        active = {f"ob_{o.id}" for o in self.obligations if o.confirmed} | {f"pl_{p.id}" for p in self.planned}
        return n.covered_by in active

    def need_per_day(self, n: DailyNeed, day: date) -> Fraction:
        """Minor units of one need on a day; a monthly need is spread over the days of its month."""
        return Fraction(n.amount_minor, 1 if n.period == "day" else calendar.monthrange(day.year, day.month)[1])

    def need_on(self, day: date) -> Fraction:
        return sum((self.need_per_day(n, day)
                    for n in self.needs if not self._covered(n)), Fraction(0))

    @cached_property
    def protected_minor(self) -> int:
        """Money the user set aside by confirming a payout split and has not marked as done, plus the own buffer."""
        rows = self.db.scalars(select(IncomeAllocation).where(IncomeAllocation.user_id == self.user.id,
                                                              IncomeAllocation.status == "confirmed"))
        return int(self.th.bufferMinor) + sum(x["amountMinor"] for r in rows for x in r.items)

    def sts_monthly(self) -> list[tuple]:
        months = rule_svc.months_ahead(self.as_of, 4)
        return [(o.day_of_month, o.amount_minor, o.name, f"ob_{o.id}", o.ends_at,
                 {m: self.rule_amount_minor("obligation", o.id, m) for m in months})
                for o in self.obligations if o.confirmed]

    def sts_one_off(self) -> list[sts_svc.Payment]:
        return [sts_svc.Payment(p.due_on, self.planned_left_minor(p), p.name, f"pl_{p.id}")
                for p in self.planned if p.direction == "expense"]

    @cached_property
    def sts(self) -> sts_svc.SafeToSpend | None:
        if self.liquid_minor is None:
            return None
        return sts_svc.compute(self.as_of, self.liquid_minor - self.protected_minor,
                               [i.day_of_month for i in self.confirmed_incomes], self.sts_monthly(), self.sts_one_off(),
                               self.need_on if self.needs else None)

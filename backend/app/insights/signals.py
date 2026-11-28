"""Signal evaluators R001–R190: deterministic code, one function per signal of the knowledge base.

A signal answers three questions (activation contract): ready — all required inputs are known and fresh;
triggered — the situation of the entry holds; evidenceValid — the evidence (amounts, dates, record ids) is consistent.
An unknown input never becomes 0 or false: the signal is not ready and the entry is suppressed. Money is integer
minor units with a currency. A signal without an evaluator is `unavailable` with the data it needs."""
from collections.abc import Callable
from dataclasses import dataclass, field

from app.insights.snapshot import Snapshot


@dataclass
class Signal:
    id: str
    ready: bool | None = None
    triggered: bool | None = None
    evidence_valid: bool | None = None
    values: dict = field(default_factory=dict)  # money as {"value_minor": int, "currency": "KZT"}
    evidence_ids: list[str] = field(default_factory=list)
    summary: str | None = None  # server fact sentence built only from confirmed values
    entity: str = "user"
    period: str = ""
    root_cause: str | None = None
    critical: bool = False
    impact_minor: int = 0
    urgency: float = 0.0  # 0..1 (P194)
    effort: float = 0.5  # 0..1, higher = more work for the user
    evidence: float = 1.0  # 0..1 (P192)
    unavailable: str | None = None  # why the signal cannot be evaluated yet

    @property
    def usable(self) -> bool:
        return self.ready is True and self.evidence_valid is True and self.unavailable is None


Evaluator = Callable[[Snapshot], Signal]
REGISTRY: dict[str, Evaluator] = {}
NEEDS: dict[str, str] = {}  # signals without an evaluator: what data they need


def signal(sid: str):
    def wrap(fn: Evaluator) -> Evaluator:
        REGISTRY[sid] = fn
        return fn
    return wrap


def needs(text: str, *ids: str) -> None:
    for i in ids:
        NEEDS[i] = text


def not_ready(sid: str, why: str, **kw) -> Signal:
    return Signal(sid, ready=False, triggered=None, evidence_valid=None, summary=None, unavailable=None,
                  values={"notReady": why}, **kw)


def money(v_minor: int, currency: str = "KZT") -> dict:
    return {"value_minor": int(v_minor), "currency": currency}


def plural(n: int, one: str, few: str, many: str) -> str:
    a, b = abs(n) % 100, abs(n) % 10
    word = many if 10 < a < 20 else one if b == 1 else few if 1 < b < 5 else many
    return f"{n} {word}"


def ops(n: int) -> str:
    return plural(n, "операция", "операции", "операций")


def tenge(v_minor: int) -> str:
    v = round(v_minor / 100)
    return f"{v:,}".replace(",", " ") + " ₸"


def evaluate_all(s: Snapshot, ids: set[str]) -> dict[str, Signal]:
    """Evaluate each needed signal once. An evaluator error makes the signal unavailable, never a false insight."""
    out: dict[str, Signal] = {}
    for sid in sorted(ids):
        fn = REGISTRY.get(sid)
        if fn is None:
            out[sid] = Signal(sid, unavailable=NEEDS.get(sid, "вычислитель сигнала ещё не реализован"))
            continue
        try:
            out[sid] = fn(s)
        except Exception as e:  # noqa: BLE001 - a broken evaluator must not break the dashboard
            out[sid] = Signal(sid, unavailable=f"ошибка вычисления: {type(e).__name__}")
    return out


# evaluators live in signal modules grouped by knowledge-base module; importing them registers them
from app.insights import evaluators  # noqa: E402,F401

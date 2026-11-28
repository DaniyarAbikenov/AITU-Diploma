"""API contract. Field names intentionally mirror the frontend's src/api/types.ts (camelCase, plus
snake_case as_of / model_version on forecast payloads). Amounts are tenge (major units)."""
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["ok", "warn", "risk"]
Currency = Literal["KZT", "USD"]


# ---- auth / profile
class RegisterIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6)
    name: str = Field(min_length=1, max_length=120)
    city: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    city: str
    currency: Literal["KZT"] = "KZT"
    timezone: str = "Asia/Almaty"
    # null = not provided yet; the UI asks for it instead of showing zero
    plannedIncome: int | float | None = None
    essentialExpenses: int | float | None = None
    workHours: int | None = None


class AuthOut(BaseModel):
    token: str
    user: UserOut
    onboarded: bool


class ProfilePatch(BaseModel):
    """Only the fields sent are changed. Sending null for a plan field marks it as unknown again."""
    name: str | None = Field(default=None, min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    timezone: str | None = Field(default=None, max_length=40)
    plannedIncome: float | None = Field(default=None, ge=0, le=1e12)
    essentialExpenses: float | None = Field(default=None, ge=0, le=1e12)
    workHours: int | None = Field(default=None, ge=1, le=744)


class Ok(BaseModel):
    ok: bool = True


# ---- accounts / transactions
AccountKind = Literal["current", "savings", "cash"]
TxKind = Literal["expense", "income", "income_salary", "income_other", "transfer_own", "transfer_third_party"]


class AccountOut(BaseModel):
    id: str
    bank: str
    name: str
    currency: Currency
    balance: int | float
    kind: AccountKind | None = None
    confirmed: bool = False
    # false when no checkpoint or statement balance exists: `balance` is then a placeholder, not a real 0
    balanceKnown: bool = False
    balanceAsOf: str | None = None
    balanceSource: Literal["manual", "statement"] | None = None


class AccountIn(BaseModel):
    bank: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    kind: AccountKind
    currency: Currency = "KZT"
    balance: float | None = Field(default=None, ge=-1e12, le=1e12)
    balanceAsOf: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class AccountPatch(BaseModel):
    bank: str | None = Field(default=None, min_length=1, max_length=80)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: AccountKind | None = None
    currency: Currency | None = None
    confirmed: bool | None = None


class CheckpointIn(BaseModel):
    balance: float = Field(ge=-1e12, le=1e12)
    asOf: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    source: Literal["manual", "statement"] = "manual"


class CheckpointOut(BaseModel):
    id: str
    accountId: str
    balance: int | float
    asOf: str
    source: Literal["manual", "statement"]


class CategoryOut(BaseModel):
    id: str
    name: str
    color: str


class TransactionOut(BaseModel):
    id: str
    date: str
    amount: int | float
    currency: Currency
    merchant: str
    categoryId: str
    accountId: str
    needsReview: bool
    internal: bool = False
    # effective operation type: the user's decision if any, otherwise derived from the import
    kind: TxKind = "expense"
    kindSource: Literal["user", "auto"] = "auto"


class TxKindIn(BaseModel):
    """null removes the user's decision and returns to the imported classification."""
    kind: TxKind | None
    saveRule: bool = False


class RecategorizeIn(BaseModel):
    category: str


class BulkCategorizeIn(BaseModel):
    merchant: str
    category: str


class MerchantRuleOut(BaseModel):
    id: str
    merchant: str
    categoryId: str


class PeriodOut(BaseModel):
    from_: str = Field(serialization_alias="from")
    to: str

    model_config = {"populate_by_name": True}


class ImportReportOut(BaseModel):
    id: str
    status: Literal["processing", "done", "failed"]
    parsed: int
    needsReview: int
    period: dict[str, str]
    bank: str
    warnings: list[str] = []


class ImportJsonIn(BaseModel):
    bank: str


# ---- dashboard / forecast
class TopCategory(BaseModel):
    categoryId: str
    amount: int | float
    prev: int | float


class DashboardSummaryOut(BaseModel):
    month: str
    income: int | float
    expense: int | float
    net: int | float
    prevExpense: int | float
    topCategories: list[TopCategory]


class Driver(BaseModel):
    label: str
    delta: int | float


class MonthEndForecastOut(BaseModel):
    as_of: str
    model_version: str
    month: str
    spentSoFar: int | float
    median: int | float
    low: int | float
    high: int | float
    prevMonth: int | float
    pacePerDay: int | float
    drivers: list[Driver]


class BalancePointOut(BaseModel):
    date: str
    p10: int | float
    p25: int | float
    p50: int | float
    p75: int | float
    p90: int | float


class RiskDay(BaseModel):
    date: str
    reason: str
    pBelowZero: float


class PaymentOut(BaseModel):
    date: str
    name: str
    amount: int | float


class BalanceForecastOut(BaseModel):
    as_of: str
    model_version: str
    days: list[BalancePointOut]
    riskDays: list[RiskDay]
    payments: list[PaymentOut]


class InsightOut(BaseModel):
    id: str
    status: Status
    title: str
    why: str
    action: str
    to: str


# ---- obligations / income
class ObligationOut(BaseModel):
    id: str
    name: str
    kind: Literal["credit", "installment", "rent", "subscription", "utility"]
    amount: int | float
    dayOfMonth: int
    endsAt: str | None = None
    confirmed: bool
    rejected: bool = False


class ObligationIn(BaseModel):
    name: str
    kind: Literal["credit", "installment", "rent", "subscription", "utility"]
    amount: float = Field(gt=0)
    dayOfMonth: int = Field(ge=1, le=31)
    endsAt: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class ConfirmIn(BaseModel):
    """confirmed=true accepts a detected item; rejected=true marks it as not real (it then leaves the plan)."""
    confirmed: bool | None = None
    rejected: bool | None = None


class CalendarMonth(BaseModel):
    month: str
    credit: int | float
    installment: int | float
    regular: int | float


class ObligationsCalendarOut(BaseModel):
    months: list[CalendarMonth]
    income: int | float


class DtiPointOut(BaseModel):
    month: str
    dti: float


class IncomeSourceOut(BaseModel):
    id: str
    name: str
    amount: int | float
    dayOfMonth: int
    confirmed: bool
    rejected: bool = False
    amountMin: int | float | None = None
    amountMax: int | float | None = None


class IncomeSourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0, le=1e12)
    dayOfMonth: int = Field(ge=1, le=31)
    amountMin: float | None = Field(default=None, gt=0, le=1e12)
    amountMax: float | None = Field(default=None, gt=0, le=1e12)


class IncomeSourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    amount: float | None = Field(default=None, gt=0, le=1e12)
    dayOfMonth: int | None = Field(default=None, ge=1, le=31)
    amountMin: float | None = Field(default=None, gt=0, le=1e12)
    amountMax: float | None = Field(default=None, gt=0, le=1e12)
    confirmed: bool | None = None
    rejected: bool | None = None


# ---- resilience / scenarios
class ResilienceComponentOut(BaseModel):
    key: str
    name: str
    status: Status
    value: str
    explain: str
    action: str


class ResilienceOut(BaseModel):
    as_of: str
    model_version: str
    score: int
    pShortfall: float
    runwayMonths: float
    components: list[ResilienceComponentOut]


class ResilienceHistoryPoint(BaseModel):
    month: str
    score: int


class Shock(BaseModel):
    type: Literal["fx", "inflation", "income", "jobloss"]
    value: float = Field(ge=0, le=100)


class ScenarioPresetOut(BaseModel):
    id: str
    name: str
    description: str
    shocks: list[Shock]


class ScenarioRunIn(BaseModel):
    shocks: list[Shock] = Field(max_length=8)
    days: Literal[30, 60, 90] = 90


class Delta(BaseModel):
    label: str
    base: str
    scenario: str
    status: Status


class ScenarioResultOut(BaseModel):
    as_of: str
    model_version: str
    base: list[BalancePointOut]
    scenario: list[BalancePointOut]
    deltas: list[Delta]


class SavedScenarioIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    shocks: list[Shock]


class SavedScenarioOut(BaseModel):
    id: str
    name: str
    shocks: list[Shock]
    createdAt: str


# ---- macro
class MacroIndicatorOut(BaseModel):
    code: str
    name: str
    value: str
    change: str
    trend: Literal["up", "down", "flat"]
    why: str
    series: list[float]


class Contribution(BaseModel):
    category: str
    pp: float


class PersonalInflationOut(BaseModel):
    as_of: str
    model_version: str
    personal: float
    official: float
    contributions: list[Contribution]


class CityPriceOut(BaseModel):
    item: str
    unit: str
    price: int | float
    change: float


# ---- goals
class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    target: float = Field(gt=0)
    saved: float = Field(ge=0, default=0)
    monthly: float = Field(ge=0, default=0)
    deadline: str = Field(pattern=r"^\d{4}-\d{2}$")


class GoalProjectionOut(BaseModel):
    goalId: str
    etaMonth: str
    requiredMonthly: int | float
    onTrack: bool


class GoalOut(BaseModel):
    id: str
    name: str
    target: int | float
    saved: int | float
    monthly: int | float
    deadline: str
    projection: GoalProjectionOut

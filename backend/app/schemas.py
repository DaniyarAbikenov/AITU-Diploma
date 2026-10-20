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


class AuthOut(BaseModel):
    token: str
    user: UserOut
    onboarded: bool


class ProfilePatch(BaseModel):
    name: str | None = None
    city: str | None = None


class Ok(BaseModel):
    ok: bool = True


# ---- accounts / transactions
class AccountOut(BaseModel):
    id: str
    bank: str
    name: str
    currency: Currency
    balance: int | float


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


class ObligationIn(BaseModel):
    name: str
    kind: Literal["credit", "installment", "rent", "subscription", "utility"]
    amount: float = Field(gt=0)
    dayOfMonth: int = Field(ge=1, le=31)
    endsAt: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class ConfirmIn(BaseModel):
    confirmed: bool


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

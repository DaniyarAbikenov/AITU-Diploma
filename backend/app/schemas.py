"""API contract. Field names intentionally mirror the frontend's src/api/types.ts (camelCase, plus
snake_case as_of / model_version on forecast payloads). Amounts are tenge (major units)."""
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["ok", "warn", "risk"]
Currency = Literal["KZT", "USD", "EUR", "RUB"]  # account currencies (rates from nationalbank.kz)


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
AccountKind = Literal["current", "savings", "deposit", "cash"]
Early = Literal["yes", "no", "lose_interest"]
TxKind = Literal["expense", "income", "income_salary", "income_other", "income_interest", "transfer_own",
                 "transfer_third_party"]


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
    # checkpoint balance plus manual operations dated after it (null when the balance is unknown)
    currentBalance: int | float | None = None
    # tenge equivalents at the latest official rate (null for an unknown balance or a currency without a rate);
    # `balance` and `currentBalance` stay in the account currency
    rate: float | None = None
    rateDate: str | None = None
    rateStale: bool = False
    balanceKzt: int | float | None = None
    currentBalanceKzt: int | float | None = None
    # change of the tenge equivalent since the balance date caused by the rate alone (not income or spending)
    revaluationKzt: int | float | None = None
    # availability: frozen money stays in capital but not in the liquid pool until frozenUntil
    frozenUntil: str | None = None
    frozenAmount: int | float | None = None  # in the account currency, 0 when nothing is frozen today
    availableBalance: int | float | None = None
    frozenKzt: int | float | None = None
    availableKzt: int | float | None = None
    interestRate: float | None = None
    earlyWithdrawal: Early | None = None
    numberMask: str | None = None  # last digits of the card/account number from statements


class AccountIn(BaseModel):
    bank: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    kind: AccountKind
    currency: Currency = "KZT"
    frozenUntil: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    frozenAmount: float | None = Field(default=None, ge=0, le=1e12)
    interestRate: float | None = Field(default=None, ge=0, le=100)
    earlyWithdrawal: Early | None = None
    balance: float | None = Field(default=None, ge=-1e12, le=1e12)
    balanceAsOf: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class AccountPatch(BaseModel):
    """Availability fields: sending null clears them (the money becomes available)."""
    bank: str | None = Field(default=None, min_length=1, max_length=80)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: AccountKind | None = None
    currency: Currency | None = None
    confirmed: bool | None = None
    frozenUntil: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    frozenAmount: float | None = Field(default=None, ge=0, le=1e12)
    interestRate: float | None = Field(default=None, ge=0, le=100)
    earlyWithdrawal: Early | None = None


class TransferIn(BaseModel):
    """Move money between two own accounts: two linked operations, neither income nor expense. requestId makes a
    repeated submit return the first transfer instead of creating a duplicate."""
    fromAccountId: str
    toAccountId: str
    amount: float = Field(gt=0, le=1e12)  # in the source account currency
    toAmount: float | None = Field(default=None, gt=0, le=1e12)  # in the target currency when currencies differ
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str | None = Field(default=None, max_length=200)
    requestId: str = Field(min_length=8, max_length=40)


class TransferCandidate(BaseModel):
    outId: str
    inIds: list[str]


class LinkIn(BaseModel):
    outId: str
    inId: str


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
    amount: int | float  # in `currency`, the currency of the operation
    currency: str
    merchant: str
    categoryId: str
    accountId: str
    needsReview: bool
    internal: bool = False
    # effective operation type: the user's decision if any, otherwise derived from the import
    kind: TxKind = "expense"
    kindSource: Literal["user", "auto"] = "auto"
    source: Literal["import", "manual"] = "import"
    note: str | None = None
    voided: bool = False
    transferGroup: str | None = None
    # imported values when the user corrected them (null = no correction)
    original: dict | None = None


class TransactionEditOut(BaseModel):
    action: str
    before: dict | None = None
    after: dict | None = None
    at: str


class TransactionIn(BaseModel):
    """A manual operation. amount is signed: negative = money out of the account, positive = money in."""
    accountId: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    amount: float = Field(ge=-1e12, le=1e12)
    merchant: str = Field(min_length=1, max_length=200)
    category: str | None = None
    kind: TxKind | None = None
    note: str | None = Field(default=None, max_length=200)


class TxKindIn(BaseModel):
    """null removes the user's decision and returns to the imported classification."""
    kind: TxKind | None
    saveRule: bool = False


class RecategorizeIn(BaseModel):
    """Imported operations accept only `category`; manual ones accept every field."""
    category: str | None = None
    accountId: str | None = None
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    amount: float | None = Field(default=None, ge=-1e12, le=1e12)
    merchant: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=200)


class BulkCategorizeIn(BaseModel):
    merchant: str
    category: str


class MerchantRuleOut(BaseModel):
    id: str
    merchant: str
    categoryId: str
    kind: str | None = None


class PeriodOut(BaseModel):
    from_: str = Field(serialization_alias="from")
    to: str

    model_config = {"populate_by_name": True}


class RateOut(BaseModel):
    currency: str
    rate: float  # tenge per 1 unit
    rateDate: str  # NBK publication date
    fetchedAt: str | None = None
    source: str  # nbk | demo-seed
    stale: bool


class RatesOut(BaseModel):
    base: Literal["KZT"] = "KZT"
    source: str = "Национальный банк РК, официальный курс (nationalbank.kz)"
    rates: list[RateOut]


class ImportReportOut(BaseModel):
    id: str
    status: Literal["processing", "done", "failed"]
    parsed: int
    needsReview: int
    period: dict[str, str]
    bank: str
    warnings: list[str] = []
    accountId: str | None = None
    accountName: str | None = None


class ImportAccountOption(BaseModel):
    id: str
    bank: str
    name: str
    currency: str
    numberMask: str | None = None


class ImportPreviewOut(BaseModel):
    """What the statement is and which account it would go to. Nothing is written yet."""
    bank: str
    accountName: str
    numberMask: str | None = None  # "*1234" from the header; null = the header has no number
    currency: str
    periodFrom: str | None = None
    periodTo: str | None = None
    operations: int
    closingBalance: int | float | None = None
    suggestedAccountId: str | None = None
    matchedBy: Literal["number", "name"] | None = None
    # true when the account could not be identified by number: the user must pick an account or "new"
    needsChoice: bool
    accounts: list[ImportAccountOption]
    warnings: list[str] = []


class MoveOperationsIn(BaseModel):
    targetAccountId: str


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
RuleKind = Literal["per_day", "percent_income", "percent_of", "fixed_plus", "formula"]


class RuleInfoOut(BaseModel):
    """How the amount is computed and what it is this month and the next ones (null = not computed, never 0)."""
    kind: RuleKind
    params: dict
    expression: str
    validFrom: str
    amountThisMonth: int | float | None
    explanation: str
    estimate: bool
    overridden: bool = False
    missing: str | None = None
    amountsByMonth: dict[str, int | float | None] = {}


class RuleIn(BaseModel):
    kind: RuleKind
    params: dict = {}
    expression: str | None = Field(default=None, max_length=300)


class RulePreviewIn(RuleIn):
    month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class RulePreviewOut(BaseModel):
    amount: int | float | None = None
    explanation: str | None = None
    estimate: bool = False
    missing: str | None = None
    expression: str | None = None
    error: str | None = None
    errorPos: int | None = None


class OverrideIn(BaseModel):
    """null removes the override (the rule applies again)."""
    amount: float | None = Field(default=None, ge=0, le=1e12)


class RuleVariableOut(BaseModel):
    name: str
    description: str


class ObligationOut(BaseModel):
    id: str
    name: str
    kind: Literal["credit", "installment", "rent", "subscription", "utility"]
    amount: int | float
    dayOfMonth: int
    endsAt: str | None = None
    confirmed: bool
    rejected: bool = False
    categoryId: str | None = None
    debtLeft: int | float | None = None
    rule: RuleInfoOut | None = None


class ObligationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["credit", "installment", "rent", "subscription", "utility"]
    amount: float = Field(gt=0, le=1e12)
    dayOfMonth: int = Field(ge=1, le=31)
    endsAt: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    category: str | None = None
    debtLeft: float | None = Field(default=None, ge=0, le=1e12)


class ObligationPatch(BaseModel):
    """Edit a regular payment and/or decide on it. endsAt: null clears the end month."""
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: Literal["credit", "installment", "rent", "subscription", "utility"] | None = None
    amount: float | None = Field(default=None, gt=0, le=1e12)
    dayOfMonth: int | None = Field(default=None, ge=1, le=31)
    endsAt: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    category: str | None = None
    debtLeft: float | None = Field(default=None, ge=0, le=1e12)
    confirmed: bool | None = None
    rejected: bool | None = None


PlannedStatus = Literal["planned", "partial", "paid", "cancelled"]
DATE = r"^\d{4}-\d{2}-\d{2}$"


class PlannedPaymentIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    direction: Literal["expense", "income"] = "expense"
    amount: float = Field(gt=0, le=1e12)
    dueOn: str = Field(pattern=DATE)
    dueTo: str | None = Field(default=None, pattern=DATE)
    repeat: Literal["once", "yearly"] = "once"
    category: str | None = None
    accountId: str | None = None
    mandatory: bool = True
    movable: bool = False


class PlannedPaymentPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    direction: Literal["expense", "income"] | None = None
    amount: float | None = Field(default=None, gt=0, le=1e12)
    dueOn: str | None = Field(default=None, pattern=DATE)
    dueTo: str | None = Field(default=None, pattern=DATE)
    repeat: Literal["once", "yearly"] | None = None
    category: str | None = None
    accountId: str | None = None
    mandatory: bool | None = None
    movable: bool | None = None
    cancelled: bool | None = None


class SettleIn(BaseModel):
    """Pay a planned item: link an existing operation, or create one manual operation from these fields.
    amount may be less than what is left (partial payment)."""
    transactionId: str | None = None
    amount: float | None = Field(default=None, gt=0, le=1e12)
    accountId: str | None = None
    date: str | None = Field(default=None, pattern=DATE)


class SettlementOut(BaseModel):
    transactionId: str
    amount: int | float
    period: str


class PlannedPaymentOut(BaseModel):
    id: str
    name: str
    direction: Literal["expense", "income"]
    amount: int | float
    dueOn: str
    dueTo: str | None = None
    repeat: Literal["once", "yearly"]
    categoryId: str | None = None
    accountId: str | None = None
    mandatory: bool
    movable: bool
    status: PlannedStatus
    paid: int | float
    left: int | float
    settlements: list[SettlementOut] = []
    baseAmount: int | float | None = None  # the entered amount when a rule computes `amount`
    rule: RuleInfoOut | None = None


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

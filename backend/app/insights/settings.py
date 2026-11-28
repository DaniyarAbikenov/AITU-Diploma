"""User thresholds of the smart insights in one place. The knowledge base names them (userSmallThreshold,
userUrgencyHorizon, userAbsoluteMin/RelativeMin, userTargetMonths, userDebtCap, ...) but does not fix values: these
are product defaults, shown as «настроено по умолчанию» and editable in the profile. They are not norms."""
from dataclasses import dataclass

DEFAULTS: dict[str, dict] = {
    "materialityMinor": {"value": 5_000_00, "label": "Минимальная заметная сумма, ₸", "unit": "money"},
    "relativeMin": {"value": 0.02, "label": "Минимальная доля бюджета", "unit": "share"},
    "urgencyHorizonDays": {"value": 14, "label": "Горизонт срочности, дней", "unit": "days"},
    "targetReserveMonths": {"value": 3, "label": "Целевой резерв, месяцев расходов", "unit": "months"},
    "targetRunwayDays": {"value": 30, "label": "Желаемый запас без дохода, дней", "unit": "days"},
    "debtCap": {"value": 0.4, "label": "Порог долговой нагрузки, доля дохода", "unit": "share"},
    "toleranceMinor": {"value": 100_00, "label": "Допуск сверки остатков, ₸", "unit": "money"},
    "staleBalanceDays": {"value": 7, "label": "Остаток считается устаревшим через, дней", "unit": "days"},
    "incomeGraceDays": {"value": 3, "label": "Допуск задержки выплаты, дней", "unit": "days"},
    "uncertainShare": {"value": 0.1, "label": "Доля расходов с неясной категорией для подсказки", "unit": "share"},
}


@dataclass
class Thresholds:
    values: dict

    def __getattr__(self, name: str):
        try:
            return self.values[name]
        except KeyError:
            raise AttributeError(name) from None


def for_user(settings: dict | None) -> Thresholds:
    custom = (settings or {}).get("thresholds", {})
    return Thresholds({k: custom.get(k, d["value"]) for k, d in DEFAULTS.items()})


def describe(settings: dict | None) -> list[dict]:
    custom = (settings or {}).get("thresholds", {})
    def shown(k: str, v):
        return v / 100 if DEFAULTS[k]["unit"] == "money" else v

    return [{"key": k, "label": d["label"], "unit": d["unit"], "value": shown(k, custom.get(k, d["value"])),
             "default": shown(k, d["value"]), "isDefault": k not in custom} for k, d in DEFAULTS.items()]

"""Static reference data: category taxonomy, scenario presets, obligation heuristics."""

# id, name, color token (frontend chart token), CPI series code, fx_sensitivity (expert estimate in [0, 1])
CATEGORIES: list[tuple[str, str, str, str | None, float]] = [
    ("food", "Продукты", "chart-1", "cpi_food", 0.25),
    ("cafe", "Кафе и доставка", "chart-2", "cpi_services", 0.10),
    ("transport", "Транспорт", "chart-3", "cpi_transport", 0.30),
    ("housing", "Жильё и ЖКУ", "chart-4", "cpi_housing", 0.0),
    ("credit", "Кредиты и рассрочки", "chart-5", None, 0.0),
    ("health", "Здоровье", "chart-3", "cpi_health", 0.45),
    ("shopping", "Покупки", "chart-2", "cpi_nonfood", 0.60),
    ("transfers", "Переводы", "chart-5", None, 0.0),
    ("income", "Доход", "chart-3", None, 0.0),
    ("other", "Другое", "chart-5", None, 0.0),
]

# Categories whose payments are modelled explicitly as obligations (not as variable spending).
FIXED_CATEGORIES = {"housing", "credit"}
NON_SPENDING = {"income"}

# Keyword -> category. Lower-case substring match on the merchant string; first match wins.
KEYWORDS: list[tuple[str, str]] = [
    ("зарплата", "income"), ("аванс", "income"), ("пополнение", "income"),
    ("рассрочка", "credit"), ("кредит", "credit"), ("loan", "credit"),
    ("аренда", "housing"), ("алсеко", "housing"), ("жку", "housing"), ("коммунал", "housing"),
    ("magnum", "food"), ("small", "food"), ("galmart", "food"), ("ramstore", "food"), ("супермаркет", "food"),
    ("glovo", "cafe"), ("wolt", "cafe"), ("coffee", "cafe"), ("кофе", "cafe"), ("burger", "cafe"), ("kfc", "cafe"),
    ("yandex go", "transport"), ("onay", "transport"), ("азс", "transport"), ("helios", "transport"), ("такси", "transport"),
    ("europharma", "health"), ("аптека", "health"), ("pharm", "health"), ("клиника", "health"),
    ("kaspi магазин", "shopping"), ("wildberries", "shopping"), ("ozon", "shopping"), ("technodom", "shopping"),
    ("перевод", "transfers"),
]

SUBSCRIPTION_HINTS = ("yandex plus", "netflix", "spotify", "youtube premium", "apple", "ivi", "kinopoisk")

PRESETS: list[dict] = [
    {"id": "fx15", "name": "Тенге −15%", "description": "Импортные товары и техника дорожают",
     "shocks": [{"type": "fx", "value": 15}]},
    {"id": "inf15", "name": "Инфляция 15%", "description": "Цены на продукты и услуги растут быстрее",
     "shocks": [{"type": "inflation", "value": 15}]},
    {"id": "inc20", "name": "Доход −20%", "description": "Сокращение премии или часов",
     "shocks": [{"type": "income", "value": 20}]},
    {"id": "job3", "name": "Потеря работы на 3 месяца", "description": "Доход 0 на время поиска",
     "shocks": [{"type": "jobloss", "value": 3}]},
]

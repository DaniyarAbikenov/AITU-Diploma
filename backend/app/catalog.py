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
    ("subscriptions", "Подписки и сервисы", "chart-1", "cpi_services", 0.90),
    ("leisure", "Досуг и путешествия", "chart-4", "cpi_services", 0.30),
    ("transfers", "Переводы", "chart-5", None, 0.0),
    ("income", "Доход", "chart-3", None, 0.0),
    ("other", "Другое", "chart-5", None, 0.0),
]

# Categories whose payments are modelled explicitly as obligations (not as variable spending).
FIXED_CATEGORIES = {"housing", "credit"}
NON_SPENDING = {"income"}

# Keyword -> category. Lower-case substring match on the merchant string; first match wins.
KEYWORDS: list[tuple[str, str]] = [
    # own savings first: "Отбасы банк. Пополнение депозита" must not be read as income
    # Halyk: "Поступление на счет: <payer>" is salary or stipend, fees are prefixed by the parser
    ("поступление на счет", "income"), ("комиссия банка", "other"),
    ("пополнение депозита", "transfers"), ("депозит", "transfers"),
    ("зарплата", "income"), ("аванс", "income"), ("пополнение", "income"),
    ("рассрочка", "credit"), ("кредит", "credit"), ("loan", "credit"),
    ("аренда", "housing"), ("алсеко", "housing"), ("жку", "housing"), ("коммунал", "housing"), ("ерц", "housing"),
    ("казахтелеком", "housing"), ("қазақтелеком", "housing"), ("астана-энергосбыт", "housing"), ("тепло", "housing"),
    ("водоканал", "housing"), ("osi ", "housing"),
    # subscriptions and online services (mostly billed in USD)
    ("spotify", "subscriptions"), ("netflix", "subscriptions"), ("youtube", "subscriptions"), ("apple.com", "subscriptions"),
    ("yandex plus", "subscriptions"), ("яндекс плюс", "subscriptions"), ("openai", "subscriptions"), ("chatgpt", "subscriptions"),
    ("anthropic", "subscriptions"), ("claude", "subscriptions"), ("google*", "subscriptions"), ("google ", "subscriptions"),
    ("telegram", "subscriptions"), ("hostinger", "subscriptions"), ("lovable", "subscriptions"), ("github", "subscriptions"),
    ("notion", "subscriptions"), ("figma", "subscriptions"), ("cursor", "subscriptions"), ("ivi.ru", "subscriptions"),
    ("kinopoisk", "subscriptions"), ("beeline", "subscriptions"), ("kcell", "subscriptions"),
    ("tele2", "subscriptions"), ("altel", "subscriptions"),
    # cafe before food: "Coffee market" is a cafe
    ("glovo", "cafe"), ("wolt", "cafe"), ("yandex.eda", "cafe"), ("яндекс еда", "cafe"), ("chocofood", "cafe"),
    ("coffee", "cafe"), ("кофе", "cafe"), ("espresso", "cafe"), ("q-tea", "cafe"), (" tea", "cafe"), ("burger", "cafe"), ("kfc", "cafe"),
    ("pizza", "cafe"), ("пицц", "cafe"), ("dodo", "cafe"), ("restaurant", "cafe"), ("ресторан", "cafe"),
    ("кафе", "cafe"), ("cafe", "cafe"), ("coffe", "cafe"), ("stolovaya", "cafe"), ("столовая", "cafe"), ("canteen", "cafe"), ("food", "cafe"), ("doner", "cafe"), ("донер", "cafe"), ("sushi", "cafe"),
    ("суши", "cafe"), ("mokko", "cafe"), ("starbucks", "cafe"), ("bahandi", "cafe"), ("salam bro", "cafe"),
    ("magnum", "food"), ("small", "food"), ("galmart", "food"), ("ramstore", "food"), ("супермаркет", "food"),
    ("freshmarket", "food"), ("market", "food"), ("маркет", "food"), ("anvar", "food"), ("arzan", "food"),
    ("minmax", "food"), ("лимон", "food"), ("продукт", "food"), ("toimart", "food"), ("metro", "food"),
    ("yandex go", "transport"), ("yandex.go", "transport"), ("яндекс go", "transport"), ("onay", "transport"),
    ("avtobys", "transport"), ("lrt", "transport"), ("проезд", "transport"), ("самокат", "transport"),
    ("jet.", "transport"), ("whoosh", "transport"), ("indriver", "transport"), ("азс", "transport"),
    ("helios", "transport"), ("qazaq oil", "transport"), ("sinooil", "transport"), ("такси", "transport"),
    ("парковк", "transport"), ("avtodrom", "transport"), ("автодром", "transport"),
    ("europharma", "health"), ("аптека", "health"), ("pharm", "health"), ("клиника", "health"), ("стоматолог", "health"),
    ("invitro", "health"), ("олимп", "health"),
    ("kaspi travel", "leisure"), ("aviata", "leisure"), ("air astana", "leisure"), ("fly arystan", "leisure"),
    ("cinema", "leisure"), ("кино", "leisure"), ("chaplin", "leisure"), ("kinopark", "leisure"), ("ticketon", "leisure"),
    ("steam", "leisure"), ("playstation", "leisure"), ("фитнес", "leisure"), ("fitness", "leisure"),
    ("kaspi магазин", "shopping"), ("wildberries", "shopping"), ("ozon", "shopping"), ("technodom", "shopping"),
    ("sulpak", "shopping"), ("mechta", "shopping"), ("e-teсh", "shopping"), ("e-tech", "shopping"), ("lamoda", "shopping"),
    ("flip.kz", "shopping"), ("hamply", "shopping"), ("baby", "shopping"),
    ("перевод", "transfers"),
]

SUBSCRIPTION_HINTS = ("yandex plus", "netflix", "spotify", "youtube premium", "apple", "ivi", "kinopoisk", "openai",
                      "chatgpt", "anthropic", "claude", "telegram premium", "google")

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

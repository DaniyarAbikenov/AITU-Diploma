# Каркас приложения: архитектура, модель данных, API

*Основа: [feature-evaluation.md](../feature-evaluation.md). Принцип: один репозиторий, бэкенд владеет всей математикой, фронтенд только показывает и собирает ввод.*

## 1. Стек (рекомендация и почему)

| Слой | Выбор | Почему |
|---|---|---|
| Бэкенд | **Python 3.12 + FastAPI** | Прогнозы, Monte Carlo и ML живут в Python, не нужен второй язык. Автогенерация OpenAPI даёт контракт для фронта |
| БД | **PostgreSQL 16** + SQLAlchemy 2 + Alembic | Транзакции, JSONB для сырых строк выписки, SQL-агрегации |
| Парсинг выписок | pdfplumber (+ pandas) | Выписки Kaspi/Halyk/Freedom текстовые PDF; OCR не нужен |
| Прогнозы | pandas, numpy, statsmodels (ETS), scikit-learn / LightGBM | Бейзлайны + модель; Monte Carlo на numpy |
| Категоризация | Правила (словарь мерчантов) + sklearn TF-IDF/LogReg; LLM только как fallback, за интерфейсом | Измеримая точность, работает офлайн |
| Фоновые задачи | **ARQ или RQ + Redis** (импорт, пересчёт прогноза, обновление макро-данных) | Проще Celery; либо без Redis: FastAPI BackgroundTasks на старте |
| Фронтенд | **React 18 + TypeScript + Vite** | |
| UI | Tailwind + shadcn/ui, графики **Apache ECharts** (fan-chart с интервалами удобнее, чем в Recharts) | |
| Данные на фронте | TanStack Query, типы генерируются из OpenAPI (openapi-typescript) | Нет ручного расхождения контракта |
| i18n | react-i18next: **ru** (основной), en; kk по возможности | Целевая аудитория КЗ |
| Запуск | Docker Compose: `api`, `worker`, `db`, `redis`, `web` | Воспроизводимость для защиты |
| Тесты | pytest (+ property-based для финансовой математики), Vitest, Playwright (1–2 e2e) | |

Альтернатива, если хочется один язык: Next.js + tRPC, но тогда ML-часть всё равно уйдёт в Python-сервис. Для диплома с ML-ядром Python-бэкенд проще.

## 2. Структура репозитория

```
resilience/
  backend/
    app/
      main.py                # FastAPI, роутеры, CORS
      core/                  # config, security (JWT), db session
      modules/
        auth/                # регистрация, логин
        accounts/            # счета, валюты
        imports/             # загрузка выписок, парсеры по банкам
          parsers/           # kaspi.py, halyk.py, freedom.py, base.py
        transactions/        # CRUD, дедупликация, переводы между своими счетами
        categorization/      # правила, модель, обратная связь
        obligations/         # кредиты, рассрочки, подписки, регулярные платежи
        goals/               # цели накоплений
        forecast/            # прогноз трат, баланса, Monte Carlo
        resilience/          # индекс, компоненты, КДН, runway
        scenarios/           # what-if и стресс-тесты
        macro/               # курсы НБРК, ИПЦ, цены; личная инфляция
        insights/            # правила рекомендаций и алертов
      jobs/                  # фоновые задачи, расписание обновления макро
    tests/
    alembic/
  frontend/
    src/
      api/                   # сгенерированный клиент
      features/              # по модулям бэка (см. §5)
      components/            # общие UI
      pages/
      i18n/
  research/                  # ноутбуки: бэктесты, оценка категоризации, синтетика
  data/synthetic/            # генератор синтетических выписок
  docker-compose.yml
  docs/openapi.json          # артефакт контракта
```

Правило зависимостей: `forecast`, `resilience`, `scenarios` зависят от `transactions`, `obligations`, `macro`, но не друг от друга по циклу. `scenarios` вызывает движок `forecast` с изменёнными входами.

## 3. Модель данных (основные таблицы)

- `users` (id, email, password_hash, city, base_currency=KZT, created_at)
- `accounts` (id, user_id, bank, name, currency, kind: card/deposit/cash/credit, include_in_balance)
- `import_batches` (id, user_id, bank, file_hash, period_from, period_to, status, parsed_count, error_report JSONB)
- `transactions` (id, user_id, account_id, batch_id, booked_at, amount_minor BIGINT, currency, direction: in/out, raw_description, counterparty, category_id, category_source: rule/model/user, is_internal_transfer BOOL, dedup_key UNIQUE per user, meta JSONB)
- `categories` (id, parent_id, code, name_ru, name_en, cpi_group, fx_sensitivity NUMERIC)  — `cpi_group` связывает категорию с группой ИПЦ, `fx_sensitivity` задаёт pass-through курса
- `merchant_rules` (id, user_id NULL=global, pattern, match_type, category_id, priority)
- `counterparty_labels` (user_id, counterparty, category_id) — пометки переводов физлицам
- `obligations` (id, user_id, kind: loan/installment/credit_card/subscription/rent/utility, name, monthly_payment_minor, remaining_payments, next_due, currency, interest_rate NULL, detected_from_tx BOOL)
- `income_sources` (id, user_id, name, amount_minor, currency, cadence, next_date, volatility_class)
- `goals` (id, user_id, name, target_minor, deadline, current_minor, priority)
- `forecast_runs` (id, user_id, kind, horizon_days, params JSONB, result JSONB, created_at, model_version) — храним для воспроизводимости и оценки
- `scenarios` (id, user_id, name, definition JSONB, result_run_id)
- `resilience_snapshots` (id, user_id, as_of, components JSONB, score, p_shortfall_90d, runway_months)
- `macro_series` (series_code, as_of, value) — USDKZT, EURKZT, RUBKZT, BASE_RATE, CPI_YOY, CPI_<group>, BRENT, FOOD_PRICE_<city>_<item>
- `insights` (id, user_id, type, severity, payload JSONB, created_at, dismissed_at)

Деньги хранятся в минорных единицах целыми числами, валюта всегда рядом. Даты в UTC, отображение в Asia/Almaty.

## 4. Ключевые алгоритмы (контракт для бэкенда)

1. **Дедупликация импорта**: `dedup_key = hash(account, booked_at, amount, normalized_description, seq)`; повторная загрузка не создаёт дублей.
2. **Внутренние переводы**: пары out/in с одинаковой суммой в окне ±1 день между счетами пользователя → `is_internal_transfer=true`, исключаются из расходов и доходов.
3. **Категоризация**: порядок — пользовательская пометка → правила мерчантов → модель (если уверенность ≥ порога) → «Без категории». Правка пользователя создаёт правило и попадает в обучающую выборку.
4. **Прогноз трат до конца месяца**: бейзлайн `темп × дни`; модель v1 = регулярные платежи + остаточные дневные траты по ETS/дню недели; на выходе медиана и интервалы 50/80%.
5. **Прогноз баланса**: простая симуляция траекторий — доходы по календарю, обязательства по графику, остаточные траты из эмпирического распределения. N=5000 траекторий. Метрики на выходе: `p_shortfall` на 30/60/90 дней, день первого разрыва (медиана и 10-й перцентиль), runway.
6. **Индекс устойчивости**: компоненты runway, КДН, норма сбережений, волатильность, валютный разрыв; нормализация в 0–100, веса в конфиге, у каждого компонента `explanation_code` для текста на фронте. Основной показатель — `p_shortfall_90d`, индекс — производная.
7. **Сценарии**: `definition` = список шоков (`fx_shock`, `inflation_shock`, `income_change`, `one_off_expense`, `new_installment`, `job_loss`); применяются к входам симуляции, результат сравнивается с базовым прогоном.
8. **Личная инфляция**: `Σ вес_группы_пользователя × ИПЦ_группы`, вес = доля трат за последние 3 мес.; выводим вклад каждой группы.
9. **Макро-ингест**: ежедневно НБРК `rates_all.xml` (HTTPS); ежемесячно ИПЦ и еженедельно цены Бюро нацстатистики — загрузка из файлов/таблиц, парсер за интерфейсом, чтобы можно было подложить CSV при недоступности сайта.

## 5. API (v1, префикс `/api/v1`)

| Группа | Эндпоинты |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /me`, `PATCH /me` (город, валюта) |
| Accounts | `GET/POST /accounts`, `PATCH/DELETE /accounts/{id}` |
| Imports | `POST /imports` (multipart: файл, банк, account_id), `GET /imports/{id}` (статус, отчёт об ошибках), `GET /imports` |
| Transactions | `GET /transactions?from&to&category&account&q&page`, `PATCH /transactions/{id}` (категория, internal), `POST /transactions` (ручная), `POST /transactions/bulk-categorize` |
| Categories | `GET /categories`, `GET/POST/DELETE /merchant-rules`, `PUT /counterparty-labels` |
| Dashboard | `GET /dashboard/summary?month=YYYY-MM` (доход, расход, чистый поток, сравнение с прошлым месяцем, топ категорий, аномалии) |
| Forecast | `GET /forecast/month-end` (медиана, интервалы, vs прошлый месяц, драйверы), `GET /forecast/balance?days=60` (траектории по дням: p10/p50/p90, дни риска) |
| Obligations | `GET/POST /obligations`, `PATCH/DELETE /obligations/{id}`, `GET /obligations/calendar?months=12`, `GET /obligations/detected` (кандидаты из выписки для подтверждения) |
| Income | `GET/POST /income-sources`, `PATCH/DELETE` |
| Goals | `GET/POST /goals`, `PATCH/DELETE`, `GET /goals/{id}/projection` |
| Resilience | `GET /resilience` (score, p_shortfall, runway, компоненты, объяснения), `GET /resilience/history` |
| Scenarios | `GET /scenarios/presets`, `POST /scenarios/run` (список шоков → сравнение с базой), `GET/POST /scenarios` (сохранённые) |
| Macro | `GET /macro/overview` (4–6 индикаторов + «почему важно»), `GET /macro/series/{code}?from&to`, `GET /macro/personal-inflation`, `GET /macro/city-prices?city` |
| Insights | `GET /insights`, `POST /insights/{id}/dismiss` |
| Export | `GET /export/report.pdf` (опционально) |

Единые правила: ошибки в формате RFC 7807, пагинация курсором, суммы в минорных единицах + `currency`, все прогнозные ответы содержат `model_version` и `as_of`.

## 6. Экраны фронтенда

1. **Онбординг**: регистрация → город → загрузка первой выписки (drag&drop, выбор банка, прогресс, отчёт «разобрано N операций, M требуют проверки») → доход и обязательства (подтверждение найденных).
2. **Главная (Dashboard)**: карточка «К концу месяца вы потратите ~X (±Y)» с темпом и сравнением; индикатор устойчивости; топ-3 инсайта; мини-график баланса на 30 дней.
3. **Расходы**: транзакции с фильтрами, быстрая перекатегоризация (создаёт правило), очередь «проверьте категории», сравнение месяц к месяцу.
4. **Прогноз**: fan-chart баланса на 60 дней, дни риска, регулярные платежи на оси.
5. **Долги и обязательства**: календарь платежей на 12 месяцев, КДН и его тренд, симулятор «новая рассрочка».
6. **Устойчивость**: вероятность разрыва, runway, компоненты-светофоры с «что улучшить».
7. **Сценарии**: пресеты и конструктор шоков, сравнение «база vs сценарий» (до/после).
8. **Мир и цены (макро)**: индикаторы с подписью «почему это важно вам», личная инфляция с вкладом категорий, цены по городу. Без «прогнозов кризиса».
9. **Цели**: прогресс, срок достижения при текущем темпе, необходимый взнос.
10. **Настройки/данные**: счета, правила категорий, удаление всех данных (приватность).

## 7. Нефункциональное

- **Приватность**: выписки содержат ФИО, ИИН, номер карты. При парсинге маскировать (оставлять последние 4 цифры), исходный PDF после разбора удалять или шифровать; логи без персональных данных; кнопка «удалить все мои данные».
- **Воспроизводимость оценки**: `forecast_runs` хранит параметры и версию модели; ноутбуки в `research/` берут данные из тех же функций.
- **Синтетические данные**: `data/synthetic` генерирует выписки в форматах банков (для тестов парсеров и демонстрации без реальных персональных данных).
- **Наблюдаемость**: структурные логи, `/healthz`, метрики времени пересчёта прогноза.

## 8. Порядок реализации (вертикальные срезы)

1. Каркас, auth, Docker, CI; синтетический генератор.
2. Импорт Kaspi + транзакции + ручная категоризация + дашборд расходов.
3. Автокатегоризация + оценка точности.
4. Обязательства/доходы + прогноз месяца + баланс (бейзлайн, затем модель).
5. Monte Carlo + индекс устойчивости.
6. Сценарии.
7. Макро-ингест + личная инфляция.
8. Цели, инсайты, полировка, оценка и юзабилити-тест.

Каждый срез заканчивается рабочим экраном и тестами, чтобы в любой момент было что показать руководителю.

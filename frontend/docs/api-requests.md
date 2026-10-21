# Предложения к API
- `GET /obligations/dti-history?months=12` — история КДН для графика тренда (в §5 нет).
- Auth: выдавать токен в httpOnly cookie вместо тела ответа.
- `POST /scenarios/run`: принимать `days` (30/60/90) и возвращать готовые дельта-метрики (`deltas[]`).

# Решения
- Роутинг: TanStack Router (вместо React Router) — платформа фиксирует этот роутер; файловые маршруты в `src/routes`, приватные экраны под `_app`.
- Mock: вместо MSW — in-memory mock-слой в `src/api/mock.ts` за тем же интерфейсом `api.*`. Переключение: `VITE_API_MODE=real`, `VITE_API_URL`.
- Типы API пока вручную (`src/api/types.ts`), т.к. `openapi.json` ещё нет. После его появления: `npx openapi-typescript docs/openapi.json -o src/api/schema.d.ts` и `openapi-fetch` внутри `http()`.
- Токен в mock-режиме — sessionStorage. Для реального бэкенда рекомендуем httpOnly cookie (см. api-requests.md).
- Графики: ECharts (SVG-рендер), fan-chart = стек прозрачной нижней границы + полос 80% и 50%.
- i18n: тексты пока на русском прямо в компонентах; вынос в react-i18next — следующий шаг.
- Дата «сегодня» в моках зафиксирована (19.10.2026) для детерминированности.

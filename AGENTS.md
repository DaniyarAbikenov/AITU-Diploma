<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- All API access goes through `src/api/client.ts` (`api` + `q` queryOptions); `VITE_API_MODE=real` switches from the in-memory mock (`src/api/mock.ts`) to the backend — keeps screens independent of backend readiness.
- `src/api/types.ts` is the hand-mirrored contract until `docs/openapi.json` exists; then replace it with generated types, never hand-edit both.
- Charts use ECharts via `src/components/charts.tsx` only (lazy, browser-only, colors resolved from CSS tokens) — echarts breaks SSR if imported directly.
- Every forecast UI shows a range and `EstimateNote` (as_of + model_version) — product honesty requirement.
- Pure business rules (DTI thresholds, payments, formatting) live in `src/lib/*.ts` with tests next to them.

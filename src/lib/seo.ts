export const pageHead = (title: string, description: string) => () => ({
  meta: [
    { title: `${title} — Запас` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Запас` },
    { property: "og:description", content: description },
  ],
});

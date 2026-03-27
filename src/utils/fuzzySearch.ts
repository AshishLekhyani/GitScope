/** Simple fuzzy score: all chars of query appear in order in target. */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q.length) return 1;
  let qi = 0;
  let score = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 1 / (i + 1);
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

export function fuzzySort<T>(
  items: T[],
  query: string,
  getLabel: (item: T) => string
): T[] {
  if (!query.trim()) return items;
  return [...items]
    .map((item) => ({ item, s: fuzzyScore(query, getLabel(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}

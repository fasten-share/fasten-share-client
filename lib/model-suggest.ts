/**
 * Near-miss suggestions for model search.
 *
 * Discovery matches model names exactly (the server looks up a Redis index key
 * built from the lowercased name), so one wrong character returns nothing at
 * all. Ranking the names that do exist against what the user typed turns that
 * dead end into a one-click fix.
 */

/** Bounded edit distance. Returns `limit + 1` once it is clear the gap is wider. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Single row of the DP matrix; only the previous row is ever needed.
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    // Every later row can only grow, so an exhausted budget ends it here.
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/** How far off a candidate may be before it stops being a plausible typo. */
function tolerance(keyword: string): number {
  if (keyword.length <= 4) return 1;
  if (keyword.length <= 8) return 2;
  return 3;
}

interface Scored { model: string; rank: number; distance: number }

/**
 * Ranks `available` names against `keyword`, best first. Containment beats
 * edit distance: someone who typed "qwen" wants every qwen build listed, not
 * whichever unrelated name happens to be three edits away.
 */
export function suggestModels(
  keyword: string,
  available: readonly string[],
  limit = 5,
): string[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [];

  const budget = tolerance(needle);
  const seen = new Set<string>();
  const scored: Scored[] = [];

  for (const model of available) {
    const candidate = model.toLowerCase();
    // An exact hit is not a suggestion; the search already returned it.
    if (candidate === needle || seen.has(candidate)) continue;
    seen.add(candidate);

    if (candidate.startsWith(needle)) {
      scored.push({ model, rank: 0, distance: candidate.length - needle.length });
      continue;
    }
    if (candidate.includes(needle)) {
      scored.push({ model, rank: 1, distance: candidate.length - needle.length });
      continue;
    }
    const distance = editDistance(needle, candidate, budget);
    if (distance <= budget) scored.push({ model, rank: 2, distance });
  }

  scored.sort((left, right) =>
    left.rank - right.rank
    || left.distance - right.distance
    || left.model.localeCompare(right.model));

  return scored.slice(0, limit).map((entry) => entry.model);
}

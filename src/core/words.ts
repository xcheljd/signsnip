/**
 * Counts in words, for the UI and its messages: "1 sign", "2 signs", "0 saved batches".
 * The one place that pluralises, so a noun like "batch" can't come out as "batchs".
 */
export function pluralOf(noun: string): string {
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}
/** `count(3, "row")` = "3 rows"; pass `plural` for irregular nouns */
export function count(n: number, noun: string, plural = pluralOf(noun)): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

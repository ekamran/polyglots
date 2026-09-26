// Shared by the review and translate screens: both send batches to the same
// agent, so both offer the same ladder.
const BATCH_SIZES = [10, 25, 50, 75, 100]

// A locale team can set any batch size in config.json, and whatever they set has
// to stay reachable after the first keypress, so it joins the ladder in order.
export function batchSizeChoices(configured: number): number[] {
  if (BATCH_SIZES.includes(configured)) return BATCH_SIZES
  return [...BATCH_SIZES, configured].sort((a, b) => a - b)
}

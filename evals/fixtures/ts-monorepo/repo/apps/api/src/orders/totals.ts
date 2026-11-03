export function total(prices: number[]): number {
  return prices.reduce((a, b) => a + b, 0);
}

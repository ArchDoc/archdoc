const PRICES: Record<string, number> = { mug: 1200, tee: 2500 };

export function priceCart(lines: { sku: string; quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + (PRICES[l.sku] ?? 0) * l.quantity, 0);
}

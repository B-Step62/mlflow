/**
 * Formats a cost value in USD with appropriate precision.
 * Shows 2-6 decimal places depending on the value.
 */
export const formatCostUSD = (cost: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(cost);
};

/**
 * Formats cost values for dense table cells and aggregate headers.
 * Keeps precision to the nearest 0.001 USD and avoids rendering small
 * non-zero costs as "$0.00".
 */
export const formatCostUSDCompact = (cost: number): string => {
  if (cost > 0 && cost < 0.001) {
    return '<$0.001';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.abs(cost) < 0.01 ? 3 : 2,
    maximumFractionDigits: 3,
  }).format(cost);
};

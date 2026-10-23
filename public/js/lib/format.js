/**
 * Client mirror of utils/format.js, so a price shown by a script reads the
 * same as one rendered by a template. The preview card used to build
 * '$' + price by hand, which showed "$1340.5", and nothing at all for Free.
 */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** 1340.5 -> "$1,340.50"; 0 -> "Free"; null -> "Price unavailable". Same rules as item-card.ejs. */
export function formatPrice(value) {
  if (value === null || value === undefined || value === '') return 'Price unavailable';
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 'Price unavailable';
  if (n === 0) return 'Free';
  return usd.format(n);
}

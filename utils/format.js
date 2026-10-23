/**
 * Presentation formatters shared by the server (via app.locals) and, in a
 * mirrored form, by the client (public/js/lib/format.js).
 *
 * These exist so a bare number can never be rendered as currency again —
 * `$<%= price.toFixed(2) %>` appeared in five templates and produced "$25.00"
 * with no locale handling and no thousands separator.
 */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/** 1340.5 -> "$1,340.50" */
function money(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return usd.format(Number.isFinite(n) ? n : 0);
}

/** 1340.5 -> "$1,341" — for hero figures where cents are noise. */
function moneyShort(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return usd.format(Math.round(Number.isFinite(n) ? n : 0)).replace(/\.00$/, '');
}

/** A Date or ISO string -> "today" | "3 days ago" | "2 months ago" */
function relative(date) {
  if (!date) return '';
  const then = new Date(date);
  if (Number.isNaN(then.getTime())) return '';

  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return 'last month';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  return years === 1 ? 'last year' : `${years} years ago`;
}

/** "5 items" / "1 item" — so "1 categories" can't happen again. */
function plural(count, singular, pluralForm) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : (pluralForm || singular + 's')}`;
}

/** Marketplace name -> badge modifier class. Anything not scraped is neutral. */
function platformClass(platform) {
  const key = String(platform || '').toLowerCase();
  if (key.includes('offerup')) return 'badge--offerup';
  if (key.includes('facebook')) return 'badge--fb';
  return 'badge--market';
}

/** Hostname of a listing URL, for the outbound link label. */
function hostLabel(link) {
  if (!link) return '';
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch (err) {
    return 'listing';
  }
}

module.exports = { money, moneyShort, relative, plural, platformClass, hostLabel };

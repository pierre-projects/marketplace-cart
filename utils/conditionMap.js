const CONDITIONS = ['New', 'Like New', 'Good', 'Fair', 'Poor'];

// Mapping keywords (lowercase) → canonical condition
// Order matters: check more specific terms first ("like new" before "new")
const CONDITION_PATTERNS = [
  { keywords: ['like new', 'likenew'], canonical: 'Like New' },
  { keywords: ['new', 'brand new', 'sealed'], canonical: 'New' },
  { keywords: ['very good', 'excellent'], canonical: 'Good' },
  { keywords: ['good'], canonical: 'Good' },
  { keywords: ['fair', 'acceptable', 'decent'], canonical: 'Fair' },
  { keywords: ['poor', 'parts', 'salvage', 'broken'], canonical: 'Poor' },
];

function normalizeCondition(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  for (const { keywords, canonical } of CONDITION_PATTERNS) {
    if (keywords.some(kw => lower.includes(kw))) {
      return canonical;
    }
  }
  return raw;
}

module.exports = { normalizeCondition, CONDITIONS };

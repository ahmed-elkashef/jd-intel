/**
 * An explicit ISO timestamp with a timezone, or null. Calendar-only and
 * timezone-free source values cannot establish an original publication instant.
 * Keep the source value separately so a caller can resolve it later.
 */
export function awarePublicationInstant(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i);
  if (!m) return null;
  const [, year, month, day, hour, minute, second = '0'] = m;
  const y = Number(year);
  const leap = y % 400 === 0 || (y % 4 === 0 && y % 100 !== 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1];
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

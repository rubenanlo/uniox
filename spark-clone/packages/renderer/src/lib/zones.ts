/**
 * Time zone choices for the zone picker: readable city / region labels, the
 * current offset, and search that also understands a few country names
 * (IANA ids are cities, so "Brazil" wouldn't match "America/Sao_Paulo").
 */

export interface ZoneOption {
  id: string;
  /** "São Paulo" style: the last segment, underscores as spaces. */
  city: string;
  /** "America", "Europe", … */
  region: string;
  /** "GMT-3" at `now`. */
  offset: string;
}

/** Country and common names → zones, for search only. */
const ALIASES: Record<string, string[]> = {
  'America/Sao_Paulo': ['brazil', 'brasil', 'rio de janeiro', 'brasilia'],
  'America/New_York': ['eastern', 'usa', 'united states', 'boston', 'washington', 'nyc', 'et'],
  'America/Chicago': ['central', 'usa', 'united states', 'texas', 'houston', 'dallas', 'ct'],
  'America/Denver': ['mountain', 'usa', 'colorado'],
  'America/Los_Angeles': ['pacific', 'usa', 'california', 'san francisco', 'seattle', 'pt'],
  'America/Mexico_City': ['mexico'],
  'America/Bogota': ['colombia'],
  'America/Lima': ['peru'],
  'America/Santiago': ['chile'],
  'America/Argentina/Buenos_Aires': ['argentina'],
  'America/Toronto': ['canada', 'ontario'],
  'Europe/London': ['uk', 'united kingdom', 'england', 'britain', 'gmt'],
  'Europe/Madrid': ['spain', 'españa', 'barcelona'],
  'Europe/Paris': ['france'],
  'Europe/Berlin': ['germany', 'deutschland'],
  'Europe/Rome': ['italy', 'milan'],
  'Europe/Lisbon': ['portugal'],
  'Europe/Amsterdam': ['netherlands', 'holland'],
  'Europe/Zurich': ['switzerland', 'geneva'],
  'Africa/Lagos': ['nigeria'],
  'Africa/Nairobi': ['kenya'],
  'Africa/Johannesburg': ['south africa'],
  'Asia/Kolkata': ['india', 'delhi', 'mumbai', 'bangalore', 'ist'],
  'Asia/Shanghai': ['china', 'beijing'],
  'Asia/Tokyo': ['japan'],
  'Asia/Singapore': ['singapore'],
  'Asia/Dubai': ['uae', 'emirates', 'abu dhabi'],
  'Australia/Sydney': ['australia', 'melbourne'],
  'Pacific/Auckland': ['new zealand'],
};

const CITY_FIX: Record<string, string> = { Sao_Paulo: 'São Paulo' };

export function zoneOffset(id: string, now = Date.now()): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

export function zoneOption(id: string, now = Date.now()): ZoneOption {
  const parts = id.split('/');
  const last = parts[parts.length - 1] ?? id;
  return {
    id,
    city: CITY_FIX[last] ?? last.replace(/_/g, ' '),
    region: parts.length > 1 ? parts[0]! : '',
    offset: zoneOffset(id, now),
  };
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Zones matching `query` (city, region, id, offset or a country alias),
 * best matches first; everything when the query is empty.
 */
export function searchZones(options: ZoneOption[], query: string): ZoneOption[] {
  const q = fold(query.trim());
  if (!q) return options;
  const scored: [ZoneOption, number][] = [];
  for (const o of options) {
    const city = fold(o.city);
    const aliases = ALIASES[o.id] ?? [];
    let score = -1;
    if (city === q || aliases.some((a) => fold(a) === q)) score = 0;
    else if (city.startsWith(q) || aliases.some((a) => fold(a).startsWith(q))) score = 1;
    else if (fold(o.id).includes(q) || fold(o.offset) === q) score = 2;
    else if (city.includes(q)) score = 3;
    if (score >= 0) scored.push([o, score]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([o]) => o);
}

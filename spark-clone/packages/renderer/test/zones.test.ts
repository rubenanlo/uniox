import { describe, expect, it } from 'vitest';
import { searchZones, zoneOption } from '../src/lib/zones';

const all = [
  'America/Sao_Paulo',
  'America/New_York',
  'Europe/Paris',
  'Asia/Kolkata',
  'Europe/London',
].map((z) => zoneOption(z, Date.UTC(2026, 9, 8)));

describe('zone search', () => {
  it('labels zones by city with the offset', () => {
    expect(zoneOption('America/Sao_Paulo', Date.UTC(2026, 9, 8))).toEqual({
      id: 'America/Sao_Paulo',
      city: 'São Paulo',
      region: 'America',
      offset: 'GMT-3',
    });
  });

  it('finds zones by city, accent-free text, country or offset', () => {
    expect(searchZones(all, 'sao')[0]!.id).toBe('America/Sao_Paulo');
    expect(searchZones(all, 'Brazil')[0]!.id).toBe('America/Sao_Paulo');
    expect(searchZones(all, 'france')[0]!.id).toBe('Europe/Paris');
    expect(searchZones(all, 'india')[0]!.id).toBe('Asia/Kolkata');
    expect(searchZones(all, 'gmt-3').map((o) => o.id)).toEqual(['America/Sao_Paulo']);
    expect(searchZones(all, '')).toHaveLength(5);
  });
});

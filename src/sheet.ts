import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { CityGroup, Club, ClubChange, FeatureValue, FieldChange, Sheet } from './types.js';

/** Стабільний короткий id (влазить у callback_data ≤ 64 байти). */
export const makeId = (name: string): string => createHash('sha1').update(name).digest('hex').slice(0, 10);

const cell = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

const parseBool = (value: unknown): FeatureValue => {
  const v = cell(value).toUpperCase();
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  return null;
};

/** Розбирає CSV таблиці. */
export function parseSheet(text: string): Sheet {
  const rows: string[][] = parse(text, { relax_column_count: true, skip_empty_lines: true, bom: true });

  let updatedAt: string | null = null;
  let headerIdx = -1;
  rows.forEach((row, i) => {
    const first = cell(row[0]);
    if (/^станом на/i.test(first)) updatedAt = cell(row[1]) || null;
    if (headerIdx < 0 && /^клуб/i.test(first)) headerIdx = i;
  });
  const header = rows[headerIdx];
  if (!header) throw new Error('Не знайдено рядок заголовка ("Клуб ...") у таблиці');

  const columns = header
    .map((h, col) => ({ col, name: cell(h) }))
    .filter((c) => c.col > 0 && c.name);

  const clubs: Club[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(headerIdx + 1)) {
    const name = cell(row[0]);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const status: Club['status'] = {};
    for (const c of columns) status[c.name] = parseBool(row[c.col]);
    clubs.push({ id: makeId(name), name, status });
  }

  return { updatedAt, features: columns.map((c) => c.name), clubs };
}

export async function fetchSheet(url: string): Promise<Sheet> {
  // Параметр-«пустушка», щоб обійти кеш Google
  const u = new URL(url);
  u.searchParams.set('_ts', Date.now().toString());
  const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Не вдалося завантажити таблицю: HTTP ${res.status}`);
  return parseSheet(await res.text());
}

/** Групує клуби за містом (перше слово назви). */
export function groupByCity(clubs: Club[]): CityGroup[] {
  const groups = new Map<string, CityGroup>();
  for (const club of clubs) {
    const city = club.name.split(' ')[0] ?? club.name;
    let group = groups.get(city);
    if (!group) {
      group = { id: makeId(`city:${city}`), city, clubs: [] };
      groups.set(city, group);
    }
    group.clubs.push(club);
  }
  return [...groups.values()];
}

/** Порівнює два стани і повертає зміни по клубах. */
export function diffStates(prevClubs: Club[], nextClubs: Club[]): ClubChange[] {
  const prev = new Map(prevClubs.map((c) => [c.id, c]));
  const changes: ClubChange[] = [];
  for (const club of nextClubs) {
    const old = prev.get(club.id);
    if (!old) continue;
    const fields: FieldChange[] = [];
    for (const [feature, after] of Object.entries(club.status)) {
      const before = old.status[feature];
      if (before !== undefined && before !== after) fields.push({ feature, before, after });
    }
    if (fields.length) changes.push({ club, fields });
  }
  return changes;
}

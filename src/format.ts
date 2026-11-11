import type { Club, ClubChange, FeatureValue } from './types.js';

const FEATURE_ICONS: Record<string, string> = {
  'світло': '💡',
  'гаряча вода': '🔥',
  'холодна вода': '🚰',
  'басейн': '🏊',
  'лазні': '🧖',
};

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const icon = (feature: string): string => FEATURE_ICONS[feature.toLowerCase()] ?? '•';
const mark = (v: FeatureValue): string => (v === true ? '✅' : v === false ? '❌' : '❔');

export function formatClubStatus(club: Club): string {
  const lines = Object.entries(club.status).map(([f, v]) => `${icon(f)} ${escapeHtml(f)}: ${mark(v)}`);
  return `🏋️ <b>${escapeHtml(club.name)}</b>\n${lines.join('\n')}`;
}

export function formatChange({ club, fields }: ClubChange): string {
  const lines = fields.map(
    ({ feature, before, after }) => `${icon(feature)} ${escapeHtml(feature)}: ${mark(before)} → ${mark(after)}`,
  );
  return `🏋️ <b>${escapeHtml(club.name)}</b>\n${lines.join('\n')}`;
}

export const formatUpdatedAt = (updatedAt: string | null): string =>
  updatedAt ? `\n\n<i>Станом на: ${escapeHtml(updatedAt)}</i>` : '';

const MAX_LEN = 4000;

/** Склеює блоки через порожній рядок, розбиваючи на повідомлення ≤ ліміту Telegram. */
export function chunkBlocks(blocks: string[], footer = ''): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const block of blocks) {
    const next = cur ? `${cur}\n\n${block}` : block;
    if (next.length + footer.length > MAX_LEN && cur) {
      chunks.push(cur);
      cur = block;
    } else cur = next;
  }
  chunks.push(cur + footer);
  return chunks;
}

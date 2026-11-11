const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSNoEJxn_Ep37cBhxHvSpGS_4sLhv1Ri2phwsWZc-PCx3rwLwuaa3lr23Hk3V7illevkCcS5BLnes5o/pub?gid=0&single=true&output=csv';

export interface Config {
  botToken: string | undefined;
  sheetUrl: string;
  pollIntervalMs: number;
  dbFile: string;
}

export const config: Config = {
  botToken: process.env.BOT_TOKEN,
  sheetUrl: process.env.SHEET_URL || DEFAULT_SHEET_URL,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MINUTES || 5) * 60_000,
  dbFile: process.env.DB_FILE || 'data/bot.db',
};

import { config } from './config.js';
import { Storage } from './storage.js';
import { diffStates, fetchSheet } from './sheet.js';
import { chunkBlocks, formatChange, formatUpdatedAt } from './format.js';
import { createBot, isChatGone } from './bot.js';
import type { ClubChange, Sheet } from './types.js';

const { botToken } = config;
if (!botToken) {
  console.error('❌ Не задано BOT_TOKEN. Скопіюйте .env.example у .env і вкажіть токен від @BotFather.');
  process.exit(1);
}

const storage = new Storage(config.dbFile);

let current: Sheet | null = null; // останні завантажені дані таблиці
let inflight: Promise<Sheet> | null = null;

/** Повертає закешовані дані таблиці (завантажує, якщо ще немає). */
async function getSheet(): Promise<Sheet> {
  if (current) return current;
  inflight ??= fetchSheet(config.sheetUrl).finally(() => {
    inflight = null;
  });
  current = await inflight;
  return current;
}

const bot = createBot({ token: botToken, storage, getSheet });

/** Надсилає зміни підписникам; повертає кількість чатів. */
async function notify(changes: ClubChange[], sheet: Sheet): Promise<number> {
  const byChat = new Map<string, ClubChange[]>();
  for (const change of changes) {
    for (const chatId of storage.subscribersOf(change.club.id)) {
      const list = byChat.get(chatId) ?? [];
      list.push(change);
      byChat.set(chatId, list);
    }
  }

  for (const [chatId, list] of byChat) {
    const chunks = chunkBlocks(list.map(formatChange), formatUpdatedAt(sheet.updatedAt));
    chunks[0] = `🔔 <b>Оновлення стану клубів</b>\n\n${chunks[0]}`;
    try {
      for (const text of chunks) await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      if (isChatGone(err)) {
        console.log(`Чат ${chatId} недоступний — видаляю підписки`);
        storage.removeUser(chatId);
      } else {
        console.error(`Не вдалося надіслати повідомлення в ${chatId}:`, (err as Error).message);
      }
    }
  }
  return byChat.size;
}

let polling = false;
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const sheet = await fetchSheet(config.sheetUrl);
    current = sheet;
    const prev = storage.lastSnapshot;
    if (prev) {
      const changes = diffStates(prev.clubs, sheet.clubs);
      if (changes.length) {
        const sent = await notify(changes, sheet);
        console.log(`[${new Date().toISOString()}] Змін: ${changes.length} клуб(ів), сповіщено чатів: ${sent}`);
      }
    }
    storage.setLastSnapshot({ updatedAt: sheet.updatedAt, clubs: sheet.clubs });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Помилка перевірки таблиці:`, (err as Error).message);
  } finally {
    polling = false;
  }
}

await bot.api.setMyCommands([
  { command: 'clubs', description: 'Обрати клуби для підписки' },
  { command: 'my', description: 'Мої підписки' },
  { command: 'status', description: 'Поточний стан моїх клубів' },
  { command: 'help', description: 'Довідка' },
]);

await poll();
const timer = setInterval(poll, config.pollIntervalMs);

const stop = async (): Promise<void> => {
  clearInterval(timer);
  await bot.stop();
  storage.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log(`✅ Бот запущено. Перевірка таблиці кожні ${config.pollIntervalMs / 60_000} хв.`);
void bot.start({ drop_pending_updates: true });

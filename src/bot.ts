import { Bot, type Context, GrammyError, InlineKeyboard, Keyboard } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { chunkBlocks, escapeHtml, formatClubStatus, formatUpdatedAt } from './format.js';
import { groupByCity } from './sheet.js';
import type { Storage } from './storage.js';
import type { CityGroup, Club, Sheet } from './types.js';

const BTN_CHOOSE = '📍 Обрати клуби';
const BTN_MY = '⭐ Мої підписки';
const BTN_STATUS = '📊 Статус моїх клубів';

const mainKeyboard = new Keyboard().text(BTN_CHOOSE).row().text(BTN_MY).text(BTN_STATUS).resized().persistent();

const HELP = [
  'Я надсилаю сповіщення, коли в клубах змінюється наявність 💡 світла, 🔥 гарячої / 🚰 холодної води, 🏊 басейну чи 🧖 лазень.',
  '',
  `• <b>${BTN_CHOOSE}</b> — обрати місто та клуби для підписки`,
  `• <b>${BTN_MY}</b> — переглянути або скасувати підписки`,
  `• <b>${BTN_STATUS}</b> — поточний стан обраних клубів`,
].join('\n');

const NO_SUBS = `У вас поки немає підписок. Натисніть «${BTN_CHOOSE}».`;
const CITIES_TEXT = '📍 Оберіть місто або клуб. Натискання на клуб вмикає/вимикає підписку.';

export const isChatGone = (err: unknown): boolean =>
  err instanceof GrammyError &&
  (err.error_code === 403 || /chat not found|user is deactivated/i.test(err.description));

function ignoreNotModified(err: unknown): void {
  if (err instanceof GrammyError && /message is not modified/i.test(err.description)) return;
  throw err;
}

export interface BotDeps {
  token: string;
  storage: Storage;
  getSheet: () => Promise<Sheet>;
}

export function createBot({ token, storage, getSheet }: BotDeps): Bot {
  const bot = new Bot(token);
  bot.api.config.use(autoRetry());

  const chatIdOf = (ctx: Context): number => {
    if (!ctx.chat) throw new Error('Update без chat');
    return ctx.chat.id;
  };

  // ---------- клавіатури ----------
  const clubLabel = (chatId: number, club: Club, prefixToStrip?: string): string => {
    const short =
      prefixToStrip && club.name.startsWith(`${prefixToStrip} `) ? club.name.slice(prefixToStrip.length + 1) : club.name;
    return `${storage.isSubscribed(chatId, club.id) ? '✅' : '▫️'} ${short}`;
  };

  const citiesKeyboard = (chatId: number, groups: CityGroup[]): InlineKeyboard => {
    const kb = new InlineKeyboard();
    const subs = new Set(storage.getSubscriptions(chatId));
    groups.forEach((g, i) => {
      const [only] = g.clubs;
      if (g.clubs.length === 1 && only) {
        kb.text(clubLabel(chatId, only), `t:${only.id}:-`);
      } else {
        const n = g.clubs.filter((c) => subs.has(c.id)).length;
        kb.text(`${g.city} (${n ? `${n}/` : ''}${g.clubs.length})`, `city:${g.id}`);
      }
      if (i % 2 === 1) kb.row();
    });
    return kb;
  };

  const cityKeyboard = (chatId: number, group: CityGroup): InlineKeyboard => {
    const kb = new InlineKeyboard();
    group.clubs.forEach((club, i) => {
      kb.text(clubLabel(chatId, club, group.city), `t:${club.id}:${group.id}`);
      if (i % 2 === 1) kb.row();
    });
    return kb
      .row()
      .text('✅ Усі', `all:${group.id}:1`)
      .text('🚫 Жодного', `all:${group.id}:0`)
      .row()
      .text('⬅️ До міст', 'cities');
  };

  const myKeyboard = (clubs: Club[]): InlineKeyboard => {
    const kb = new InlineKeyboard();
    for (const club of clubs) kb.text(`❌ ${club.name}`, `u:${club.id}`).row();
    if (clubs.length) kb.text('➕ Додати ще', 'cities');
    return kb;
  };

  // ---------- допоміжні ----------
  const myText = (clubs: Club[]): string =>
    clubs.length ? `⭐ <b>Ваші підписки (${clubs.length})</b>\nНатисніть на клуб, щоб відписатися.` : NO_SUBS;

  const mySubscribedClubs = async (chatId: number): Promise<Club[]> => {
    const sheet = await getSheet();
    const ids = new Set(storage.getSubscriptions(chatId));
    return sheet.clubs.filter((c) => ids.has(c.id));
  };

  const findGroup = async (groupId: string): Promise<CityGroup | undefined> =>
    groupByCity((await getSheet()).clubs).find((g) => g.id === groupId);

  const showCities = async (ctx: Context, edit = false): Promise<void> => {
    const sheet = await getSheet();
    const reply_markup = citiesKeyboard(chatIdOf(ctx), groupByCity(sheet.clubs));
    if (edit) await ctx.editMessageText(CITIES_TEXT, { reply_markup });
    else await ctx.reply(CITIES_TEXT, { reply_markup });
  };

  const handleMy = async (ctx: Context): Promise<void> => {
    const clubs = await mySubscribedClubs(chatIdOf(ctx));
    await ctx.reply(myText(clubs), { parse_mode: 'HTML', reply_markup: myKeyboard(clubs) });
  };

  const handleStatus = async (ctx: Context): Promise<void> => {
    const sheet = await getSheet();
    const clubs = await mySubscribedClubs(chatIdOf(ctx));
    if (!clubs.length) {
      await ctx.reply(NO_SUBS);
      return;
    }
    for (const text of chunkBlocks(clubs.map(formatClubStatus), formatUpdatedAt(sheet.updatedAt))) {
      await ctx.reply(text, { parse_mode: 'HTML' });
    }
  };

  // ---------- команди ----------
  bot.command('start', (ctx) => ctx.reply(`👋 Вітаю!\n\n${HELP}`, { parse_mode: 'HTML', reply_markup: mainKeyboard }));
  bot.command('help', (ctx) => ctx.reply(HELP, { parse_mode: 'HTML', reply_markup: mainKeyboard }));
  bot.command('clubs', (ctx) => showCities(ctx));
  bot.command('my', handleMy);
  bot.command('status', handleStatus);
  bot.hears(BTN_CHOOSE, (ctx) => showCities(ctx));
  bot.hears(BTN_MY, handleMy);
  bot.hears(BTN_STATUS, handleStatus);

  // ---------- callback-и ----------
  bot.callbackQuery('cities', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showCities(ctx, true);
  });

  bot.callbackQuery(/^city:(\w+)$/, async (ctx) => {
    const group = await findGroup(ctx.match[1] ?? '');
    if (!group) return ctx.answerCallbackQuery({ text: 'Місто не знайдено, оновіть список' });
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`📍 <b>${escapeHtml(group.city)}</b> — оберіть клуби:`, {
      parse_mode: 'HTML',
      reply_markup: cityKeyboard(chatIdOf(ctx), group),
    });
  });

  bot.callbackQuery(/^t:(\w+):([\w-]+)$/, async (ctx) => {
    const [, clubId = '', context = ''] = ctx.match;
    const chatId = chatIdOf(ctx);
    const sheet = await getSheet();
    const club = sheet.clubs.find((c) => c.id === clubId);
    if (!club) return ctx.answerCallbackQuery({ text: 'Клуб не знайдено в таблиці' });

    const on = storage.toggle(chatId, clubId);
    await ctx.answerCallbackQuery({ text: on ? `🔔 Підписано: ${club.name}` : `🔕 Відписано: ${club.name}` });

    let kb: InlineKeyboard | undefined;
    if (context === '-') {
      kb = citiesKeyboard(chatId, groupByCity(sheet.clubs));
    } else {
      const group = groupByCity(sheet.clubs).find((g) => g.id === context);
      if (group) kb = cityKeyboard(chatId, group);
    }
    if (kb) await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(ignoreNotModified);
  });

  bot.callbackQuery(/^all:(\w+):([01])$/, async (ctx) => {
    const group = await findGroup(ctx.match[1] ?? '');
    if (!group) return ctx.answerCallbackQuery({ text: 'Місто не знайдено' });
    const on = ctx.match[2] === '1';
    const chatId = chatIdOf(ctx);
    storage.setSubscribed(chatId, group.clubs.map((c) => c.id), on);
    await ctx.answerCallbackQuery({
      text: on ? `🔔 Підписано на всі клуби: ${group.city}` : `🔕 Відписано від усіх: ${group.city}`,
    });
    await ctx.editMessageReplyMarkup({ reply_markup: cityKeyboard(chatId, group) }).catch(ignoreNotModified);
  });

  bot.callbackQuery(/^u:(\w+)$/, async (ctx) => {
    const chatId = chatIdOf(ctx);
    storage.setSubscribed(chatId, ctx.match[1] ?? '', false);
    await ctx.answerCallbackQuery({ text: '🔕 Відписано' });
    const clubs = await mySubscribedClubs(chatId);
    await ctx
      .editMessageText(myText(clubs), { parse_mode: 'HTML', reply_markup: myKeyboard(clubs) })
      .catch(ignoreNotModified);
  });

  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery({ text: 'Кнопка застаріла' }));

  bot.catch(({ error, ctx }) => {
    console.error(`Помилка під час обробки update ${ctx.update.update_id}:`, error);
    ctx.reply('⚠️ Сталася помилка, спробуйте пізніше.').catch(() => {});
  });

  return bot;
}

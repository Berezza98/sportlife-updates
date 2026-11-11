// Перевірка парсингу таблиці без запуску бота: npm run check
import { config } from './config.js';
import { fetchSheet, groupByCity } from './sheet.js';
import { formatClubStatus } from './format.js';

const sheet = await fetchSheet(config.sheetUrl);
const [first] = sheet.clubs;
console.log('Станом на:', sheet.updatedAt);
console.log('Характеристики:', sheet.features.join(', '));
console.log('Клубів:', sheet.clubs.length);
console.log('Міста:', groupByCity(sheet.clubs).map((g) => `${g.city} (${g.clubs.length})`).join(', '));
if (first) console.log('\nПриклад:\n' + formatClubStatus(first).replace(/<\/?\w>/g, ''));

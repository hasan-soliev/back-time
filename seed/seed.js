// Загружает расписание из JSON-файла в хранилище сервера: node seed/seed.js seed/2026-09-14_istaravshan.json
import fs from 'node:fs/promises';
import { normalizeSchedule } from '../src/extract.js';
import { saveSchedule } from '../src/store.js';

const file = process.argv[2];
if (!file) {
  console.error('Использование: node seed/seed.js <файл.json>');
  process.exit(1);
}
const saved = await saveSchedule(normalizeSchedule(JSON.parse(await fs.readFile(file, 'utf8'))));
console.log(`Сохранено: ${saved.hijriMonth} ${saved.periodFrom} — ${saved.periodTo}, ${saved.days.length} дн.`);

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { extractSchedule, normalizeSchedule } from './extract.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  daysInRange,
  deleteSchedule,
  isEmpty,
  listSchedules,
  saveSchedule,
  scheduleForDate,
  storageKind,
} from './store.js';

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

if (!ADMIN_TOKEN) {
  console.warn('ADMIN_TOKEN муқаррар нашудааст — ҳамаи дархостҳои маъмурӣ рад карда мешаванд');
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('ANTHROPIC_API_KEY муқаррар нашудааст — шинохтани аксҳо кор намекунад');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_TYPES.includes(file.mimetype)),
});

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Рамзи маъмур нодуруст аст' });
  }
  next();
}

// ---------- public ----------

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/** Today's (or ?date=) prayer times plus tomorrow's, so the client can count down past khuftan. */
app.get('/api/day', async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const [today, tomorrow] = await daysInRange(date, next.toISOString().slice(0, 10)).then((days) => [
    days.find((d) => d.date === date) ?? null,
    days.find((d) => d.date !== date) ?? null,
  ]);
  if (!today) {
    return res.status(404).json({ error: 'Барои ин сана ҷадвал нест' });
  }
  res.json({ today, tomorrow });
});

/** The full uploaded month (hijri period) that contains ?date=. */
app.get('/api/month', async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const schedule = await scheduleForDate(date);
  if (!schedule) {
    return res.status(404).json({ error: 'Барои ин сана ҷадвал нест' });
  }
  res.json(schedule);
});

/** Raw days for a range — lets the app cache several months for offline use. */
app.get('/api/days', async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) {
    return res.status(400).json({ error: 'Параметрҳои from ва to дар шакли YYYY-MM-DD лозиманд' });
  }
  res.json(await daysInRange(from, to));
});

app.get('/api/schedules', async (_req, res) => res.json(await listSchedules()));

// ---------- admin ----------

app.post('/api/admin/check', requireAdmin, (_req, res) => res.json({ ok: true }));

/** Recognises a screenshot and returns the parsed schedule. Pass ?save=1 to store it right away. */
app.post('/api/admin/parse', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Тасвирро замима кунед (майдони image: jpeg/png/webp)' });
  }
  try {
    const schedule = await extractSchedule(req.file.buffer, req.file.mimetype);
    if (req.query.save === '1') {
      return res.json({ saved: true, schedule: await saveSchedule(schedule) });
    }
    res.json({ saved: false, schedule });
  } catch (e) {
    console.error('parse failed', e);
    res.status(502).json({ error: e.message || 'Хатои шинохтан' });
  }
});

/** Saves a (possibly hand-corrected) schedule returned by /parse. */
app.post('/api/admin/schedules', requireAdmin, async (req, res) => {
  try {
    const saved = await saveSchedule(normalizeSchedule(req.body));
    res.json({ saved: true, schedule: saved });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/schedules/:id', requireAdmin, async (req, res) => {
  const ok = await deleteSchedule(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Хатои сервер' });
});

// Пустое хранилище (первый запуск, новая база) заполняем месяцами из seed/.
async function seedIfEmpty() {
  if (!(await isEmpty())) {
    return;
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const saved = await saveSchedule(normalizeSchedule(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'))));
    console.log(`seed: ${saved.periodFrom} — ${saved.periodTo}`);
  }
}

await seedIfEmpty();
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT} (storage: ${storageKind()})`));

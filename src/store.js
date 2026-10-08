import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'schedules.json');

/**
 * Storage layout: { schedules: [{ id, title, city, hijriMonth, periodFrom, periodTo, peshin, peshinIqamat,
 * createdAt, days: [...] }] }. One entry per uploaded screenshot (one hijri month).
 */
let cache;

// С DATABASE_URL всё состояние лежит одной JSON-строкой в Postgres (на хостингах вроде Render
// диск временный и стирается при перезапуске). Без него — файл data/schedules.json.
const DATABASE_URL = process.env.DATABASE_URL;
let pool;

async function getPool() {
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    });
    await pool.query('CREATE TABLE IF NOT EXISTS app_state (key text PRIMARY KEY, value jsonb NOT NULL)');
  }
  return pool;
}

async function readState() {
  if (DATABASE_URL) {
    const { rows } = await (await getPool()).query("SELECT value FROM app_state WHERE key = 'schedules'");
    return rows[0]?.value ?? null;
  }
  try {
    return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    return null;
  }
}

async function load() {
  cache ??= (await readState()) ?? { schedules: [] };
  return cache;
}

async function persist() {
  if (DATABASE_URL) {
    await (await getPool()).query(
      "INSERT INTO app_state (key, value) VALUES ('schedules', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify(cache)],
    );
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
  await fs.rename(tmp, DB_FILE);
}

export const storageKind = () => (DATABASE_URL ? 'postgres' : `file ${DB_FILE}`);

export async function isEmpty() {
  return (await load()).schedules.length === 0;
}

export async function listSchedules() {
  const db = await load();
  return db.schedules
    .map(({ days, ...meta }) => ({ ...meta, dayCount: days.length }))
    .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom));
}

/** Saves a schedule. A schedule overlapping existing dates replaces those older entries. */
export async function saveSchedule(schedule) {
  const db = await load();
  db.schedules = db.schedules.filter(
    (s) => s.periodTo < schedule.periodFrom || s.periodFrom > schedule.periodTo,
  );
  const entry = { id: `${schedule.periodFrom}_${Date.now()}`, createdAt: new Date().toISOString(), ...schedule };
  db.schedules.push(entry);
  await persist();
  return entry;
}

export async function deleteSchedule(id) {
  const db = await load();
  const before = db.schedules.length;
  db.schedules = db.schedules.filter((s) => s.id !== id);
  if (db.schedules.length !== before) {
    await persist();
  }
  return db.schedules.length !== before;
}

/** The schedule whose period contains `date`, or null. */
export async function scheduleForDate(date) {
  const db = await load();
  return db.schedules.find((s) => s.periodFrom <= date && date <= s.periodTo) ?? null;
}

/** All stored days in [from, to], each enriched with the peshin time of its schedule. */
export async function daysInRange(from, to) {
  const db = await load();
  return db.schedules
    .flatMap((s) => s.days.map((d) => ({ ...d, peshin: s.peshin, hijriMonth: s.hijriMonth })))
    .filter((d) => d.date >= from && d.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

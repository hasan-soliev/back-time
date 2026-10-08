import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';

const time = z.string().describe('Время в формате HH:MM, 24 часа, с ведущим нулём (05:20, 16:55)');

const ScheduleSchema = z.object({
  title: z.string().describe('Заголовок таблицы целиком'),
  city: z.string().describe('Город, например "Истаравшан"'),
  hijriMonth: z.string().describe('Название месяца по хиджре, например "Рабиъус сонӣ"'),
  periodFrom: z.string().describe('Первая дата периода, YYYY-MM-DD'),
  periodTo: z.string().describe('Последняя дата периода, YYYY-MM-DD'),
  peshin: time.describe('Время намаза пешин из заголовка (Вақти намози пешин), HH:MM'),
  peshinIqamat: time.describe('Время қомат для пешин из заголовка, HH:MM'),
  days: z.array(
    z.object({
      hijriDay: z.number().int(),
      date: z.string().describe('Григорианская дата строки, YYYY-MM-DD'),
      weekday: z.string().describe('День недели как в таблице'),
      subhiSodiq: time,
      bomdod: time,
      tulu: time.describe('Тулӯъи офтоб'),
      qiyom: time.describe('Қиёми офтоб'),
      asr: time,
      shom: time,
      khuftan: time,
    }),
  ),
});

const PROMPT = `Это фото таблицы времени намазов (таквим). Перепиши ВСЕ строки таблицы без пропусков.

Правила:
- Колонки слева направо: день месяца по хиджре, григорианский день (месяц меняется посередине таблицы — смотри период в заголовке "аз ... то ..."), день недели, Субҳи содиқ, Бомдод, Тулӯъи офтоб, Қиёми офтоб, Аср, Шом, Хуфтан.
- Для каждой строки укажи полную григорианскую дату YYYY-MM-DD, учитывая период из заголовка.
- Все времена в 24-часовом формате HH:MM. Утренние (Субҳи содиқ, Бомдод, Тулӯъ) — до полудня, Аср/Шом/Хуфтан — после полудня (16:55, 18:45, 20:15).
- Время пешин и қомат возьми из строки "Вақти намози пешин ..., қомат ...".`;

let client;

export async function extractSchedule(imageBuffer, mediaType) {
  client ??= new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(ScheduleSchema) },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Модел коркарди тасвирро рад кард');
  }
  if (!response.parsed_output) {
    throw new Error('Ҷадвалро шинохтан муяссар нашуд');
  }
  return normalizeSchedule(response.parsed_output);
}

const TIME_FIELDS = ['subhiSodiq', 'bomdod', 'tulu', 'qiyom', 'asr', 'shom', 'khuftan'];

function normTime(value, afternoon) {
  const m = String(value).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) {
    throw new Error(`Вақти нодуруст: "${value}"`);
  }
  let h = Number(m[1]);
  if (afternoon && h < 12) {
    h += 12;
  }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Validates a schedule (from OCR or from the admin) and fixes the obvious slips. */
export function normalizeSchedule(s) {
  if (!Array.isArray(s.days) || s.days.length === 0) {
    throw new Error('Дар ҷадвал рӯзҳо нестанд');
  }
  const days = [...s.days].sort((a, b) => a.hijriDay - b.hijriDay);

  // Rows are consecutive calendar days; if the model mis-read a month boundary, rebuild from the first row.
  const first = /^\d{4}-\d{2}-\d{2}$/.test(days[0].date) ? days[0].date : s.periodFrom;
  const consecutive = days.every((d, i) => d.date === addDays(first, i));

  const out = days.map((d, i) => {
    const day = { hijriDay: d.hijriDay, date: consecutive ? d.date : addDays(first, i), weekday: d.weekday };
    for (const f of TIME_FIELDS) {
      day[f] = normTime(d[f], ['asr', 'shom', 'khuftan'].includes(f));
    }
    return day;
  });

  return {
    title: s.title ?? '',
    city: s.city ?? '',
    hijriMonth: s.hijriMonth ?? '',
    periodFrom: out[0].date,
    periodTo: out[out.length - 1].date,
    peshin: normTime(s.peshin, true),
    peshinIqamat: s.peshinIqamat ? normTime(s.peshinIqamat, true) : null,
    days: out,
  };
}

# back-time

Express-бэкенд для мобильного приложения. Принимает скриншот таблицы с расписанием, распознаёт его
через Claude (vision + structured output), хранит расписание в `data/schedules.json` и отдаёт приложению.

## Запуск

```bash
git clone git@github.com:hasan-soliev/back-time.git && cd back-time
npm install          # один раз
cp .env.example .env # один раз, затем впишите свой пароль и ключ
npm run seed         # один раз: загрузить первый месяц из seed/
npm start            # http://localhost:3000
```

Настройки лежат в `.env` (в git не попадает, образец — `.env.example`):

| Переменная | По умолчанию | Зачем |
|---|---|---|
| `ADMIN_TOKEN` | — | пароль вкладки «Идора» в приложении (обязательно) |
| `ANTHROPIC_API_KEY` | — | ключ Claude API, нужен только для распознавания скриншотов |
| `PORT` | 3000 | порт сервера |
| `DATABASE_URL` | — | строка подключения Postgres; если задана, данные хранятся в базе, а не в файле |
| `DATA_DIR` | ./data | где хранится `schedules.json` (без `DATABASE_URL`) |
| `CLAUDE_MODEL` | claude-opus-5 | модель для распознавания |

`npm run dev` — то же, что `npm start`, но перезапускается при изменении кода.

## Деплой на Render

1. Render → **New → Blueprint** → выбрать репозиторий `back-time` (настройки берутся из `render.yaml`).
2. Указать `ADMIN_TOKEN`, `ANTHROPIC_API_KEY` и `DATABASE_URL`.
3. Для `DATABASE_URL` подойдёт бесплатный Postgres на [neon.tech](https://neon.tech): на бесплатном Render диск
   временный, и без базы загруженные расписания пропадут после перезапуска.
4. При пустой базе сервер сам загрузит месяцы из `seed/`.

## API

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/day?date=YYYY-MM-DD` | день + следующий день (для таймера на следующий день) |
| GET | `/api/month?date=YYYY-MM-DD` | весь загруженный месяц, содержащий дату |
| GET | `/api/days?from=&to=` | дни за период (кэш в приложении) |
| GET | `/api/schedules` | список загруженных месяцев |
| POST | `/api/admin/check` | проверка пароля |
| POST | `/api/admin/parse` | multipart `image` → распознанное расписание (`?save=1` — сразу сохранить) |
| POST | `/api/admin/schedules` | сохранить (проверенное/исправленное) расписание JSON |
| DELETE | `/api/admin/schedules/:id` | удалить месяц |

Админские методы требуют заголовок `x-admin-token: $ADMIN_TOKEN`.
Новое расписание, пересекающееся по датам со старым, заменяет его.

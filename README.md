# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Настройка

Backend-переменные окружения задаются в `server/.env` (см. `server/.env.example`).
Обязательные для входа в приложение:

- `APP_PASSWORD` — общий пароль для входа (`POST /api/login`).
- `SESSION_SECRET` — секрет для подписи сессионной cookie (HMAC-SHA256).

Если один из них не задан, пуст, состоит из пробелов или слишком короткий,
сервер отвечает 503 на все `/api/*` запросы (включая логин) и пишет громкую
ошибку в лог при старте — **в любом окружении**, независимо от `NODE_ENV`.
Единственное исключение — локальная разработка: `AUTH_DISABLED=true`
пропускает запросы, но только пришедшие с loopback-адреса. Подробности и
предупреждения — в `server/.env.example`.

## Бэкапы

`server/backup.js` выгружает все четыре коллекции (`transactions`,
`accounts`, `categories`, `settings`) в один EJSON-файл. EJSON, а не обычный
JSON, потому что он сохраняет `ObjectId`, `Date` и числовые типы, а не
превращает их в строки — иначе восстановление дало бы приблизительную копию
документов вместо точной.

```bash
cd server && npm run backup            # в ./backups
cd server && npm run backup -- --out /путь/к/каталогу
```

Скрипт только читает. Задайте `MONGODB_BACKUP_URI` на отдельного
пользователя MongoDB с ролью `read` (рецепт — в `server/.env.example`):
тогда запись запрещает сама база, а не наш код, и credential для бэкапов
отзывается независимо от `APP_PASSWORD`, никого не разлогинивая. Именно этот
путь стоит давать внешнему ассистенту или планировщику.

Если все коллекции оказались пустыми, файл не записывается и скрипт падает с
ненулевым кодом: пустой результат почти всегда означает неверное имя базы в
строке подключения или нехватку прав, и молчаливая запись такого файла
вытеснила бы вчерашний рабочий бэкап.

Восстановление — отдельный CLI-скрипт, а не HTTP-эндпоинт: во всём
приложении нет маршрута, способного перезаписать базу, поэтому ни токен, ни
баг, ни подсунутая ассистенту инструкция не могут запустить restore. Нужен
шелл и креды на запись.

```bash
cd server && npm run restore -- ../backups/budget-backup-….json           # пробный прогон
cd server && npm run restore -- ../backups/budget-backup-….json --yes --replace
```

Без `--yes` скрипт только показывает, что бы он сделал. Непустую базу он
отказывается трогать без `--replace`. Файл проверяется до подключения к
Mongo: неизвестная версия формата или расхождение заявленного и фактического
числа записей (признак обрезанного файла) — отказ.

Каталог `backups/` в `.gitignore`: это полная финансовая история семьи
открытым текстом. Файлы пишутся с правами `0600`. Храните их там, где вы
согласны хранить выписку из банка.

## Тесты

- `npm test` - модульные тесты (vitest + jsdom).
- `npm run test:e2e` - смоук-тесты в реальном браузере (Playwright + Chromium,
  см. `e2e/`). Нужны для класса багов, которые jsdom в принципе не видит
  (jsdom не делает layout: `offsetWidth`/`offsetLeft`/`getBoundingClientRect`
  всегда 0, `vh` не резолвится, скролл не происходит) - например, карусель
  счетов, съезжающая не туда при свайпе, или шторка операций, оседающая не
  на той высоте. База данных/backend для этого не нужны: Playwright сам
  поднимает dev-сервер Vite, а каждый вызов `/api/**` подменяется фикстурой
  (см. `e2e/fixtures.js`). Перед первым запуском один раз выполните
  `npx playwright install chromium`.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

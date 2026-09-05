# Реализация фаз 1–2 — 5 сентября 2026

Документ фиксирует текущий статус после исторического аудита. В работе участвовали
два агента Sol high (backend и frontend) и Luna high (инфраструктура и документы);
главный агент выполнял анализ, ревью и проверки. Реальные production `.env`, базы,
каталоги backup и пользовательские untracked-скрипты не читались и не запускались.

## Reliability и запуск

- `server/index.js` загружает окружение из `server/.env` относительно `__dirname`.
- Mongo connect и seed завершаются до открытия бизнес HTTP API.
- `GET /api/health` остаётся liveness-проверкой; `GET /api/ready` возвращает только
  `{ok:true}` с 200 после подключения Mongo и 503 с `{ok:false}` до него или после
  потери соединения. До initial connect порт вообще не слушает бизнес API.
- SIGINT/SIGTERM отменяют незавершённый boot, не открывают порт после отмены и
  закрывают уже открытый сервер с ограниченным graceful-close deadline.
- Vite по умолчанию проксирует `/api` на порт 5000; частный override задаётся
  `BUDGET_TRACKER_API_TARGET` и не попадает в клиентский bundle.
- `POST /api/client-errors` принимает только `{code,area}` из whitelist, ограничивает
  размер и частоту, а в локальный structured log пишет timestamp, request id, code и
  area без stack, URL, raw body и финансовых данных. Ошибка отправки с клиента
  проглатывается.

Клиент различает initial loading failure и ошибку фоновой синхронизации: при первом
сбое показывает retry вместо нулевых данных, а при уже загруженном снимке сохраняет
последние данные, показывает предупреждение и время последней успешной синхронизации.
После logout поздние ответы корзины и синхронизации не применяются.

## Integrity

- Переименование категории и обновление связанных операций выполняются в одной
  MongoDB-транзакции; каскад учитывает одинаковые имена в `income` и `expense`.
- PUT операции использует `__v` в read/validate/update цепочке и отвечает конфликтом
  при устаревшей версии; это закрывает concurrent PUT race.
- Settings используют singleton key, уникальный индекс и контролируемую миграцию
  старых строк, поэтому параллельное первое сохранение не создаёт второй singleton.

## Backup Integrity

- Backup читает все коллекции одной MongoDB snapshot session последовательными read-
  запросами. Это совместимо с read-only backup credential.
- Restore выполняется одной `withTransaction` на replica set. Для `--replace:false`
  проверка non-empty повторяется внутри транзакции; поздняя ошибка вставки откатывает
  изменения. На standalone MongoDB restore явно отказывается.
- Файл пишется во временный файл в той же директории и переименовывается атомарно;
  временный файл очищается при ошибке, ротация начинается только после успешной записи.
  Atomic rename защищает целостность файла, а snapshot session отдельно обеспечивает
  согласованный срез базы.
- Текущий EJSON `formatVersion: 2` содержит `transactions`, `accounts`, `categories`,
  `settings` и `plannedpayments` с обязательными counts. Документ v1 принимается с
  отсутствующей `plannedpayments`, которая нормализуется в пустую коллекцию; при
  наличии этой коллекции её count проверяется. В v2 отсутствие коллекции или count —
  ошибка.
- Проверка backup контролирует `_id`, BSON dates и суммы транзакций, а для планов —
  title, положительную конечную сумму, BSON `dueDate`, status
  `pending|paid|skipped`, обязательные account/category, ссылки на существующие
  account/transaction, единственность linked transaction и правила paid (`paidAt` и
  расходная transaction обязательны). Legacy account IDs `card` и `cash` допустимы.
- Формат документов транзакций не преобразуется: `deletedAt`, `deletionBatchId`,
  `__v` и остальные поля проходят через EJSON прозрачно. CSV import/export не
  затрагивались.

## Undo, корзина и разовые платежи

Soft-delete операций группируется в корзине; после удаления доступно Undo,
восстановление всей группы и окончательная очистка. Связанный оплаченный план
показывает статус удалённой операции; permanent purge сбрасывает paid-связь плана
в pending. Повторные restore/purge и устаревшие версии получают явный конфликт,
а повторная оплата не создаёт второй расход.

Разовые planned payments используют отдельную коллекцию `plannedpayments` и поля
`title`, `amount`, `dueDate`, `account`, `category`, `description`, `status`,
`transactionId`, `paidAt`, `__v`. Через UI доступны create/edit с датой и суммой,
skip и pay; pay создаёт расход или связывает уже существующий расход, а idempotent
повтор для уже оплаченного плана возвращает тот же результат. API принимает дату
`YYYY-MM-DD`, модель хранит её как BSON Date. Статус `paid` связывается с одной
расходной операцией; pending и skipped не имеют paid-ссылок. Регулярные операции в
этот план не входят.

## Проверки

Targeted `server/backup.test.js`: 63/63 passed, включая EJSON v2 round-trip, v1
compatibility, snapshot/rollback integration на ephemeral replica set, связь и
типы planned payments, atomic-file failure cleanup. Финальный общий локальный gate:
`npm test -- --maxWorkers=4` — 38 файлов, 756/756; `npm run test:e2e -- --workers=2`
— 16/16; `npm run build` — успешно, 370.46 kB JS / 110.10 kB gzip. Эти проверки
не являются проверкой production и CI.

Для локальных server-тестов нужен временный MongoDB replica set (`MongoMemoryReplSet`),
а e2e используют API fixtures. CI workflow настроен на собственный `mongo:7`
container с `rs0` и ожиданием `isWritablePrimary`, но CI в рамках этой работы не
запускался; production также не проверялся. Playwright browsers в рамках этого
аудита не устанавливались.

Остаются отдельные задачи: мобильное измерение перед pagination, внешний monitoring,
известная server dependency chain `express`/`body-parser`/`qs` и 2 no-unused-vars в
нетронутом пользовательском untracked `server/create_backup.js`.

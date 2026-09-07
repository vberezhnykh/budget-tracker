# OVH: только планировщик банковских предложений

Планировщик для Linux с systemd отправляет сигналы существующему приложению
на Koyeb. Приложение и банковские ключи остаются на Koyeb, MongoDB остаётся в
прежней базе. На OVH нужен только токен `BANK_SYNC_CRON_SECRET`.
Отдельная учётная запись внешнего сервиса cron не требуется.

Банковский модуль приложения выключен по умолчанию. Перед намеренным
включением расписания нужно включить `BANKING_ENABLED=true` на Koyeb,
перезапустить приложение и подключить банки. При выключенном модуле сигнал
получает HTTP 404 и не вызывает чтения банков. Текущий таймер OVH остановлен
и отключён от автозапуска; файлы сохранены для возможного повторного включения.

В репозитории хранится шаблон `curl.conf.example` с заполнителями. Рабочую
конфигурацию с настоящим доменом и токеном следует хранить только на сервере,
вне репозитория.

## Что будет установлено

- `budget-tracker-banking.timer`: ежедневно 08:00, 14:00 и 20:00 в
  `Europe/Bucharest`, с учётом перехода на летнее время.
- `budget-tracker-banking.service`: короткий процесс от root с ограничениями
  записи, прав и доступа к домашним каталогам.
- `/usr/local/libexec/budget-tracker-banking`: проверка дневного окна и один
  POST с явным `curl --http1.1`, ожиданием подключения до 30 секунд и общим
  таймаутом 90 секунд. Только HTTP 202 считается принятым сигналом.
- `/etc/budget-tracker-banking/curl.conf`: URL, POST `{}` и заголовок Bearer.
  Каталог имеет права root:root 0700, файл root:root 0600. Секрет не передаётся
  через аргументы процесса, окружение или URL. Никаких банковских ключей на OVH.

`Persistent=false` исключает запуск пропущенных событий при повторной активации
таймера. Дополнительная проверка текущего часа в скрипте исключает ночной HTTP
сигнал при запоздалом запуске после suspend. Разрешены целые часы 08, 14 и 20,
как в серверном коде. Повторов curl и автоматического Restart нет.

Сервер на Koyeb проверяет шестичасовой интервал, MongoDB-блокировки и дневные
окна самостоятельно. Его минутный таймер дождётся срока, если, например, после
утреннего холодного старта следующая попытка допустима чуть позже 14:00.
HTTP 202 означает принятие сигнала; успешное банковское чтение проверяется в
интерфейсе приложения. Новые бюджетные записи автоматически не создаются.

## Установка после проверки сервера

Нужны systemd, curl, tzdata и актуальное время/NTP. Скрипты должны сохраняться
с окончаниями строк LF. Команды выполняются на OVH из каталога с этими файлами.
`install.sh` откажется перезаписывать существующую установку и секрет.

```sh
sh -n install.sh
sh -n budget-tracker-banking
systemd-analyze calendar '*-*-* 08,14,20:00:00 Europe/Bucharest' --iterations=6
sudo sh ./install.sh
```

Установщик проверяет units через `systemd-analyze verify` и выполняет
`daemon-reload`, но не включает и не запускает задание. Если проверка units
не проходит на версии systemd этого сервера, сначала устранить причину.

В защищённом файле `/etc/budget-tracker-banking/curl.conf` заменить
`REPLACE_KOYEB_HOST` на точный HTTPS-домен приложения, а
`REPLACE_BANK_SYNC_CRON_SECRET` на существующий серверный `BANK_SYNC_CRON_SECRET`.
Не вставлять секрет в shell-команду, историю, вывод терминала или unit-файлы.
Для ручного ввода можно открыть файл командой
`sudo nano /etc/budget-tracker-banking/curl.conf`; не выводить его через `cat`.
В значениях конфигурации curl кавычки и обратные слеши экранируются `\`.

```sh
sudo stat -c '%U:%G %a %n' /etc/budget-tracker-banking /etc/budget-tracker-banking/curl.conf
sudo systemctl enable --now budget-tracker-banking.timer
systemctl list-timers budget-tracker-banking.timer --all
```

Ожидаемые права: root:root 700 для каталога, root:root 600 для конфигурации.
Следующий запуск должен соответствовать одному из трёх часов Bucharest;
`list-timers` может отображать время в часовом поясе самого сервера.

## Проверка и отключение

Проверить установленные units, расписание и состояние таймера:

```sh
sudo systemd-analyze verify /etc/systemd/system/budget-tracker-banking.service /etc/systemd/system/budget-tracker-banking.timer
systemd-analyze calendar '*-*-* 08,14,20:00:00 Europe/Bucharest' --iterations=6
systemctl is-enabled budget-tracker-banking.timer
systemctl is-active budget-tracker-banking.timer
systemctl list-timers budget-tracker-banking.timer --all
```

Ручная проверка в разрешённый час (08, 14 или 20 по Bucharest):

```sh
sudo systemctl start budget-tracker-banking.service
sudo systemctl status budget-tracker-banking.service --no-pager
sudo journalctl -u budget-tracker-banking.service -n 20 --no-pager
```

`Type=oneshot` после успешного завершения может показывать `inactive (dead)`.
Это нормально для service; сам timer должен оставаться `active (waiting)`.
Успешный ответ работающего Koyeb проверяет URL, HTTP/1.1 и авторизацию сигнала,
но не доказывает пробуждение спящего сервиса.

Для проверки пробуждения сначала дождаться реального `Sleeping` на Koyeb
после часа без входящих обращений, затем запустить задание в дневное окно.
Не обращаться к приложению перед тестом: это разбудит его раньше планировщика.
Проверить HTTP 202 в журнале и отдельно статус банковского чтения в приложении.
Вне указанных часов скрипт успешно завершится с сообщением `Skipped`, не делая
HTTP-запроса. Повторный ручной запуск всё равно соблюдает серверные ограничения.

```sh
sudo systemctl disable --now budget-tracker-banking.timer
```

Эта команда отключает будущие запуски. Уже начатое банковское чтение продолжается
на Koyeb независимо от таймера OVH.

## Источники

- [systemd.timer: OnCalendar, Persistent и suspend](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml).
- [systemd.time: календарь и именованные часовые пояса](https://github.com/systemd/systemd/blob/main/man/systemd.time.xml).
- [curl: --config, --http1.1, --max-time, --disable](https://curl.se/docs/manpage.html).
- [Koyeb Scale-to-Zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero).

Окончательная проверка `systemd-analyze verify` и календаря выполняется на
целевом Linux. Проверка пробуждения требует настоящего сна Koyeb; обычный
успешный HTTP-запрос не заменяет этот тест.

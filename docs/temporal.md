# Temporal и форматирование

`dist/format.js` — форматирование пользовательских чисел: кешированные
`Intl.NumberFormat` для целых, подписанного изменения и процентов; склонение
счётчиков через `Intl.PluralRules`. Проценты движка имеют диапазон 0–100,
поэтому перед percent formatter делятся на 100. Пробел перед `%` не вставляется
вручную: его выбирает Intl для `ru-RU`.

`dist/temporal.js` выбирает нативный `globalThis.Temporal` либо загружает локальный
ESM `@js-temporal/polyfill` 0.5.1. Даты попыток — ISO-строки `Temporal.Instant`;
группировка учитывает часовую зону устройства и календарную разницу дней,
а не вычитает 24 часа. Форматирование идёт через Temporal `toLocaleString`.
Для времени трека используются длительность и Intl-числа, не календарная дата.

## Зависимости

- `@js-temporal/polyfill` 0.5.1, лицензия ISC.
- `jsbi` 4.3.0, лицензия Apache-2.0.

Лицензии сохранены в комментариях соответствующих файлов `dist/vendor`.
Архивы загружаются из npm registry с закреплёнными SHA-512. Установочные скрипты
пакетов не выполняются. В ESM полифилла заменён только путь импорта JSBI;
source map references удалены. Сборщик и CDN при запуске игры не нужны.

Воспроизвести файлы зависимостей:

```sh
python3 scripts/vendor-temporal.py
npm test
node scripts/check-release.mjs
```

Обычные тесты и запуск игры не требуют скачивания зависимостей.
При смене версии проверить лицензии, контрольные суммы, обе ветки Temporal
и даты на границах суток и DST. Не добавлять ручное форматирование чисел или
`Date` в пользовательский код; это не относится к внутренней реализации полифилла.

## Документация

- [Полифилл Temporal](https://github.com/js-temporal/temporal-polyfill).
- [Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat).
- [Temporal.Instant.toZonedDateTimeISO](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant/toZonedDateTimeISO).

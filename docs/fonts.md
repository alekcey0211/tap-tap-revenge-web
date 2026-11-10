# Шрифты интерфейса

В v0.8.3 используются Unbounded для коротких игровых акцентов и Onest
для названий песен, настроек, пояснений и оценок попадания на canvas.
Начертания переменные, прямые; прежний наклон названий песен сохраняется.

Латиница и кириллица включены в приложение как WOFF2. Внешних запросов
к Google Fonts при запуске нет. Четыре файла занимают 131 988 байт.
Они предзагружаются, входят в проверяемую оболочку Service Worker и доступны
офлайн после её установки. До загрузки используется системный запасной шрифт.
Загрузка шрифтов не блокирует старт музыки.

## Источники

Получены 10 ноября 2026 года через официальный Google Fonts CSS API.

- [Onest — кириллица](https://fonts.gstatic.com/s/onest/v11/gNMKW3F-SZuj7xmb-HYoEoeyxMI.woff2).
- [Onest — латиница](https://fonts.gstatic.com/s/onest/v11/gNMKW3F-SZuj7xmf-HYoEoey.woff2).
- [Unbounded — кириллица](https://fonts.gstatic.com/s/unbounded/v12/Yq6W-LOTXCb04q32xlpwv8ZfvRIkSYZH.woff2).
- [Unbounded — латиница](https://fonts.gstatic.com/s/unbounded/v12/Yq6W-LOTXCb04q32xlpwu8ZfvRIkSQ.woff2).

SHA-256 файлов записаны в сгенерированном `dist/offline-assets.js`.

## Лицензии

Оригинальные тексты SIL Open Font License 1.1 и copyright сохранены
в `dist/assets/fonts/onest-license.html` и `unbounded-license.html`.
Исходники лицензий: [Onest](https://github.com/google/fonts/blob/main/ofl/onest/OFL.txt),
[Unbounded](https://github.com/google/fonts/blob/main/ofl/unbounded/OFL.txt).
Файлы шрифтов не изменялись; HTML только упаковывает полный текст лицензии.

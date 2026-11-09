# План обновления игры: сначала игровой опыт, генерация в конце

## Задача

Обновить существующую статическую игру: собственный интерфейс, удобство и звук на iPhone, результаты и локальный прогресс, установка на домашний экран, офлайн и одна согласованная новая механика. Сохранить текущие треки, карты, аудиосинхронизацию и базовые правила; не подключать генерацию, backend и платные сервисы до завершения этой работы.

## Структура плана

Этапы 1–2 — защита baseline; 3–5 — дизайн и интерфейс; 6–7 — прогресс; 8–9 — iPhone; 10–11 — PWA; 12–13 — новая механика; 14 — выпуск; 15 — возвращение к генерации.

Рабочая папка: `/Users/alekcey-ezh/Documents/private/tap-tap-web`, ветка `codex/development`. Использовать текущий Git checkout; Arcadia trunk и arc rebase к нему не относятся. Не менять чужие или несвязанные правки. Push, внешнее размещение и публикация требуют отдельного разрешения. Макеты и правила новой механики согласовать до соответствующей реализации.

Трекер: `AI-RHYTHM-plan-track.md`. После этапа записать реальные проверки; не выдавать локальный анализ workflow за исполнение GitHub Actions. Перед следующим этапом перечитать его требования. Названия новых файлов и команд ниже являются заданиями на создание, а не утверждением, что они уже существуют.

## Этапы

### Этап 1: Подготовить проверки разработки и фиксированный baseline

**Что добавить/реализовать:**

- Добавить checks.yml для push в codex/development и pull_request с read-only permissions; без job публикации.
- Ограничить build и deploy в pages.yml веткой codex/initial-web-port, включая workflow_dispatch.
- Создать validateArtifact() и assertPublishRef() в scripts/check-release.mjs: запрещать приватные пути, неожиданные типы, symlink и распознаваемые ключи в текстовых файлах. Это ограниченная проверка, а не гарантия отсутствия всех возможных секретов.
- Создать snapshot-baseline.mjs: извлекать engine и карты из фиксированного commit v0.1.0 через git show; получать результаты perfect, revenge и mistakes; сохранять контрольные суммы каталога и карт.
- Однократно сохранить полученный JSON в tests/fixtures/baseline-v0.1.0.json. Не обновлять ожидаемые значения автоматически при запуске тестов.
- Записать ограничения локальной проверки и порядок публикации. Не менять настройки GitHub и не отправлять изменения.

**Файлы:** .github/workflows/checks.yml; .github/workflows/pages.yml; scripts/check-release.mjs; scripts/snapshot-baseline.mjs; tests/fixtures/baseline-v0.1.0.json; docs/releasing.md.

**Документация:** [GitHub conditions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions).

**Примеры:** tests/game.test.mjs — autoplay; существующий pages.yml — публикация dist.

**Проверки:** node scripts/snapshot-baseline.mjs; node scripts/check-release.mjs; npm test; git diff --check.

### Этап 2: Добавить тесты baseline, артефакта и workflow

**Что добавить/реализовать:**

- Проверять текущий Game на всех 13 картах в трёх сценариях относительно сохранённых результатов v0.1.0; отдельно сверять hashes каталога и карт.
- Тестировать validateArtifact() во временных директориях: валидный сайт, отсутствие index.html, APK, runtime-каталог, скрытые файлы, symlink, приватный ключ.
- Проверить assertPublishRef() для release-ветки, development, pull-request ref, тега и отсутствующего ref.
- Проверить наличие branch guards в обоих Pages jobs и отсутствие публикации в checks.yml. Отделять структурный тест YAML от реального запуска GitHub Actions.

**Файлы:** tests/baseline.test.mjs; tests/release.test.mjs; tests/workflow.test.mjs.

**Примеры:** tests/game.test.mjs; tests/audio.test.mjs — node:test, тесты публичных функций.

**Проверки:** node --test tests/baseline.test.mjs tests/release.test.mjs tests/workflow.test.mjs; npm test; node scripts/check-release.mjs; git diff --check.

### Этап 3: Согласовать визуальную концепцию и экраны

**Что добавить/реализовать:**

- Подготовить макеты iPhone для библиотеки, игрового поля, паузы, результатов и настроек. Генерацию и её состояния не включать.
- Представить Album Art + Neon Stage как предложение, получить согласование до замены UI. Согласовать временное обозначение проекта без преждевременного переименования репозитория.
- Определить размеры зон касания, контраст, safe area, reduced motion, загрузку и ошибки. Сохранить выбор трёх текущих треков и четырёх уровней сложности.
- Подготовить собственную графику интерфейса; не менять музыку и обложки.

**Файлы:** docs/design.md; design/; output/.

**Примеры:** dist/index.html; dist/style.css; dist/renderer.js; output/library-mobile.png.

**Проверки:** git diff --check; просмотр всех перечисленных состояний и явное согласование макетов.

### Этап 4: Обновить библиотеку, игровое поле и результаты

**Что добавить/реализовать:**

- Переработать index.html/style.css по утверждённым макетам: чёткая обложка, большая кнопка Играть, компактная сложность, понятный рекорд.
- Обновить Renderer собственной графикой и читаемым HUD; не перекрывать ноты счётчиками и эффектами.
- Сохранить ноты, TRAVEL, окна попадания, Game.score и AudioContext clock; reduced motion распространяется на новые эффекты.
- На результатах оставить повтор и выбор песни, различать обычную игру, demo и калибровку. Убрать из основного экрана технические сведения об APK, сохранив раздел Об игре.

**Файлы:** dist/index.html; dist/style.css; dist/renderer.js; dist/app.js; dist/assets/identity/.

**Документация:** docs/design.md — утверждённые макеты.

**Примеры:** Renderer.render(); app.js:refresh/finish; tests/game.test.mjs.

**Проверки:** node --check dist/app.js; node --check dist/renderer.js; npm test; node scripts/check-release.mjs; git diff --check.

### Этап 5: Проверить редизайн и неизменность механик

**Что добавить/реализовать:**

- Пройти все baseline-тесты; дополнить тесты только изменённых публичных сценариев.
- Через chromium-secure-mcp проверить экраны при 320px, 390×844 и desktop, видимые фокусы и читаемость длинных названий.
- Проверить pause/resume, demo, калибровку, результаты и отсутствие перекрытия нот. Сохранить снимки; ограничения browser policy не обходить.

**Файлы:** tests/game.test.mjs; docs/modern-verification.md; output/.

**Примеры:** VERIFICATION.md — различать браузер, синтетический ввод и физическое устройство.

**Проверки:** npm test; node scripts/check-release.mjs; git diff --check; браузерный чеклист.

### Этап 6: Добавить локальную историю и перенос прогресса

**Что добавить/реализовать:**

- Создать storage.js с loadSettings(), saveSettings(), loadProgress(), recordAttempt(), exportProgress(), importProgress(). Передавать Storage в функции для тестирования отказов.
- Ограничить историю последними 100 попытками; хранить версию схемы, ID песни, сложность, версию карты/правил и результаты. Demo и калибровку не включать в личные достижения.
- Прочитать старые ttr-web-settings и ttr-web-records, проверить значения и сохранить новые данные в отдельном пространстве имён; старые ключи не удалять.
- Импортировать только проверенный JSON ограниченного размера с известной версией. Перед заменой показывать подтверждение; некорректный импорт не должен частично менять данные.
- Показать изменение относительно предыдущего личного рекорда; зафиксировать прежний рекорд до его обновления. Экспорт не содержит музыку и не является облачной синхронизацией.

**Файлы:** dist/storage.js; dist/app.js; dist/index.html; dist/style.css.

**Примеры:** app.js:saveSettings/finish; tests/audio.test.mjs — подставные зависимости.

**Проверки:** node --check dist/storage.js; npm test; git diff --check.

### Этап 7: Проверить миграцию, историю и импорт

**Что добавить/реализовать:**

- Добавить публичные тесты валидной/повреждённой записи, запрета localStorage, лимита истории и сохранности старых ключей.
- Проверить экспорт/импорт, неизвестную версию, oversized-файл, недопустимые числа, сохранность данных при отказе, повторный импорт и разделение версий рекордов.
- Проверить, что новое личное достижение вычисляется по старому рекорду и что demo не попадает в историю.

**Файлы:** tests/storage.test.mjs; docs/modern-verification.md.

**Примеры:** tests/audio.test.mjs; tests/game.test.mjs.

**Проверки:** node --test tests/storage.test.mjs; npm test; git diff --check.

### Этап 8: Улучшить звук, ввод и жизненный цикл на iPhone

**Что добавить/реализовать:**

- В start() не начинать игру после ухода в библиотеку или скрытия страницы во время загрузки; сохранять requestId cancellation.
- Обработать interrupted/suspended/closed AudioContext, возобновлять звук только из жеста пользователя и сохранять позицию.
- Проверить pointercancel, lostpointercapture, несколько источников одной дорожки и отпускание удержаний после паузы.
- Ограничить кеш AudioBuffer двумя последними треками, сохраняя текущий; не накапливать буферы бесконечно.
- Учесть safe area и изменяемую высоту Safari; перестать непрерывно перерисовывать неподвижную паузу и обновлять неизменившийся DOM.
- Заменить сообщения про локальный сервер на понятные ошибки загрузки и повтор.

**Файлы:** dist/audio.js; dist/app.js; dist/renderer.js; dist/style.css; dist/index.html.

**Документация:** [AudioContext state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state).

**Примеры:** SongAudio; app.js:start/pause/resume/down/up/frame.

**Проверки:** npm test; node --check dist/app.js; git diff --check.

### Этап 9: Проверить звук, мультитач и восстановление

**Что добавить/реализовать:**

- Дополнить аудиотесты состояниями контекста, кешем и отменой запуска; при выделении контроллера сессии тестировать его публичный интерфейс.
- На физическом iPhone проверить первый звук, silent switch, экран блокировки, смену приложения, паузу на удержании, смену аудиовыхода и повтор трека.
- Измерить frame intervals на плотной карте 60 секунд; записать устройство и iOS. Моки не считать проверкой аппаратной задержки.

**Файлы:** tests/audio.test.mjs; tests/session.test.mjs; docs/modern-verification.md.

**Примеры:** tests/audio.test.mjs; VERIFICATION.md.

**Проверки:** npm test; браузерный сценарий; отдельный чеклист iPhone; git diff --check.

### Этап 10: Добавить установку на экран и офлайн-треки

**Что добавить/реализовать:**

- Добавить manifest.webmanifest, apple-touch-icon и service worker с относительным scope конкретного приложения, совместимым с /tap-tap-revenge-web/.
- В offline.js реализовать регистрацию, downloadTrack(), removeTrack(), getOfflineState(). Скачивать аудио, обложку и карты выбранного трека; статус готовности выставлять только после проверки всего набора.
- Разделить кеш оболочки и выбранных треков, версионировать их; хранить только известные same-origin GET-ресурсы. Не кешировать будущие generation API.
- Не активировать обновление принудительно во время песни; показывать обновление между сессиями. Не очищать кеш другой версии, пока есть её активные клиенты.
- Обрабатывать недостаток места, частичную загрузку, прерванное скачивание и удаление браузером данных. Офлайн без предварительной загрузки не обещать.
- Обновить MIME .webmanifest/.svg/.ico в scripts/serve.mjs; для iPhone проверять PWA на HTTPS, LAN HTTP не считать достаточным.

**Файлы:** dist/manifest.webmanifest; dist/sw.js; dist/offline.js; dist/assets/identity/; dist/index.html; dist/app.js; scripts/serve.mjs.

**Документация:** [Service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers); [WebKit storage](https://webkit.org/blog/14403/updates-to-storage-policy/).

**Примеры:** scripts/serve.mjs; dist/assets/catalog.json; app.js:json/start.

**Проверки:** node --check dist/sw.js; node --check dist/offline.js; npm test; node scripts/check-release.mjs; git diff --check.

### Этап 11: Проверить офлайн и обновление PWA

**Что добавить/реализовать:**

- Проверить manifest, относительные пути, границы scope и публичные операции offline.js с подставным CacheStorage.
- В браузере проверить первый запуск онлайн, скачивание, выключение сети, полное прохождение скачанного трека, сообщение для нескачанного трека и восстановление после частичного отказа.
- Проверить обновление с открытой песней и двумя вкладками; старая сессия не должна смешивать код и ресурсы разных версий.
- На iPhone проверить добавление на домашний экран, повторный запуск без сети и экспорт прогресса. Для HTTPS-preview сначала получить отдельное согласование размещения.

**Файлы:** tests/offline.test.mjs; tests/manifest.test.mjs; docs/modern-verification.md.

**Примеры:** tests/audio.test.mjs — mocks; VERIFICATION.md — фактические сценарии.

**Проверки:** npm test; node scripts/check-release.mjs; browser/PWA checklist; iPhone; git diff --check.

### Этап 12: Согласовать и реализовать первую новую механику

**Что добавить/реализовать:**

- До кода утвердить docs/mechanics.md: точные условия Pulse, сегменты текущих карт, лишние нажатия, удержания, пауза, demo и калибровка. Не извлекать музыкальные фразы автоматически на этом этапе.
- После согласования реализовать PhraseProgress.recordInput/advance/finish отдельно от базового Game.score, добавить отображение прогресса и наград.
- Хранить правила и идентификатор механики отдельно от базового рекорда; уменьшение эффектов не меняет игровой результат.

**Файлы:** docs/mechanics.md; dist/phrase-progress.js; dist/app.js; dist/renderer.js; dist/storage.js.

**Документация:** docs/mechanics.md — контракт до реализации.

**Примеры:** Game.press/finish; app.js:down/frame/finish.

**Проверки:** явное согласование правил; node --check dist/phrase-progress.js; npm test; git diff --check.

### Этап 13: Проверить новую механику и честность рекордов

**Что добавить/реализовать:**

- Проверить все границы и исключения утверждённых правил, повторный advance/finish и однократное начисление.
- Сравнить базовые результаты с v0.1.0; убедиться, что demo и калибровка не дают наград.
- Проверить читаемость нот и reduced motion на телефоне.

**Файлы:** tests/phrase-progress.test.mjs; tests/storage.test.mjs; docs/modern-verification.md.

**Примеры:** tests/game.test.mjs; tests/baseline.test.mjs.

**Проверки:** npm test; node scripts/check-release.mjs; iPhone checklist; git diff --check.

### Этап 14: Принять и выпустить статическую версию

**Что добавить/реализовать:**

- Проверить все предыдущие этапы, CI после отдельно разрешённого push и текущую работоспособность Pages workflow.
- Проверить новый релиз на отдельном согласованном preview, включая PWA; не подменять основную игру до приёмки.
- Перед публикацией сохранить тег, проверить commit и артефакт; выпускать только после отдельного разрешения, не перемещая v0.1.0.
- Записать процедуру возврата предыдущего кода и поведение service worker при откате. Проверить экспорт/импорт и не удалять пользовательские данные.
- После выкладки проверить HTTPS-файлы, музыку и запуск на iPhone с выключенным компьютером разработчика.

**Файлы:** docs/releasing.md; docs/modern-verification.md; README.md; vibe/AI-RHYTHM-plan-track.md.

**Примеры:** .github/workflows/pages.yml; существующий v0.1.0.

**Проверки:** npm test; node scripts/check-release.mjs; git diff --check; CI/deployment status; HTTPS/PWA/iPhone smoke.

### Этап 15: Вернуться к генерации после готовой игры

**Что добавить/реализовать:**

- Получить отдельное подтверждение начала генеративного этапа. До этого не подключать провайдера, backend и оплату.
- Пересмотреть AI-GENERATION-plan.md по фактическому интерфейсу, сохранениям и PWA; убрать уже выполненные пункты и уточнить интеграцию каталога.
- Сохранить решения: инструментальная музыка, доступ всем и максимум $20 на эксперимент. Перепроверить тарифы и права до нового согласования расходов.

**Файлы:** vibe/AI-GENERATION-plan.md; vibe/AI-GENERATION-concept.md; vibe/AI-GENERATION-plan-track.md.

**Примеры:** реализованные каталог, хранилище и PWA из активного плана.

**Проверки:** проверка согласованного нового плана; git diff --check.

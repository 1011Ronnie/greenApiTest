# GREEN-API Telegram Chat

SPA на React 19, TypeScript и Vite: подключение Telegram instance, создание личных чатов по номеру, отправка и получение текста.

## Запуск

Из корня проекта:

```bash
npm run dev
```

Откройте адрес, который выведет Vite. Для проверки production-сборки:

```bash
npm run build
npm run preview
```

Дополнительные команды:

```bash
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck
npm run test
npm run build
```

## Подготовка Telegram instance

1. Зарегистрируйтесь в [личном кабинете GREEN-API](https://console.green-api.com/), создайте Telegram instance и авторизуйте свой Telegram-аккаунт. Порядок описан в [официальной инструкции](https://green-api.com/telegram/docs/before-start/).
2. Скопируйте параметры `apiUrl`, `idInstance` и `apiTokenInstance` из карточки instance. `mediaUrl` для текстового чата не нужен. Введите параметры в форму приложения; Вход в сессию разрешён только при состоянии `authorized`.
3. В настройках instance оставьте `webhookUrl` пустым и включите `incomingWebhook`, `outgoingWebhook`, `outgoingMessageWebhook`, `outgoingAPIMessageWebhook`. Через кабинет это переключатели входящих сообщений, сообщений с телефона, сообщений через API и статусов отправки. Сохраните настройки.
4. Подготовьте второй Telegram-аккаунт для обмена.

## Использование

Введите номер в международном формате: приложение убирает пробелы, скобки и дефисы, но не добавляет код страны. Повторное добавление выбирает существующий чат. После создания можно отправлять текст до 4096 символов: Enter отправляет, Shift+Enter добавляет строку;
«Отключиться» отменяет активные запросы и паузы, удаляет cache сессии и забывает токен, чаты и сообщения. Обновление страницы также начинает пустую сессию.

## GitHub Pages

Адрес после публикации: [1011Ronnie.github.io/greenApiTest/](https://1011Ronnie.github.io/greenApiTest/).


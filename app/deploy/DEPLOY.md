# Деплой OneTable на `app.onetable.pro` (VPS)

Архитектура:
- Лендинг `onetable.pro` остаётся на GitHub Pages.
- Кабинет `app.onetable.pro` крутится на VPS: `Nginx (HTTPS + rate-limit) → Node 24 (127.0.0.1:4181) → PostgreSQL (отдельная БД onetable с RLS)`.
- База Дойла и база OneTable полностью изолированы друг от друга.

---

## 1. DNS
У регистратора домена `onetable.pro` добавить запись:
- **Тип:** `A`
- **Имя:** `app`
- **Значение:** `<IP вашего VPS>`

---

## 2. Подготовка PostgreSQL на VPS
Убедитесь, что PostgreSQL слушает только `127.0.0.1` (`listen_addresses = 'localhost'` в `postgresql.conf`).

Отредактируйте пароли в `app/deploy/setup-db.sql` и выполните от `postgres`:
```bash
sudo -u postgres psql -f /opt/onetable/app/deploy/setup-db.sql
```

---

## 3. Код, сборка и применение схемы + RLS
```bash
sudo useradd -r -s /usr/sbin/nologin onetable
sudo mkdir -p /opt/onetable /etc/onetable /var/backups/onetable
sudo git clone https://github.com/frimarion/onetable.git /opt/onetable
cd /opt/onetable/app
sudo npm ci
sudo npm run build
```

Применить схему и RLS от роли владельца `onetable_owner`:
```bash
DATABASE_URL="postgres://onetable_owner:<OWNER_PASS>@127.0.0.1:5432/onetable" \
  node server/bootstrap.ts init-schema
```

Выдать минимальные права рабочей роли `onetable_app` (без `DROP`, `TRUNCATE` и `BYPASSRLS`):
```bash
sudo -u postgres psql -d onetable -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO onetable_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO onetable_app;
"
```

---

## 4. Создать первый клуб и владельца
```bash
DATABASE_URL="postgres://onetable_owner:<OWNER_PASS>@127.0.0.1:5432/onetable" \
  node server/bootstrap.ts create-club doyle "Doyle Poker Club" "Москва" "#2BD98A"

DATABASE_URL="postgres://onetable_owner:<OWNER_PASS>@127.0.0.1:5432/onetable" \
  node server/bootstrap.ts create-owner doyle alexander@doyle.ru "Александр" "<НАДЁЖНЫЙ_ПАРОЛЬ_10+>"
```

Для подключения нового клуба-клиента (выдаст одноразовую ссылку на 24 ч):
```bash
DATABASE_URL="postgres://onetable_owner:<OWNER_PASS>@127.0.0.1:5432/onetable" \
  node server/bootstrap.ts create-club royal "Royal Poker Club" "Казань" "#2F6BFF"

DATABASE_URL="postgres://onetable_owner:<OWNER_PASS>@127.0.0.1:5432/onetable" \
  node server/bootstrap.ts invite royal owner@royalpoker.ru owner
```

---

## 5. Файл окружения и systemd
Создать `/etc/onetable/app.env` с правами `600` (только для пользователя `onetable`):
```bash
sudo tee /etc/onetable/app.env >/dev/null <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=4181
COOKIE_SECURE=1
DATABASE_URL=postgres://onetable_app:<APP_PASS>@127.0.0.1:5432/onetable
EOF
sudo chown onetable:onetable /etc/onetable/app.env
sudo chmod 600 /etc/onetable/app.env
```

Запустить сервис:
```bash
sudo cp /opt/onetable/app/deploy/onetable.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now onetable
sudo systemctl status onetable
```

Для автоматического открытия турниров Doyle в OneTable создайте `/etc/onetable/doyle.env` с правами `600`:

- `DOYLE_ONETABLE_USER_ID` — ID связанного владельца клуба `doyle` в базе OneTable.
- `DOYLE_SERVICE_ROLE_KEY` — серверный ключ Supabase Doyle.
- `DOYLE_COMMANDS_ENABLED=1` — после установки `deploy/doyle-commands.sql` в базе Doyle.

Сервис использует локальный шлюз Supabase Doyle `127.0.0.1:8000`. SQL устанавливается
в базе Supabase Doyle. Функция принимает команды только от серверной роли, сохраняет
совместимость с `rooms.state` и сверяет версию комнаты до записи.
После настройки файла перезапустите `onetable`.

---

## 6. Nginx и HTTPS (Let's Encrypt)
```bash
sudo cp /opt/onetable/app/deploy/nginx-app.onetable.pro.conf /etc/nginx/sites-available/app.onetable.pro
sudo ln -s /etc/nginx/sites-available/app.onetable.pro /etc/nginx/sites-enabled/
sudo certbot --nginx -d app.onetable.pro
sudo nginx -t && sudo systemctl reload nginx
```

Для диагностики подключения `app` и `gw` можно включить отдельный журнал. Он записывает
IP, этап, маршрут, HTTP-статус, время ответа приложения и объём передачи. Файл ротируется
вместе с журналами Nginx. Доступ ограничен администратором и группой `adm`.

```bash
sudo touch /var/log/nginx/onetable-connection.log
sudo chown www-data:adm /var/log/nginx/onetable-connection.log
sudo chmod 0640 /var/log/nginx/onetable-connection.log
sudo install -m 0644 /opt/onetable/app/deploy/onetable-connection-log.conf /etc/nginx/conf.d/onetable-connection-log.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. Ежедневный бэкап БД (cron)
Добавить в `sudo crontab -e`:
```cron
15 4 * * * sudo -u postgres pg_dump -Fc onetable > /var/backups/onetable/onetable-$(date +\%F).dump && find /var/backups/onetable -name '*.dump' -mtime +14 -delete
```

## Обновление доступа сотрудников на существующем сервере

Перед запуском обновлённого API примените изменение схемы от роли владельца базы.
Команда добавляет поле номера стола в таблицу приглашений и сохраняет ранее созданные учётные записи.

```sql
ALTER TABLE club_invites ADD COLUMN IF NOT EXISTS table_no integer CHECK (table_no IS NULL OR table_no > 0);
```

Существующая роль `admin` отображается как «Менеджер». Владелец открывает «Учётные записи»
и выдаёт одноразовые ссылки менеджерам, флорам и дилерам. Для дилера он указывает номер
стола в клубе. Дилеров без номера стола нужно пригласить заново с назначением.

В турнире OneTable кнопка «ТВ-дисплей» открывает отдельную ссылку для экрана.
В связанном кабинете Doyle эта кнопка открывает экран Doyle в текущей учётной записи владельца.

---

## 8. Вход и привязка через Telegram, VK ID и Яндекс ID

Кнопки на экране входа и в «Настройки профиля → Учётная запись → Способы входа» активируются автоматически, как только заданы переменные окружения в `/etc/onetable/app.env`.

### Telegram (рекомендуется OpenID Connect через `@BotFather`)
1. Откройте `@BotFather` → выберите бота → **Web Login / Login Widget** → включите **OpenID Connect (OIDC)**.
2. Укажите:
   - **Allowed Origin:** `https://app.onetable.pro`
   - **Redirect URI:** `https://app.onetable.pro/api/auth/oauth/telegram/callback`
3. Скопируйте `Client ID` и `Client Secret` в `/etc/onetable/app.env`:
   ```env
   TELEGRAM_CLIENT_ID=<client_id>
   TELEGRAM_CLIENT_SECRET=<client_secret>
   ```
   *(Альтернатива — классический виджет `telegram-widget.js?24`: выполните `/setdomain` в `@BotFather` на `app.onetable.pro` и задайте `TELEGRAM_BOT_USERNAME` и `TELEGRAM_BOT_TOKEN`.)*

### VK ID (OAuth 2.1 + PKCE, `id.vk.ru`)
1. Создайте веб-приложение в [кабинете VK ID](https://id.vk.ru/about/business/go).
2. Укажите:
   - **Базовый домен:** `app.onetable.pro`
   - **Доверенный Redirect URL:** `https://app.onetable.pro/api/auth/oauth/vk/callback`
3. Скопируйте **ID приложения** в `/etc/onetable/app.env`:
   ```env
   VK_CLIENT_ID=<app_id>
   ```

### Яндекс ID (OAuth 2.0 + PKCE)
1. Создайте приложение в [Яндекс OAuth](https://oauth.yandex.ru/client/new) (платформа «Веб-сервисы»).
2. В разделе прав отметьте: `Доступ к логину, имени и фамилии, полу` (`login:info`) и `Доступ к портрету пользователя` (`login:avatar`).
3. Укажите **Redirect URI:** `https://app.onetable.pro/api/auth/oauth/yandex/callback`.
4. Скопируйте `ClientID` и `Client secret` в `/etc/onetable/app.env`:
   ```env
   YANDEX_CLIENT_ID=<client_id>
   YANDEX_CLIENT_SECRET=<client_secret>
   ```

После обновления `/etc/onetable/app.env` (и конфига Nginx с `Referrer-Policy: strict-origin-when-cross-origin`) перезапустите сервис:
```bash
sudo systemctl restart onetable
sudo nginx -t && sudo systemctl reload nginx
```

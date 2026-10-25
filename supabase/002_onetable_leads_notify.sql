-- OneTable: уведомление в Telegram о новой заявке с сайта.
-- Telegram API с сервера недоступен напрямую, поэтому запрос идёт через прокси (как у функций Doyle).
-- Токен бота, chat id и адрес прокси лежат в Supabase Vault (секреты onetable_bot_token, onetable_chat_id, onetable_tg_api)
-- и кладутся туда отдельно, из .env на сервере, — в этом файле их нет.
-- В сообщении нет персональных данных: только номер заявки, клуб и город. Контакт смотреть в Studio.

create or replace function public.onetable_leads_notify()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_chat  text;
  v_api   text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'onetable_bot_token';
  select decrypted_secret into v_chat  from vault.decrypted_secrets where name = 'onetable_chat_id';
  select decrypted_secret into v_api   from vault.decrypted_secrets where name = 'onetable_tg_api';
  if v_token is null or v_chat is null or v_api is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_api || '/bot' || v_token || '/sendMessage',
    body    := jsonb_build_object(
                 'chat_id', v_chat,
                 'text', format(E'Новая заявка №%s с сайта OneTable\nКлуб: %s%s\nКонтакт и сообщение — в Supabase Studio, таблица onetable_leads',
                                new.id, new.club, coalesce(', ' || new.city, ''))),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  -- уведомление не должно мешать сохранить заявку
  raise warning 'onetable_leads_notify: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.onetable_leads_notify() from public, anon, authenticated;

drop trigger if exists onetable_leads_notify on public.onetable_leads;
create trigger onetable_leads_notify
  after insert on public.onetable_leads
  for each row execute function public.onetable_leads_notify();

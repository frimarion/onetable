-- OneTable: в уведомлении о заявке — контакт и сообщение, чтобы отвечать сразу из Telegram.
-- Это передача персональных данных в Telegram (трансграничная): она указана в privacy.html (п. 6) и consent.html (п. 3).

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
                 'disable_web_page_preview', true,
                 'text', format(E'Новая заявка №%s с сайта OneTable\nКлуб: %s%s\nКонтакт: %s%s',
                                new.id, new.club, coalesce(', ' || new.city, ''), new.contact,
                                coalesce(E'\nСообщение: ' || new.message, ''))),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  raise warning 'onetable_leads_notify: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.onetable_leads_notify() from public, anon, authenticated;

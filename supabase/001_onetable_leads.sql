-- OneTable: заявки с сайта (форма «Подключиться»).
-- Применяется к self-hosted Supabase на сервере Doyle (Timeweb, Москва): база в РФ — требование 152-ФЗ о локализации.
-- Сайт пишет сюда через PostgREST с anon-ключом; читать заявки anon не может.

create table if not exists public.onetable_leads (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  club        text not null check (char_length(btrim(club)) between 1 and 120),
  city        text check (city is null or char_length(city) <= 80),
  contact     text not null check (char_length(btrim(contact)) between 3 and 120),
  message     text check (message is null or char_length(message) <= 2000),
  consent     boolean not null check (consent),                        -- галочка согласия в форме
  consent_doc text not null default 'consent.html, редакция 2026-10-25' -- какую редакцию согласия принял посетитель
);

comment on table public.onetable_leads is 'Заявки с сайта OneTable. Персональные данные: хранить не дольше 1 года (см. privacy.html).';

alter table public.onetable_leads enable row level security;

-- anon может только добавить заявку: без чтения, изменения и удаления
revoke all on public.onetable_leads from anon, authenticated;
grant insert (club, city, contact, message, consent) on public.onetable_leads to anon;
grant usage on sequence public.onetable_leads_id_seq to anon;

drop policy if exists onetable_leads_insert on public.onetable_leads;
create policy onetable_leads_insert on public.onetable_leads
  for insert to anon
  with check (consent);

-- Защита от спама: не больше 20 заявок за 10 минут на весь сайт
create or replace function public.onetable_leads_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.onetable_leads where created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'too many requests' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists onetable_leads_rate_limit on public.onetable_leads;
create trigger onetable_leads_rate_limit
  before insert on public.onetable_leads
  for each row execute function public.onetable_leads_rate_limit();

-- Срок хранения 1 год (обещан в политике): ежедневная очистка, если в базе есть pg_cron
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'onetable_leads_retention';
    perform cron.schedule('onetable_leads_retention', '15 4 * * *',
      $job$delete from public.onetable_leads where created_at < now() - interval '1 year'$job$);
  else
    raise notice 'pg_cron не установлен: старые заявки нужно удалять вручную (старше 1 года)';
  end if;
end;
$$;

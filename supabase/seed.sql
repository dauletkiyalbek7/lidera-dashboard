-- =============================================================================
-- Lidera Final — демонстрационные данные
--
-- Скрипт идемпотентен: если демо-компания уже есть, он ничего не делает.
-- Все демо-строки принадлежат компании с is_demo = true, поэтому боевые данные
-- других компаний с ними не смешиваются и удаляются одной строкой:
--   delete from public.companies where is_demo;
--
-- Учётные записи создаются напрямую в auth.users вместе с записью в
-- auth.identities — так работает штатный вход по email и паролю.
-- ПАРОЛИ НИЖЕ — ДЕМОНСТРАЦИОННЫЕ. Смените их после первого входа.
--
-- Случайность намеренно сделана детерминированной (хеш от идентификатора
-- строки), а не через random(): условие вида «random() < c.rate», зависящее
-- только от таблицы параметров, планировщик вычисляет один раз на её строку,
-- и вместо распределения получается «всё или ничего» по каждому креативу.
-- =============================================================================

do $$
declare
  v_admin_email    text := 'admin@lidera.kz';
  v_admin_password text := 'LideraAdmin2026!';
  v_dir_email      text := 'director@democompany.kz';
  v_dir_password   text := 'DemoDirector2026!';

  v_admin_user uuid;
  v_dir_user   uuid;
  v_company    uuid;
  v_acc_meta   uuid;
  v_acc_tiktok uuid;
  v_camp_meta  uuid;
  v_camp_tt    uuid;
  v_set_meta   uuid;
  v_set_tt     uuid;
  v_days       int := 90;
begin
  if exists (select 1 from public.companies where is_demo) then
    raise notice 'Демо-данные уже загружены — пропускаем.';
    return;
  end if;

  -- Псевдослучайное число 0..1, однозначно определяемое строкой-семенем.
  create or replace function pg_temp.rnd(seed text)
  returns numeric language sql immutable as $fn$
    select (('x' || substr(md5(seed), 1, 8))::bit(32)::bigint)::numeric / 4294967296.0;
  $fn$;

  -- ---------------------------------------------------------------------
  -- 1. Платформенный администратор
  -- ---------------------------------------------------------------------
  select id into v_admin_user from auth.users where email = v_admin_email;

  if v_admin_user is null then
    v_admin_user := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      -- GoTrue читает эти колонки как строки: NULL здесь ломает вход
      -- ошибкой «Database error querying schema».
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_admin_user, 'authenticated',
      'authenticated', v_admin_email,
      extensions.crypt(v_admin_password, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Администратор Lidera"}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_admin_user, v_admin_user::text,
      jsonb_build_object('sub', v_admin_user::text, 'email', v_admin_email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  end if;

  insert into public.profiles (user_id, company_id, role, name, email)
  values (v_admin_user, null, 'SUPER_ADMIN', 'Администратор Lidera', v_admin_email)
  on conflict (user_id) do update
    set role = 'SUPER_ADMIN', name = excluded.name, email = excluded.email;

  -- ---------------------------------------------------------------------
  -- 2. Демо-компания и её директор
  -- ---------------------------------------------------------------------
  insert into public.companies (name, director_name, phone, email, status, is_demo)
  values ('Demo Company', 'Айгерим Смагулова', '+7 700 123 45 67',
          v_dir_email, 'active', true)
  returning id into v_company;

  insert into public.subscriptions (company_id, plan, status, start_date)
  values (v_company, 'pro', 'active', current_date - 60);

  select id into v_dir_user from auth.users where email = v_dir_email;

  if v_dir_user is null then
    v_dir_user := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      -- GoTrue читает эти колонки как строки: NULL здесь ломает вход
      -- ошибкой «Database error querying schema».
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_dir_user, 'authenticated',
      'authenticated', v_dir_email,
      extensions.crypt(v_dir_password, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"Айгерим Смагулова"}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_dir_user, v_dir_user::text,
      jsonb_build_object('sub', v_dir_user::text, 'email', v_dir_email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  end if;

  insert into public.profiles (user_id, company_id, role, name, email, phone)
  values (v_dir_user, v_company, 'DIRECTOR', 'Айгерим Смагулова', v_dir_email,
          '+7 700 123 45 67')
  on conflict (user_id) do update
    set company_id = excluded.company_id, role = 'DIRECTOR';

  -- ---------------------------------------------------------------------
  -- 3. Рекламная иерархия
  -- ---------------------------------------------------------------------
  insert into public.ad_accounts (company_id, platform, account_name, account_id, status)
  values (v_company, 'meta', 'Demo Company — Meta Ads', 'act_1029384756', 'connected')
  returning id into v_acc_meta;

  insert into public.ad_accounts (company_id, platform, account_name, account_id, status)
  values (v_company, 'tiktok', 'Demo Company — TikTok Ads', '7291038475610', 'connected')
  returning id into v_acc_tiktok;

  insert into public.campaigns (company_id, ad_account_id, external_id, name, platform, objective)
  values (v_company, v_acc_meta, 'cmp_meta_001', 'Курс английского — лиды',
          'meta', 'LEAD_GENERATION')
  returning id into v_camp_meta;

  insert into public.campaigns (company_id, ad_account_id, external_id, name, platform, objective)
  values (v_company, v_acc_tiktok, 'cmp_tt_001', 'Пробный урок — TikTok',
          'tiktok', 'LEAD_GENERATION')
  returning id into v_camp_tt;

  insert into public.ad_sets (company_id, campaign_id, external_id, name)
  values (v_company, v_camp_meta, 'set_meta_001', 'Алматы · 25–45 · интересы: обучение')
  returning id into v_set_meta;

  insert into public.ad_sets (company_id, campaign_id, external_id, name)
  values (v_company, v_camp_tt, 'set_tt_001', 'Казахстан · 18–35 · широкая')
  returning id into v_set_tt;

  -- Параметры подобраны так, чтобы демо показывало главную мысль платформы:
  -- у «Video 02 — Скидка 50%» самый дешёвый лид и худшая окупаемость.
  create temporary table _seed_creative (
    id            uuid,
    name          text,
    platform      text,
    format        text,
    daily_spend   numeric,
    leads_per_day int,
    trial_rate    numeric,
    sale_rate     numeric,
    avg_check     numeric
  ) on commit drop;

  insert into _seed_creative
    (id, name, platform, format, daily_spend, leads_per_day, trial_rate, sale_rate, avg_check)
  values
    (gen_random_uuid(), 'Video 01 — Отзыв ученицы', 'meta',   'video',    12000, 3, 0.55, 0.220, 185000),
    (gen_random_uuid(), 'Video 02 — Скидка 50%',    'meta',   'video',    15000, 6, 0.20, 0.012, 150000),
    (gen_random_uuid(), 'Story 03 — Разбор ошибок', 'meta',   'image',     6000, 2, 0.45, 0.100, 190000),
    (gen_random_uuid(), 'Carousel 01 — Программа',  'meta',   'carousel',  5000, 2, 0.40, 0.070, 180000),
    (gen_random_uuid(), 'TikTok 01 — Тренд',        'tiktok', 'video',     7000, 3, 0.35, 0.050, 170000),
    (gen_random_uuid(), 'TikTok 02 — Оффер',        'tiktok', 'video',     9000, 4, 0.15, 0.008, 160000);

  insert into public.creatives (id, company_id, external_id, name, platform, format, status)
  select c.id, v_company, 'crt_' || substr(c.id::text, 1, 8), c.name, c.platform,
         c.format, 'active'
  from _seed_creative c;

  insert into public.ads (company_id, ad_set_id, creative_id, external_id, name)
  select v_company,
         case when c.platform = 'meta' then v_set_meta else v_set_tt end,
         c.id, 'ad_' || substr(c.id::text, 1, 8), c.name || ' — объявление'
  from _seed_creative c;

  -- ---------------------------------------------------------------------
  -- 4. Дневные метрики рекламы
  -- ---------------------------------------------------------------------
  insert into public.ad_metrics (
    company_id, creative_id, campaign_id, platform, date,
    spend, impressions, reach, clicks, ctr, cpc, cpm, leads, cpl
  )
  select
    v_company, c.id,
    case when c.platform = 'meta' then v_camp_meta else v_camp_tt end,
    c.platform, d.day, s.spend, i.impressions,
    (i.impressions * 0.72)::bigint, k.clicks,
    round((k.clicks::numeric / nullif(i.impressions, 0)) * 100, 4),
    round(s.spend / nullif(k.clicks, 0), 2),
    round((s.spend / nullif(i.impressions, 0)) * 1000, 2),
    c.leads_per_day,
    round(s.spend / nullif(c.leads_per_day, 0), 2)
  from _seed_creative c
  cross join generate_series(0, v_days - 1) as g(offset_days)
  cross join lateral (select (current_date - g.offset_days)::date as day) d
  cross join lateral (
    select round(
      c.daily_spend * (0.8 + pg_temp.rnd(c.id::text || d.day::text || 'spend') * 0.4), 2
    ) as spend
  ) s
  cross join lateral (
    select (s.spend * (18 + pg_temp.rnd(c.id::text || d.day::text || 'imp') * 8))::bigint
      as impressions
  ) i
  cross join lateral (
    select greatest(1, (
      i.impressions * (0.008 + pg_temp.rnd(c.id::text || d.day::text || 'clk') * 0.010)
    )::bigint) as clicks
  ) k;

  -- ---------------------------------------------------------------------
  -- 5. Лиды с рекламной атрибуцией
  -- ---------------------------------------------------------------------
  insert into public.leads (
    company_id, name, phone, source, platform, campaign_id, ad_set_id,
    creative_id, utm_source, utm_medium, utm_campaign, utm_content, status, created_at
  )
  select
    v_company,
    (array[
      'Айдана Нурланова','Ержан Мукашев','Алина Ким','Данияр Сапаров','Мадина Оспанова',
      'Тимур Жаксылык','Асель Бектурова','Нурлан Абдиров','Камила Ахметова','Санжар Токтаров',
      'Диана Есимова','Арман Кушербаев','Жанна Сеитова','Ильяс Бейсенов','Айгуль Тлеубаева'
    ])[1 + floor(pg_temp.rnd(seed.key || 'name') * 15)::int],
    '+7 7' || lpad(floor(pg_temp.rnd(seed.key || 'phone') * 999999999)::text, 9, '0'),
    case when c.platform = 'meta' then 'instagram' else 'tiktok' end,
    c.platform,
    case when c.platform = 'meta' then v_camp_meta else v_camp_tt end,
    case when c.platform = 'meta' then v_set_meta else v_set_tt end,
    c.id, c.platform, 'cpc',
    case when c.platform = 'meta' then 'cmp_meta_001' else 'cmp_tt_001' end,
    c.name, 'new',
    (current_date - g.offset_days)::timestamptz
      + interval '8 hours'
      + (pg_temp.rnd(seed.key || 'hour') * interval '14 hours')
  from _seed_creative c
  cross join generate_series(0, v_days - 1) as g(offset_days)
  cross join generate_series(1, 12) as n(i)
  cross join lateral (
    select c.id::text || g.offset_days::text || '-' || n.i::text as key
  ) seed
  where n.i <= c.leads_per_day;

  -- ---------------------------------------------------------------------
  -- 6. Пробные уроки
  -- ---------------------------------------------------------------------
  insert into public.trials (company_id, lead_id, status, date)
  select
    v_company, l.id,
    case
      when pg_temp.rnd(l.id::text || 'tstatus') < 0.74 then 'completed'
      when pg_temp.rnd(l.id::text || 'tstatus') < 0.90 then 'no_show'
      else 'scheduled'
    end,
    (l.created_at + interval '2 days')::date
  from public.leads l
  join _seed_creative c on c.id = l.creative_id
  where l.company_id = v_company
    and pg_temp.rnd(l.id::text || 'trial') < c.trial_rate
    and (l.created_at + interval '2 days')::date <= current_date;

  update public.leads l
     set status = 'trial'
   where l.company_id = v_company
     and exists (select 1 from public.trials t where t.lead_id = l.id);

  -- ---------------------------------------------------------------------
  -- 7. Продажи
  -- ---------------------------------------------------------------------
  insert into public.sales (company_id, lead_id, product, amount, status, sale_date)
  select
    v_company, l.id,
    (array['Курс English Start','Курс English Pro','Интенсив IELTS','Годовой абонемент'])
      [1 + floor(pg_temp.rnd(l.id::text || 'product') * 4)::int],
    round(c.avg_check * (0.85 + pg_temp.rnd(l.id::text || 'amount') * 0.3), -2),
    'paid',
    (l.created_at + interval '5 days')::date
  from public.leads l
  join _seed_creative c on c.id = l.creative_id
  join public.trials t on t.lead_id = l.id and t.status = 'completed'
  where l.company_id = v_company
    and pg_temp.rnd(l.id::text || 'sale') < (c.sale_rate / nullif(c.trial_rate, 0))
    and (l.created_at + interval '5 days')::date <= current_date;

  update public.leads l
     set status = 'sale'
   where l.company_id = v_company
     and exists (select 1 from public.sales s where s.lead_id = l.id);

  -- Часть лидов без пробного — в работе или отказ, чтобы воронка выглядела живой
  update public.leads
     set status = case
       when pg_temp.rnd(id::text || 'residual') < 0.35 then 'rejected'
       else 'in_progress'
     end
   where company_id = v_company
     and status = 'new'
     and pg_temp.rnd(id::text || 'touched') < 0.55;

  -- ---------------------------------------------------------------------
  -- 8. Интеграции и журнал
  -- ---------------------------------------------------------------------
  insert into public.integrations (company_id, platform, status, account_id, last_sync_at)
  values
    (v_company, 'meta',     'connected',    'act_1029384756', now() - interval '2 hours'),
    (v_company, 'tiktok',   'connected',    '7291038475610',  now() - interval '5 hours'),
    (v_company, 'telegram', 'pending',      null,             null),
    (v_company, 'crm',      'disconnected', null,             null);

  insert into public.audit_logs (company_id, user_id, action, entity_type, entity_id, metadata)
  values (v_company, v_admin_user, 'demo.seeded', 'company', v_company,
          jsonb_build_object('days', v_days));

  raise notice 'Демо-данные загружены для компании %', v_company;
end;
$$;

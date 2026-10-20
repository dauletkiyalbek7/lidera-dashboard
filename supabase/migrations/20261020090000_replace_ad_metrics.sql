-- Перезапись окна статистики одной транзакцией.
--
-- Синхронизация кабинета сначала стирала окно дней, потом вставляла новые
-- строки — двумя запросами. Между ними функцию могли оборвать: ночная
-- синхронизация русского в кабинете «123» идёт около ста секунд при лимите в
-- шестьдесят. Дни оставались стёртыми, а следующие запуски перезабирали
-- только последние трое суток — так из платформы пропал расход за 12 октября
-- целиком и половина 16-го.
--
-- Теперь стирание и вставка — одна транзакция в базе: она либо проходит
-- целиком, либо не меняет ничего. Обрыв функции больше не уносит цифры.
create or replace function public.replace_ad_metrics(
  p_company_id   uuid,
  p_platform     text,
  p_since        date,
  p_until        date,
  p_campaign_ids uuid[],
  p_rows         jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  written integer;
begin
  delete from public.ad_metrics
   where company_id = p_company_id
     and platform = p_platform
     and date between p_since and p_until
     and campaign_id = any (p_campaign_ids);

  insert into public.ad_metrics (
    company_id, currency, campaign_id, creative_id, platform, date,
    spend, impressions, reach, clicks, ctr, cpc, cpm, leads, conversations, cpl,
    video_plays, video_completions, video_avg_seconds
  )
  select company_id, currency, campaign_id, creative_id, platform, date,
         spend, impressions, reach, clicks, ctr, cpc, cpm, leads, conversations, cpl,
         video_plays, video_completions, video_avg_seconds
    from jsonb_populate_recordset(null::public.ad_metrics, p_rows)
   -- Строки чужой компании сюда попасть не должны, даже по ошибке вызова.
   where company_id = p_company_id;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke all on function public.replace_ad_metrics(uuid, text, date, date, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_ad_metrics(uuid, text, date, date, uuid[], jsonb)
  to service_role;

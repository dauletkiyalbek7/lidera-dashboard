-- -----------------------------------------------------------------------------
-- Возврат оформляет руководитель отдела продаж.
--
-- По ТЗ это его работа, но прав у него не было: профиль сотрудника не проходит
-- `can_write()`, и база отказывала. Раздавать РОПу право писать в `sales`
-- целиком нельзя — вместе с возвратом он получил бы возможность править суммы
-- чужих чеков.
--
-- Поэтому возврат оформляется одной функцией. Она проверяет право сама, пишет
-- журнал и меняет статус продажи в одной транзакции: раньше это были два
-- запроса подряд, и падение второго оставляло деньги в выручке.
-- -----------------------------------------------------------------------------

create or replace function public.register_return(
  sale uuid,
  refund numeric,
  reason text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  actor_company uuid := private.current_company_id();
  actor_employee uuid := private.current_employee_id();
  sale_row public.sales%rowtype;
  created uuid;
begin
  -- Директор или РОП. Остальным нельзя: они же и продавали.
  if not (
    private.is_super_admin()
    or private.can_write()
    or private.is_sales_lead()
  ) then
    raise exception 'Возврат оформляет РОП или директор.' using errcode = '42501';
  end if;

  select * into sale_row
    from public.sales
   where id = sale
     and (private.is_super_admin() or company_id = actor_company);

  if not found then
    raise exception 'Продажа не найдена.' using errcode = 'P0002';
  end if;

  if sale_row.status = 'refunded' then
    raise exception 'По этой продаже возврат уже оформлен.' using errcode = 'P0001';
  end if;

  if refund < 0 or refund > sale_row.amount then
    raise exception 'Возврат больше суммы продажи.' using errcode = 'P0001';
  end if;

  insert into public.returns (company_id, sale_id, amount, currency, reason, processed_by)
  select sale_row.company_id, sale_row.id, refund,
         (select sales_currency from public.companies where id = sale_row.company_id),
         nullif(btrim(coalesce(reason, '')), ''),
         actor_employee
  returning id into created;

  update public.sales set status = 'refunded' where id = sale_row.id;

  return created;
end;
$$;

revoke all on function public.register_return(uuid, numeric, text) from public, anon;
grant execute on function public.register_return(uuid, numeric, text) to authenticated;

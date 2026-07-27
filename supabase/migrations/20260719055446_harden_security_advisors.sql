create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop policy if exists "public update trades" on public.trades;
drop policy if exists "public delete trades" on public.trades;

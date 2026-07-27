alter table public.signals drop constraint if exists signals_status_check;
alter table public.signals add constraint signals_status_check
  check (
    status = any (
      array['pending','triggered','hit_target','hit_stop','closed_win','expired','cancelled']
    )
  );

alter table public.shadow_signals drop constraint if exists shadow_signals_status_check;
alter table public.shadow_signals add constraint shadow_signals_status_check
  check (
    status = any (
      array['pending','triggered','hit_target','hit_stop','closed_win','expired','cancelled']
    )
  );

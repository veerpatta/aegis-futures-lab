-- Trigger guards need SECURITY DEFINER to inspect OLD/NEW under the table
-- owner's privileges, but they are not RPCs. Remove the default function
-- execute grant so anonymous clients cannot call them through PostgREST.
revoke execute on function public.research_baselines_immutable() from public, anon, authenticated;
revoke execute on function public.research_trials_guard() from public, anon, authenticated;

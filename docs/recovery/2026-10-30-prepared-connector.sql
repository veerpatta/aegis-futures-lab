
CREATE TABLE private_research.aegis_owner (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), user_id text NOT NULL UNIQUE);
REVOKE ALL ON private_research.aegis_owner FROM PUBLIC, anonymous, authenticated, aegis_ai;
DO E'
DECLARE n integer\073 owner_id text\073
BEGIN
  SELECT count(*) INTO n FROM neon_auth."user"\073
  IF n <> 1 THEN RAISE EXCEPTION ''Expected exactly one existing auth account\073 migration stopped''\073 END IF\073
  SELECT id::text INTO owner_id FROM neon_auth."user" WHERE role=''admin'' AND NOT COALESCE(banned,false)\073
  IF owner_id IS NULL THEN RAISE EXCEPTION ''Sole account must be an unbanned administrator''\073 END IF\073
  INSERT INTO private_research.aegis_owner(user_id) VALUES (owner_id)\073
END ';

CREATE FUNCTION public.aegis_is_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, private_research, auth AS E'
  SELECT EXISTS (SELECT 1 FROM private_research.aegis_owner o JOIN neon_auth."user" u ON u.id::text=o.user_id
    WHERE o.singleton AND o.user_id=auth.user_id() AND u.role=''admin'' AND NOT COALESCE(u.banned,false))
';
REVOKE ALL ON FUNCTION public.aegis_is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aegis_is_owner() TO authenticated;

CREATE VIEW public.admin_control_authorized WITH (security_barrier=true) AS
 SELECT o.user_id FROM private_research.aegis_owner o JOIN neon_auth."user" u ON u.id::text=o.user_id
 WHERE o.singleton AND u.role='admin' AND NOT COALESCE(u.banned,false);
REVOKE ALL ON public.admin_control_authorized FROM PUBLIC, anonymous, authenticated;
GRANT SELECT ON public.admin_control_authorized TO aegis_ai;

CREATE TABLE public.admin_control_commands (
 id text PRIMARY KEY CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 owner_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('pause','resume','stop','start')),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 expected_experiment_id text CHECK (expected_experiment_id IS NULL OR length(expected_experiment_id) BETWEEN 1 AND 128),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), completed_at timestamptz, result text CHECK (result IS NULL OR length(result) BETWEEN 1 AND 500),
 CHECK ((status='pending' AND completed_at IS NULL AND result IS NULL) OR (status IN ('applied','failed') AND completed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE UNIQUE INDEX admin_control_one_pending ON public.admin_control_commands(owner_id) WHERE status='pending';
CREATE INDEX admin_control_commands_created ON public.admin_control_commands(owner_id,created_at DESC);

CREATE FUNCTION public.admin_control_guard() RETURNS trigger LANGUAGE plpgsql AS E'
BEGIN
 IF TG_OP=''DELETE'' THEN RAISE EXCEPTION ''Admin commands cannot be deleted''\073 END IF\073
 IF OLD.status <> ''pending'' OR NEW.status NOT IN (''applied'',''failed'') OR OLD.id IS DISTINCT FROM NEW.id
 OR OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.action IS DISTINCT FROM NEW.action OR OLD.reason IS DISTINCT FROM NEW.reason
 OR OLD.expected_experiment_id IS DISTINCT FROM NEW.expected_experiment_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
 OR NEW.completed_at IS NULL OR NEW.result IS NULL THEN RAISE EXCEPTION ''Admin commands may only be completed once''\073 END IF\073
 RETURN NEW\073
END ';
CREATE TRIGGER protect_admin_control_commands BEFORE UPDATE OR DELETE ON public.admin_control_commands FOR EACH ROW EXECUTE FUNCTION public.admin_control_guard();
ALTER TABLE public.admin_control_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_control_commands FROM PUBLIC, anonymous, authenticated, aegis_ai;
GRANT SELECT ON public.admin_control_commands TO aegis_ai;
GRANT INSERT (id,owner_id,action,reason,expected_experiment_id) ON public.admin_control_commands TO aegis_ai;
CREATE POLICY admin_command_read ON public.admin_control_commands FOR SELECT TO aegis_ai USING (EXISTS (SELECT 1 FROM public.admin_control_authorized a WHERE a.user_id=owner_id));
CREATE POLICY admin_command_enqueue ON public.admin_control_commands FOR INSERT TO aegis_ai WITH CHECK (status='pending' AND EXISTS (SELECT 1 FROM public.admin_control_authorized a WHERE a.user_id=owner_id));

CREATE POLICY raj_only_private_access ON public.journal_entries AS RESTRICTIVE TO authenticated USING (public.aegis_is_owner()) WITH CHECK (public.aegis_is_owner());
CREATE POLICY raj_only_private_access ON public.crm_snapshots AS RESTRICTIVE TO authenticated USING (public.aegis_is_owner()) WITH CHECK (public.aegis_is_owner());

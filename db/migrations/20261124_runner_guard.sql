-- Additive, private, inert until a separate audited activation.
CREATE TABLE IF NOT EXISTS aegis_private.runner_guard (
 id integer PRIMARY KEY CHECK (id=1),
 enabled boolean NOT NULL DEFAULT false,
 approved_standby_sha text,
 owner text,
 acquired_at timestamptz,
 last_completed_at timestamptz,
 CHECK ((owner IS NULL) = (acquired_at IS NULL))
);
INSERT INTO aegis_private.runner_guard(id) VALUES (1) ON CONFLICT DO NOTHING;
REVOKE ALL ON aegis_private.runner_guard FROM PUBLIC;
-- No automatic stale-lock reset: the old writer may still be running.

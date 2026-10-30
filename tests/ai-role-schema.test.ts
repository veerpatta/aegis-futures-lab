import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql=readFileSync('db/migrations/20261030_z_ai_role.sql','utf8');
describe('AI database role migration', () => {
  it('uses a non-login non-bypass group and a narrowly projected learner view', () => {
    expect(sql).toMatch(/CREATE ROLE aegis_ai NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/i);
    expect(sql).not.toMatch(/ALTER ROLE aegis_ai/i);
    expect(sql).toMatch(/rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls/i);
    expect(sql).toMatch(/RAISE EXCEPTION 'Existing aegis_ai role has unsafe attributes'/i);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.ai_research_evidence/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.ai_research_evidence FROM PUBLIC, anonymous, authenticated/i);
  });
  it('does not grant any mutation access to learner or source tables', () => {
    const grants=sql.split('\n').filter(line=>/^GRANT/i.test(line));
    expect(grants.filter(line=>/experiments|experiment_account|signals|engine_runs|research_trials/i.test(line)).every(line=>/^GRANT SELECT/i.test(line))).toBe(true);
    expect(grants.filter(line=>/UPDATE/i.test(line))).toEqual(['GRANT UPDATE (status,actual_micros) ON public.ai_budget_reservations TO aegis_ai;']);
  });
});

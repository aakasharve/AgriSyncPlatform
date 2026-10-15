// Evidence queries against the CI Postgres as the superuser (bypasses RLS on purpose: this is the
// independent view of what the server really stored). Connection comes from env, never a literal.
import { execFileSync } from 'node:child_process';

export function psql(sql) {
  const url = process.env.EVIDENCE_PG_URL;
  if (!url) throw new Error('EVIDENCE_PG_URL is not set');
  return execFileSync('psql', [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', timeout: 30_000, env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
  }).replace(/\r/g, '').trim();
}
export const psqlNum = (sql) => Number(psql(sql));

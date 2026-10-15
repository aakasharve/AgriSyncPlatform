// CI-ONLY. Adds named field operators (the people on the attendance roster) through the REAL API
// as the farm owners, so the roster the app shows came from the server, not from hand-written rows.
import { psql } from './lib/db.mjs';

const API = process.env.API_BASE;
const PW = process.env.DEMO_PASSWORD;
if (!API || !PW) throw new Error('API_BASE and DEMO_PASSWORD are required');

async function login(phone) {
  const r = await fetch(`${API}/user/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'ci-seed' },
    body: JSON.stringify({ phone, password: PW, rememberDevice: false }),
  });
  if (!r.ok) throw new Error(`login ${phone} -> ${r.status}`);
  return (await r.json()).accessToken;
}
async function addOperator(token, farmId, name) {
  const id = crypto.randomUUID();
  const r = await fetch(`${API}/shramsafal/farms/${farmId}/labour/field-operators`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Id': 'ci-seed' },
    body: JSON.stringify({ id, displayName: name }),
  });
  if (r.status !== 201) throw new Error(`create operator ${name} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return id;
}

const farmA = psql(`select f."Id" from ssf.farms f join public.users u on u."Id"=f.owner_user_id where u.phone='8888888888' order by f.created_at_utc limit 1`);
const farmB = psql(`select "Id" from ssf.farms where farm_code='FARMB1'`);
const ownerA = await login('8888888888');
for (const n of ['Ramesh Patil', 'Sunita Jadhav', 'Kisan More', 'Shankar Mukadam-Crew']) await addOperator(ownerA, farmA, n);
const ownerB = await login('9800000030');
await addOperator(ownerB, farmB, 'Baburao-B');
console.log(JSON.stringify({
  farmA, farmB,
  operatorsA: psql(`select count(*) from ssf.field_operators where originating_farm_id='${farmA}'`),
  operatorsB: psql(`select count(*) from ssf.field_operators where originating_farm_id='${farmB}'`),
}));

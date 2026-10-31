import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function start(options = {}) {
  const server = createApp(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', input, cookie) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { ...(input ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: input ? JSON.stringify(input) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  };
  return { server, base, request, close: () => new Promise(resolve => server.close(resolve)) };
}

test('lead → decision maker → editable draft → one accepted email; duplicates and opt-outs blocked', async t => {
  const messages = [];
  const app = await start({ config: { SMTP_USER: 'gordon@kleankickx.com' }, mailer: { sendMail: async message => { messages.push(message); return { accepted: [message.to], messageId: 'test-message' }; } } });
  t.after(app.close);
  const { request } = app;
  let response = await request('/leads', 'POST', { name: 'Test Accra Office', segment: 'Office' });
  assert.equal(response.status, 201);
  const id = response.data.id;
  response = await request(`/leads/${id}`, 'PATCH', { contact_name: 'Test Contact', contact_role: 'Operations', email: 'office@example.test' });
  assert.equal(response.data.contact_role, 'Operations');
  response = await request(`/leads/${id}/draft`, 'POST', {});
  assert.match(response.data.body, /Hi Test Contact,/);
  assert.match(response.data.body, /your team/);
  assert.doesNotMatch(response.data.body, /carbon|free starter/i);
  assert.equal((await request(`/leads/${id}/send`, 'POST', {})).status, 400);
  response = await request(`/leads/${id}`, 'PATCH', { subject: 'Reviewed subject', body: 'Reviewed message' });
  assert.equal(response.data.status, 'draft');
  response = await request(`/leads/${id}/send`, 'POST', { confirm: true });
  assert.equal(response.status, 200);
  assert.equal(response.data.status, 'sent');
  assert.ok(response.data.sent_at);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from.address, 'gordon@kleankickx.com');
  assert.equal(messages[0].text, 'Reviewed message');
  assert.equal((await request(`/leads/${id}/send`, 'POST', { confirm: true })).status, 409);
  const duplicate = await request('/leads', 'POST', { name: 'Duplicate contact', email: 'office@example.test' });
  await request(`/leads/${duplicate.data.id}/draft`, 'POST', {});
  assert.equal((await request(`/leads/${duplicate.data.id}/send`, 'POST', { confirm: true })).status, 409);
  assert.equal((await request(`/leads/${id}/suppress`, 'POST', {})).data.status, 'suppressed');
  assert.equal((await request('/leads', 'POST', { name: 'Opted out', email: 'OFFICE@example.test' })).data.status, 'suppressed');
  assert.equal(messages.length, 1);
});

test('failed SMTP is marked uncertain, persists across restarts and cannot be retried', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'tradeiq-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'test.sqlite');
  const app = await start({ dbPath, mailer: { sendMail: async () => { throw new Error('timeout'); } } });
  const { data } = await app.request('/leads', 'POST', { name: 'Test Gym', segment: 'Gym', email: 'gym@example.test' });
  await app.request(`/leads/${data.id}/draft`, 'POST', {});
  assert.equal((await app.request(`/leads/${data.id}/send`, 'POST', { confirm: true })).status, 502);
  const rows = (await app.request('/leads')).data;
  assert.equal(rows[0].status, 'uncertain');
  assert.equal((await app.request(`/leads/${data.id}/send`, 'POST', { confirm: true })).status, 409);
  await app.close();
  const restarted = await start({ dbPath });
  t.after(restarted.close);
  assert.equal((await restarted.request('/leads')).data[0].status, 'uncertain');
});

test('discovery imports real provider fields and deduplicates source IDs', async t => {
  const app = await start({ discover: async () => [
    { name: 'Test Hotel', segment: 'Hotel', website: 'https://example.test', source: 'Google Places', source_id: 'test-place' },
    { name: 'Test Hotel', segment: 'Hotel', source: 'Google Places', source_id: 'test-place' }
  ] });
  t.after(app.close);
  const result = await app.request('/discover', 'POST', { query: 'hotels', segment: 'Hotel' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { added: 1, found: 2 });
  const leads = (await app.request('/leads')).data;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].email, '');
  assert.equal(leads[0].website, 'https://example.test');
});

test('missing credentials are actionable; research saves without inventing metrics', async t => {
  const app = await start({ config: {} }); t.after(app.close);
  assert.equal((await app.request('/config')).data.mailReady, false);
  const result = await app.request('/discover', 'POST', { query: 'hotels' });
  assert.equal(result.status, 503);
  assert.match(result.data.error, /Google Places/);
  const research = (await app.request('/research')).data;
  assert.equal(research.verified, false);
  assert.equal(research.competitors.length, 15);
  assert.equal(research.campaigns.length, 6);
  assert.ok(research.campaigns.find(c => c.id === 'offices'));
  assert.equal((await app.request('/research', 'PATCH', { description: 'Verified company description', verified: true })).data.verified, true);
});

test('authentication, origin checks and single-recipient validation', async t => {
  const app = await start({ config: { APP_PASSWORD: 'test-only-password' } }); t.after(app.close);
  assert.equal((await app.request('/leads')).status, 401);
  assert.equal((await app.request('/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await app.request('/login', 'POST', { password: 'test-only-password' });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Strict/);
  const cookie = login.cookie.split(';')[0];
  assert.equal((await app.request('/leads', 'GET', undefined, cookie)).status, 200);
  assert.equal((await app.request('/leads', 'POST', { name: 'Invalid', email: 'a,b@example.test' }, cookie)).status, 400);
  const cross = await fetch(`${app.base}/api/leads`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Should fail' }) });
  assert.equal(cross.status, 403);
  const html = await fetch(app.base);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await html.text(), /Your next great connection/);
});

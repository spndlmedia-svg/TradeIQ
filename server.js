import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { fetch, EnvHttpProxyAgent } from 'undici';

const root = dirname(fileURLToPath(import.meta.url));
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const digest = value => createHash('sha256').update(value).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));
const segments = new Set(['Office', 'Hotel', 'Gym', 'Retail', 'Community', 'Other']);

export function createApp({ dbPath = ':memory:', config = process.env, mailer, discover } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
      segment TEXT NOT NULL DEFAULT 'Other', address TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '', contact_role TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'Manual', source_id TEXT UNIQUE,
      subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new', sent_at TEXT, message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS research (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suppressions (email TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, lead_id TEXT, action TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  // An interrupted send must be reconciled with the mailbox before it can be retried.
  db.prepare("UPDATE leads SET status='uncertain' WHERE status='sending'").run();
  const sessions = new Map();
  db.prepare('INSERT OR IGNORE INTO research (id,data) VALUES (1,?)').run(JSON.stringify({
    name: 'Kleankickx Sneaker Care', website: 'https://kleankickx.com', location: 'Accra, Ghana',
    description: 'Sneaker cleaning and shoe care. Exploring business cleaning partnerships in Accra.',
    notes: 'User-provided research describes eco-friendly methods, free starter cleans, deep-stain removal and carbon savings. Verify these claims and offers before including them in outreach.',
    verified: false,
    competitors: ['walkfresh.co.za','vampsneakercleaning.com','sneaker-cleaner.com','sneakercleaner.de','sneakerscleaner.ch','steampress.co.in','fabrico.in','suellastheshoelaundry.com','ishoelaundry.com','sibersih.id','sepatubersih.com','katsikat.id','shoesusclean.com','solefresh.ru','solefreshsolecleantx.com']
  }));
  const campaigns = [
    { id: 'offices', name: 'Companies & offices', segment: 'Office', query: 'companies and corporate offices', contact: 'Office manager / HR / People operations', pitch: 'A convenient shoe-care option for employees.' },
    { id: 'hotels', name: 'Hotels & guesthouses', segment: 'Hotel', query: 'hotels and guesthouses', contact: 'General manager / Guest services / Operations', pitch: 'Explore a shoe-care partnership for guests and staff.' },
    { id: 'gyms', name: 'Gyms & fitness studios', segment: 'Gym', query: 'gyms and fitness studios', contact: 'Owner / Gym manager / Partnerships', pitch: 'Explore sneaker-care partnerships for members.' },
    { id: 'coworking', name: 'Coworking communities', segment: 'Office', query: 'coworking spaces', contact: 'Community manager / Operations manager', pitch: 'A shoe-care option for coworking members.' },
    { id: 'retail', name: 'Sneaker & fashion stores', segment: 'Retail', query: 'sneaker stores and fashion boutiques', contact: 'Store owner / Retail manager', pitch: 'Discuss a customer shoe-care referral partnership.' },
    { id: 'events', name: 'Event & sports organizations', segment: 'Community', query: 'sports clubs and event management companies', contact: 'Club manager / Events director', pitch: 'Explore sneaker care for teams and event communities.' }
  ];
  const attempts = new Map();
  let searchBusy = false;
  let lastSearch = 0;
  const configuredMail = Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);
  const transport = mailer || (configuredMail ? nodemailer.createTransport({
    host: config.SMTP_HOST, port: Number(config.SMTP_PORT || 465),
    ...(config.SMTP_PROXY ? { proxy: config.SMTP_PROXY } : {}),
    secure: Number(config.SMTP_PORT || 465) === 465, requireTLS: true,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
  }) : null);
  const lead = id => {
    const row = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!row) throw fail(404, 'Lead not found.');
    return row;
  };
  const event = (id, action) => db.prepare('INSERT INTO events (lead_id,action) VALUES (?,?)').run(id, action);
  const addLead = input => {
    const name = text(input.name, 200).replace(/[\r\n]/g, ' ');
    const email = text(input.email, 254).toLowerCase();
    if (!name) throw fail(400, 'Business name is required.');
    if (email && !emailPattern.test(email)) throw fail(400, 'Enter a valid contact email.');
    const website = text(input.website, 1000);
    if (website && !/^https?:\/\//i.test(website)) throw fail(400, 'Website must start with https:// or http://.');
    const segment = segments.has(input.segment) ? input.segment : 'Other';
    const id = randomUUID();
    const status = email && db.prepare('SELECT 1 FROM suppressions WHERE email=?').get(email) ? 'suppressed' : 'new';
    db.prepare('INSERT INTO leads (id,name,email,segment,address,website,phone,source,source_id,status) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, name, email, segment, text(input.address), website, text(input.phone, 80), text(input.source || 'Manual', 100), input.source_id || null, status);
    return lead(id);
  };
  const publicConfig = () => ({
    searchReady: Boolean(config.GOOGLE_PLACES_API_KEY || discover), mailReady: Boolean(transport),
    sender: config.SMTP_USER || 'gordon@kleankickx.com', authEnabled: Boolean(config.APP_PASSWORD)
  });
  async function searchPlaces(query, segment) {
    if (discover) return discover(query, segment);
    if (!config.GOOGLE_PLACES_API_KEY) throw fail(503, 'Connect a Google Places API key in environment settings to discover businesses. You can add leads manually now.');
    const dispatcher = new EnvHttpProxyAgent();
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        dispatcher, method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.googleMapsUri' },
        body: JSON.stringify({ textQuery: `${query} in Accra, Ghana`, pageSize: 20,
          locationBias: { circle: { center: { latitude: 5.6037, longitude: -0.1870 }, radius: 25000 } } })
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw fail(502, `Google Places returned HTTP ${response.status}. Check API activation, billing, key restrictions, and network access.`);
      }
      const data = await response.json();
      return (data.places || []).map(p => ({ name: p.displayName?.text, address: p.formattedAddress,
        website: p.websiteUri, phone: p.internationalPhoneNumber, segment,
        source: 'Google Places', source_id: p.id }));
    } finally { await dispatcher.close(); }
  }
  async function readJson(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Use application/json.');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024) throw fail(413, 'Request is too large.');
    }
    try { return JSON.parse(body || '{}'); } catch { throw fail(400, 'Invalid JSON.'); }
  }
  const server = http.createServer(async (req, res) => {
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
      res.end(JSON.stringify(body));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      // Requests are served only for local hostnames or the explicitly configured hostname.
      const host = (req.headers.host || '').split(':')[0];
      const allowed = new Set(['127.0.0.1', 'localhost', config.PUBLIC_HOST, config.RENDER_EXTERNAL_HOSTNAME].filter(Boolean));
      if (!allowed.has(host)) throw fail(403, 'Host is not allowed. Configure PUBLIC_HOST for your deployment.');
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) throw fail(403, 'Cross-origin requests are not allowed.');
      }
      if (path === '/api/health' && req.method === 'GET') return json(200, { ok: true });
      if (path === '/api/login' && req.method === 'POST') {
        const input = await readJson(req);
        if (!config.APP_PASSWORD) return json(200, { ok: true });
        const key = req.socket.remoteAddress;
        const now = Date.now();
        let attempt = attempts.get(key);
        if (!attempt || attempt.until < now) attempt = { count: 0, until: now + 15 * 60000 };
        if (attempt.count >= 10) throw fail(429, 'Too many login attempts. Try again in 15 minutes.');
        attempt.count++;
        attempts.set(key, attempt);
        if (!safeEqual(text(input.password, 1000), config.APP_PASSWORD)) throw fail(401, 'Incorrect password.');
        const token = randomBytes(32).toString('hex');
        for (const [key, expiry] of sessions) if (expiry < now) sessions.delete(key);
        sessions.set(token, now + 12 * 3600000);
        attempts.delete(key);
        return json(200, { ok: true }, { 'Set-Cookie': `tradeiq=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.COOKIE_SECURE === 'true' ? '; Secure' : ''}` });
      }
      if (path.startsWith('/api/')) {
        if (config.APP_PASSWORD) {
          const token = /(?:^|;\s*)tradeiq=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
          if (!token || (sessions.get(token) || 0) < Date.now()) throw fail(401, 'Sign in to continue.');
        }
        if (path === '/api/config' && req.method === 'GET') return json(200, publicConfig());
        if (path === '/api/mail/verify' && req.method === 'POST') {
          await readJson(req);
          if (!transport?.verify) throw fail(503, 'Configure Hostinger SMTP before testing the connection.');
          try {
            await transport.verify();
            return json(200, { ok: true, message: 'SMTP login successful. No email was sent.' });
          } catch (error) {
            const code = /^[A-Z0-9_]{1,30}$/.test(error.code || '') ? error.code : 'SMTP_ERROR';
            const responseCode = Number.isInteger(error.responseCode) ? ` / ${error.responseCode}` : '';
            throw fail(502, `SMTP login check failed (${code}${responseCode}). Check the mailbox credentials and network connection. No email was sent.`);
          }
        }
        if (path === '/api/research' && req.method === 'GET') return json(200, { ...JSON.parse(db.prepare('SELECT data FROM research WHERE id=1').get().data), campaigns });
        if (path === '/api/research' && req.method === 'PATCH') {
          const input = await readJson(req);
          const previous = JSON.parse(db.prepare('SELECT data FROM research WHERE id=1').get().data);
          const updated = { ...previous, description: text(input.description ?? previous.description, 2000), notes: text(input.notes ?? previous.notes, 4000), verified: input.verified === true };
          db.prepare('UPDATE research SET data=? WHERE id=1').run(JSON.stringify(updated));
          return json(200, { ...updated, campaigns });
        }
        if (path === '/api/leads' && req.method === 'GET') return json(200, db.prepare('SELECT * FROM leads ORDER BY created_at DESC, rowid DESC').all());
        if (path === '/api/leads' && req.method === 'POST') return json(201, addLead(await readJson(req)));
        if (path === '/api/discover' && req.method === 'POST') {
          const input = await readJson(req);
          const query = text(input.query, 200);
          if (query.length < 3) throw fail(400, 'Describe the businesses you want to find.');
          if (searchBusy || Date.now() - lastSearch < 3000) throw fail(429, 'Wait a few seconds before another search.');
          searchBusy = true;
          try {
            const results = await searchPlaces(query, segments.has(input.segment) ? input.segment : 'Other');
            let added = 0;
            for (const result of results.slice(0, 20)) {
              if (!result.name || (result.source_id && db.prepare('SELECT 1 FROM leads WHERE source_id=?').get(result.source_id))) continue;
              addLead(result); added++;
            }
            lastSearch = Date.now();
            return json(200, { added, found: results.length });
          } finally { searchBusy = false; }
        }
        const match = /^\/api\/leads\/([^/]+)(?:\/(draft|send|suppress|reconcile))?$/.exec(path);
        if (match) {
          let row = lead(match[1]);
          const action = match[2];
          if (action === 'reconcile' && req.method === 'POST') {
            const input = await readJson(req);
            if (row.status !== 'uncertain' || row.sent_at) throw fail(409, 'Only an unresolved attempt without confirmed SMTP acceptance can be reviewed.');
            if (input.confirmNotAccepted !== true || !['authentication_rejected', 'provider_confirmed_not_accepted'].includes(input.reason)) {
              throw fail(400, 'Confirm from the original SMTP failure or provider logs that this attempt was not accepted. An empty inbox alone is not confirmation.');
            }
            if (db.prepare('SELECT 1 FROM suppressions WHERE email=?').get(row.email)) throw fail(409, 'This address is on your do-not-contact list.');
            db.prepare("UPDATE leads SET status='draft' WHERE id=? AND status='uncertain'").run(row.id);
            event(row.id, `operator_confirmed_not_accepted:${input.reason}`);
            return json(200, lead(row.id));
          }
          if (!action && req.method === 'PATCH') {
            const input = await readJson(req);
            if (['sending', 'sent', 'uncertain', 'suppressed'].includes(row.status)) throw fail(409, 'This lead is locked to protect its outreach history.');
            const email = text(input.email ?? row.email, 254).toLowerCase();
            if (email && !emailPattern.test(email)) throw fail(400, 'Enter a valid contact email.');
            if (email && db.prepare('SELECT 1 FROM suppressions WHERE email=?').get(email)) throw fail(409, 'This address is on your do-not-contact list.');
            const subject = text(input.subject ?? row.subject, 200).replace(/[\r\n]/g, ' ');
            const body = text(input.body ?? row.body, 12000);
            const contactName = text(input.contact_name ?? row.contact_name, 100).replace(/[\r\n]/g, ' ');
            const contactRole = text(input.contact_role ?? row.contact_role, 150);
            db.prepare('UPDATE leads SET email=?,subject=?,body=?,contact_name=?,contact_role=?,status=? WHERE id=?').run(email, subject, body, contactName, contactRole, body ? 'draft' : 'new', row.id);
            return json(200, lead(row.id));
          }
          if (action === 'draft' && req.method === 'POST') {
            if (['sending', 'sent', 'uncertain', 'suppressed'].includes(row.status)) throw fail(409, 'Outreach is locked for this lead.');
            const angle = { Office: 'a convenient shoe-care option for your team', Hotel: 'a shoe-care partnership for your guests and team', Gym: 'a sneaker-care partnership for your members', Retail: 'a shoe-care partnership for your customers', Community: 'a sneaker-care option for your community', Other: 'a shoe-care partnership' }[row.segment];
            const subject = `A Kleankickx partnership with ${row.name}`.slice(0, 200);
            const body = `Hi ${row.contact_name || `${row.name} team`},\n\nI'm Gordon, founder of Kleankickx in Accra. I'm reaching out to explore ${angle}.\n\nWould you be open to a brief conversation about what would be useful for ${row.name}? I'd be happy to learn about your needs and discuss a suitable arrangement.\n\nYou can find us at https://kleankickx.com.\n\nBest,\nGordon\nFounder, Kleankickx\ngordon@kleankickx.com\n\nIf this isn't relevant, reply “no thanks” and I won't follow up.`;
            db.prepare("UPDATE leads SET subject=?,body=?,status='draft' WHERE id=?").run(subject, body, row.id);
            event(row.id, 'drafted');
            return json(200, lead(row.id));
          }
          if (action === 'suppress' && req.method === 'POST') {
            if (['sending', 'uncertain'].includes(row.status)) throw fail(409, 'Reconcile the in-flight email in Hostinger before changing this lead.');
            if (!row.email) throw fail(400, 'Add a contact email before recording an opt-out.');
            db.prepare('INSERT OR IGNORE INTO suppressions (email) VALUES (?)').run(row.email);
            db.prepare("UPDATE leads SET status='suppressed' WHERE email=?").run(row.email);
            event(row.id, 'suppressed');
            return json(200, lead(row.id));
          }
          if (action === 'send' && req.method === 'POST') {
            const input = await readJson(req);
            if (input.confirm !== true) throw fail(400, 'Review the email and confirm sending.');
            if (!transport) throw fail(503, 'Connect the Hostinger SMTP mailbox in environment settings before sending.');
            if (!emailPattern.test(row.email) || !row.subject || !row.body) throw fail(400, 'Add a verified email, subject, and message first.');
            if (db.prepare('SELECT 1 FROM suppressions WHERE email=?').get(row.email)) throw fail(409, 'This address is on your do-not-contact list.');
            if (db.prepare("SELECT 1 FROM leads WHERE email=? AND status IN ('sent','sending','uncertain')").get(row.email)) throw fail(409, 'This address already has a sent or unresolved email. In All leads, open the original record marked Check mailbox and resolve it only after confirming non-acceptance. Sent emails cannot be unlocked.');
            const updated = db.prepare("UPDATE leads SET status='sending' WHERE id=? AND status='draft'").run(row.id);
            if (!updated.changes) throw fail(409, 'Only an unsent draft can be sent.');
            try {
              const result = await transport.sendMail({
                from: { name: config.SMTP_FROM_NAME || 'Gordon | Kleankickx', address: config.SMTP_USER || 'gordon@kleankickx.com' },
                to: row.email, replyTo: config.SMTP_USER || 'gordon@kleankickx.com', subject: row.subject, text: row.body,
                disableFileAccess: true, disableUrlAccess: true
              });
              if (!result.accepted?.length) throw new Error('Recipient not accepted');
              db.prepare("UPDATE leads SET status='sent',sent_at=?,message_id=? WHERE id=?").run(new Date().toISOString(), text(result.messageId), row.id);
              event(row.id, 'smtp_accepted');
              return json(200, lead(row.id));
            } catch (error) {
              // An SMTP rejection or failed authentication proves non-acceptance.
              // Connection failures can occur after acceptance, so retain their lock.
              const rejected = error.code === 'EAUTH' || (Number.isInteger(error.responseCode) && error.responseCode >= 400 && error.responseCode <= 599);
              if (rejected) {
                db.prepare("UPDATE leads SET status='draft' WHERE id=?").run(row.id);
                event(row.id, 'smtp_rejected');
                const responseCode = Number.isInteger(error.responseCode) ? ` (${error.responseCode})` : '';
                throw fail(502, error.code === 'EAUTH'
                  ? `Hostinger rejected the mailbox login${responseCode}. Correct the SMTP credentials, restart TradeIQ, and test the connection. Your email remains an unsent draft.`
                  : `The mail server rejected this email${responseCode}. Check the recipient, mailbox limits and sender settings. Your email remains an unsent draft.`);
              }
              db.prepare("UPDATE leads SET status='uncertain' WHERE id=?").run(row.id);
              event(row.id, 'send_uncertain');
              throw fail(502, 'SMTP did not confirm acceptance. Check Hostinger delivery logs before retrying; this lead is locked to prevent duplicates.');
            }
          }
        }
        throw fail(404, 'Endpoint not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(405, 'Method not allowed.');
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
      const file = files[path];
      if (!file) throw fail(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(resolve(root, 'public', file[0])));
    } catch (error) {
      json(error.status || 500, { error: error.status ? error.message : 'The request failed. Check service configuration and try again.' });
    }
  });
  server.on('close', () => { transport?.close?.(); db.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.APP_PASSWORD) {
    console.error('Set APP_PASSWORD before binding to a non-loopback interface.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 16 || process.env.COOKIE_SECURE !== 'true')) {
    console.error('Production requires APP_PASSWORD with at least 16 characters and COOKIE_SECURE=true behind HTTPS.');
    process.exit(1);
  }
  const dbPath = resolve(process.env.DATABASE_PATH || resolve(root, '.data', 'tradeiq.sqlite'));
  mkdirSync(dirname(dbPath), { recursive: true });
  const server = createApp({ dbPath });
  server.listen(Number(process.env.PORT || 3000), host, () => console.log(`TradeIQ listening on ${host}:${process.env.PORT || 3000}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

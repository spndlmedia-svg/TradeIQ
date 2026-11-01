const $ = selector => document.querySelector(selector);
let leads = [];
let config = {};
let research = {};
let current = null;
let filter = 'all';
let toastTimer;
const locked = row => ['sent', 'sending', 'uncertain', 'suppressed'].includes(row.status);
const statusLabels = { new: 'New lead', draft: 'Draft ready', sent: 'Sent', sending: 'Sending', uncertain: 'Check mailbox', suppressed: 'Do not contact' };
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = `toast${error ? ' error' : ''}`;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 10000 : 5000);
}
async function api(path, method = 'GET', data) {
  const response = await fetch(`/api${path}`, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json();
  if (response.status === 401) { $('#login').hidden = false; $('#workspace').hidden = true; }
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
async function refresh() {
  [config, leads, research] = await Promise.all([api('/config'), api('/leads'), api('/research')]);
  $('#workspace').hidden = false;
  $('#login').hidden = true;
  $('#connection-banner').hidden = config.searchReady;
  $('#search-status').textContent = config.searchReady ? '● Configured · live request required to verify' : '○ Not connected';
  $('#mail-status').textContent = config.mailReady ? '● Configured · live send required to verify' : '○ Not connected';
  $('#sender-email').textContent = config.sender;
  renderResearch();
  render();
}
function renderResearch() {
  $('#company-description').value = research.description;
  $('#company-notes').value = research.notes;
  $('#company-verified').checked = research.verified;
  $('#research-state').textContent = research.verified ? 'Company profile reviewed by workspace owner' : 'User-provided research · needs verification';
  $('#competitor-list').replaceChildren();
  for (const domain of research.competitors) {
    const link = document.createElement('a'); link.textContent = `${domain} ↗`; link.href = `https://${domain}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    $('#competitor-list').append(link);
  }
  $('#campaign-grid').replaceChildren();
  for (const campaign of research.campaigns) {
    const button = document.createElement('button'); button.className = 'campaign-card';
    const name = document.createElement('strong'); name.textContent = campaign.name;
    const pitch = document.createElement('p'); pitch.textContent = campaign.pitch;
    const role = document.createElement('small'); role.textContent = `Look for: ${campaign.contact}`;
    const action = document.createElement('span'); action.textContent = 'Explore this campaign ↗';
    button.append(name,pitch,role,action);
    button.addEventListener('click', () => { $('#query').value = campaign.query; $('#search-segment').value = campaign.segment; $('#discovery-section').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#query').focus({ preventScroll: true }); toast('Campaign selected. Review the search, then choose Find leads.'); });
    $('#campaign-grid').append(button);
  }
}
function cell(content) { const td = document.createElement('td'); td.textContent = content; return td; }
function render() {
  $('#stat-total').textContent = leads.length;
  $('#stat-drafts').textContent = leads.filter(l => l.status === 'draft').length;
  $('#stat-sent').textContent = leads.filter(l => l.sent_at).length;
  $('#nav-count').textContent = leads.length;
  $('#total-badge').textContent = leads.length;
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('selected', button.dataset.filter === filter));
  const query = $('#filter').value.trim().toLowerCase();
  const visible = leads.filter(l => (filter === 'all' || l.status === filter || (filter === 'sent' && l.sent_at)) && [l.name,l.email,l.address,l.segment].join(' ').toLowerCase().includes(query));
  const body = $('#leads-body'); body.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement('tr');
    const name = cell(''); const strong = document.createElement('strong'); strong.textContent = row.name;
    const location = document.createElement('small'); location.textContent = row.address || row.source;
    name.append(strong, location);
    const segment = cell(''); const segmentBadge = document.createElement('span'); segmentBadge.className = 'segment-pill'; segmentBadge.textContent = row.segment; segment.append(segmentBadge);
    const email = cell(row.email || 'Verify email on website');
    const status = cell(''); const badge = document.createElement('span'); badge.className = `status-pill ${row.status}`; badge.textContent = statusLabels[row.status] || row.status; status.append(badge);
    const action = cell(''); const button = document.createElement('button'); button.className = 'row-action'; button.textContent = row.status === 'new' ? 'Draft email ↗' : 'Review →';
    button.addEventListener('click', () => openDraft(row.id).catch(error => toast(error.message, true))); action.append(button);
    tr.append(name,segment,email,status,action); body.append(tr);
  }
  $('#empty-state').hidden = visible.length > 0;
  $('#empty-state h3').textContent = leads.length ? 'No leads match this view.' : 'Your next partnership starts with a lead.';
  $('#empty-state p').textContent = leads.length ? 'Choose another filter or add a new business.' : 'Search for businesses above or add a contact you already know. Your real leads and outreach will appear here.';
  $('#table-summary').textContent = leads.length ? `Showing ${visible.length} of ${leads.length} leads` : 'No leads yet';
}
async function busy(button, action) {
  button.disabled = true;
  try { await action(); } catch (error) { toast(error.message, true); } finally { button.disabled = false; }
}
async function openDraft(id) {
  current = leads.find(l => l.id === id);
  if (!current) return;
  if (current.status === 'new') { current = await api(`/leads/${id}/draft`, 'POST', {}); await refresh(); }
  $('#draft-title').textContent = current.name;
  $('#draft-email').value = current.email;
  $('#draft-subject').value = current.subject;
  $('#draft-body').value = current.body;
  $('#contact-name').value = current.contact_name || '';
  $('#contact-role').value = current.contact_role || '';
  const detail = $('#lead-details'); detail.replaceChildren();
  const address = document.createElement('span'); address.textContent = `${current.segment} · ${current.address || 'Accra, Ghana'} · Source: ${current.source}`; detail.append(address);
  if (current.phone) { const phone = document.createElement('span'); phone.textContent = current.phone; detail.append(phone); }
  if (/^https?:\/\//i.test(current.website)) {
    const link = document.createElement('a'); link.href = current.website; link.textContent = 'Visit business website ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; detail.append(link);
  }
  const isLocked = locked(current);
  $('#resolve-button').hidden = current.status !== 'uncertain';
  for (const id of ['draft-email','draft-subject','draft-body','contact-name','contact-role','save-draft','send-button']) $(`#${id}`).disabled = isLocked;
  $('#suppress-button').disabled = !current.email || ['sending', 'uncertain', 'suppressed'].includes(current.status);
  $('#send-note').textContent = current.status === 'uncertain' ? 'The previous send was not confirmed. Check Hostinger before taking further action. Automatic retry is disabled.' : current.sent_at ? `SMTP accepted this email on ${new Date(current.sent_at).toLocaleString()}. Acceptance does not confirm delivery or a reply.` : current.status === 'suppressed' ? 'This address is marked do not contact. Sending is disabled.' : !config.mailReady ? 'Hostinger is not connected yet. You can edit and save this draft now.' : `Sending from ${config.sender}. Verify the recipient and review this message before sending.`;
  if (!$('#draft-dialog').open) $('#draft-dialog').showModal();
}
async function saveDraft() {
  if (!$('#draft-form').reportValidity()) throw new Error('Complete the recipient, subject and message.');
  current = await api(`/leads/${current.id}`, 'PATCH', { email: $('#draft-email').value, subject: $('#draft-subject').value, body: $('#draft-body').value, contact_name: $('#contact-name').value, contact_role: $('#contact-role').value });
  await refresh();
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(`#${button.dataset.close}`).close());
$('#research-button').addEventListener('click', () => $('#research-dialog').showModal());
$('#research-form').addEventListener('submit', event => {
  event.preventDefault(); busy($('#research-form button[type="submit"]'), async () => {
    research = await api('/research', 'PATCH', { description: $('#company-description').value, notes: $('#company-notes').value, verified: $('#company-verified').checked });
    renderResearch(); $('#research-dialog').close(); toast('Company research saved.');
  });
});
for (const button of document.querySelectorAll('[data-step]')) button.addEventListener('click', () => {
  document.querySelectorAll('[data-step]').forEach(item => item.classList.toggle('current', item === button));
  const step = Number(button.dataset.step);
  if (step < 3) $('#research-dialog').showModal();
  else if (step === 3) $('#campaign-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
  else if (step === 4) { $('#discovery-section').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#query').focus({ preventScroll: true }); }
  else { chooseFilter(step === 6 ? 'draft' : 'all', step === 6 ? 'nav-drafts' : 'nav-leads'); $('.pipeline').scrollIntoView({ behavior: 'smooth', block: 'start' }); if (step === 5) toast('Open a lead to record a verified decision maker, role and email. These are not guessed from Google Places.'); }
});
for (const id of ['add-button','empty-add']) $(`#${id}`).addEventListener('click', () => $('#add-dialog').showModal());
for (const id of ['connect-button','nav-settings']) $(`#${id}`).addEventListener('click', () => $('#settings-dialog').showModal());
for (const button of document.querySelectorAll('[data-query]')) button.addEventListener('click', () => { $('#query').value = button.dataset.query; $('#search-segment').value = button.dataset.segment; $('#query').focus(); });
function chooseFilter(value, nav) {
  filter = value;
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.id === nav));
  $('#breadcrumb').textContent = value === 'draft' ? 'Email drafts' : value === 'sent' ? 'Sent outreach' : 'Lead discovery';
  render();
}
$('#nav-leads').addEventListener('click', () => chooseFilter('all','nav-leads'));
$('#nav-drafts').addEventListener('click', () => chooseFilter('draft','nav-drafts'));
$('#nav-sent').addEventListener('click', () => chooseFilter('sent','nav-sent'));
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => chooseFilter(button.dataset.filter, button.dataset.filter === 'draft' ? 'nav-drafts' : button.dataset.filter === 'sent' ? 'nav-sent' : 'nav-leads'));
$('#filter').addEventListener('input', render);
$('#refresh-button').addEventListener('click', event => busy(event.currentTarget, refresh));
$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  busy($('#search-button'), async () => {
    const original = $('#search-button').textContent;
    $('#search-button').textContent = 'Finding leads…';
    try {
      const result = await api('/discover', 'POST', { query: $('#query').value, segment: $('#search-segment').value });
      chooseFilter('all', 'nav-leads'); await refresh();
      toast(`Found ${result.found} businesses. Added ${result.added} new leads; existing results were skipped.`);
    } finally { $('#search-button').textContent = original; }
  });
});
$('#add-form').addEventListener('submit', event => {
  event.preventDefault();
  busy($('#add-form button[type="submit"]'), async () => {
    await api('/leads', 'POST', Object.fromEntries(new FormData(event.target)));
    event.target.reset(); $('#add-dialog').close(); chooseFilter('all', 'nav-leads'); await refresh(); toast('Lead added to your pipeline.');
  });
});
$('#draft-form').addEventListener('submit', event => { event.preventDefault(); busy($('#save-draft'), async () => { await saveDraft(); toast('Draft saved.'); }); });
$('#send-button').addEventListener('click', () => busy($('#send-button'), async () => {
  if (!config.mailReady) { $('#settings-dialog').showModal(); return; }
  await saveDraft();
  $('#confirm-copy').textContent = `From: ${config.sender}\nTo: ${current.email}\nSubject: ${current.subject}`;
  $('#confirm-dialog').showModal();
}));
$('#confirm-send').addEventListener('click', () => busy($('#confirm-send'), async () => {
  try {
    current = await api(`/leads/${current.id}/send`, 'POST', { confirm: true });
    toast('Hostinger accepted the email. Check your mailbox for delivery or bounce messages.');
  } finally {
    $('#confirm-dialog').close(); await refresh(); await openDraft(current.id);
  }
}));
$('#suppress-button').addEventListener('click', () => busy($('#suppress-button'), async () => {
  current = await api(`/leads/${current.id}/suppress`, 'POST', {});
  await refresh(); await openDraft(current.id); toast('Address added to your do-not-contact list.');
}));
$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  busy($('#login-form button'), async () => {
    try { await api('/login', 'POST', { password: $('#password').value }); $('#password').value = ''; $('#login-error').textContent = ''; await refresh(); }
    catch (error) { $('#login-error').textContent = error.message; }
  });
});
refresh().catch(error => { if (!$('#login').hidden) return; toast(error.message, true); });

$('#verify-mail').addEventListener('click', () => busy($('#verify-mail'), async () => {
  const result = await api('/mail/verify', 'POST', {});
  $('#mail-status').textContent = '● SMTP login verified · delivery still requires a test';
  toast(result.message);
}));

$('#resolve-button').addEventListener('click', () => {
  $('#resolve-form').reset();
  $('#resolve-dialog').showModal();
});
$('#resolve-form').addEventListener('submit', event => {
  event.preventDefault();
  busy($('#resolve-form button[type="submit"]'), async () => {
    current = await api(`/leads/${current.id}/reconcile`, 'POST', { reason: $('#resolve-reason').value, confirmNotAccepted: $('#resolve-confirm').checked });
    $('#resolve-dialog').close();
    await refresh(); await openDraft(current.id);
    toast('Previous attempt returned to a draft. No email was sent. Review it before sending.');
  });
});

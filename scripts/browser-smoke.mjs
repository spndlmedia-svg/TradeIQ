import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const messages = [];
const server = createApp({ config: { SMTP_USER: 'gordon@kleankickx.com' },
  discover: async () => [{ name: 'Browser Test Accra Hotel', segment: 'Hotel', address: 'Accra, Ghana', source: 'Test provider', source_id: 'browser-test-hotel', website: 'https://example.test' }],
  mailer: { sendMail: async message => { messages.push(message); return { accepted: [message.to], messageId: 'browser-test' }; } }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.campaign-card').first().waitFor();
  assert.equal(await page.locator('.campaign-card').count(), 6);
  await page.screenshot({ path: '/tmp/tradeiq-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Company research' }).click();
  await page.locator('#company-description').fill('Test reviewed profile');
  await page.locator('#company-verified').check();
  await page.getByRole('button', { name: 'Save research' }).click();
  await page.locator('#research-dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '＋ Add a lead', exact: true }).click();
  await page.locator('[name="name"]').fill('Test Accra Company');
  await page.locator('[name="email"]').fill('contact@example.test');
  await page.getByRole('button', { name: 'Add lead →', exact: true }).click();
  await page.getByRole('button', { name: 'Draft email' }).click();
  await page.locator('#contact-name').fill('Test Office Manager');
  await page.locator('#contact-role').fill('Operations manager');
  await page.locator('#draft-body').fill('A reviewed test partnership message.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('button', { name: 'Review & send' }).click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Send email', exact: false }).last().click();
  await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#stat-sent').textContent === '1');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'contact@example.test');
  assert.equal(messages[0].text, 'A reviewed test partnership message.');
  await page.locator('#draft-dialog [data-close]').click();
  await page.locator('[data-query]').first().click();
  await page.getByRole('button', { name: 'Find leads' }).click();
  await page.getByText('Browser Test Accra Hotel', { exact: true }).waitFor();
  await page.locator('[data-filter="sent"]').click();
  assert.equal(await page.locator('#leads-body tr').count(), 1);
  await page.locator('[data-filter="all"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/tradeiq-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Page must fit a mobile viewport');
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: company research, six campaigns, manual lead, decision maker, editable draft, confirmed test send, discovery, filtering and mobile layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

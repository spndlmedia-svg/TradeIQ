# Host TradeIQ on the web

## Recommended: Render with a persistent disk

`render.yaml` defines a single paid Node service and a 1 GB persistent disk. Review Render's current service and disk pricing before creating it. A free ephemeral service would lose SQLite data and may restrict SMTP, so it is not the intended configuration.

1. Publish this project's source to the selected `spndlmedia-svg/TradeIQ` GitHub repository. Do not include `.env`, `.data`, credentials, or `node_modules`.
2. In your Render account, create a **Blueprint** from that repository and select the branch containing `render.yaml`. Authorize only the repository access needed. Review the service and disk cost, then create the service.
3. Render installs dependencies, runs syntax/integration checks and starts the app. It supplies the port and `RENDER_EXTERNAL_HOSTNAME`, which the server recognizes. The service's generated `onrender.com` HTTPS hostname works without a custom domain.
4. In Render's environment settings, securely copy the generated `APP_PASSWORD` to your password manager. Use it on TradeIQ's sign-in screen. Do not paste it into this chat or commit it. The generated value is private to your hosting account.
5. You can now add leads manually, review company research and save email drafts. The database stays on `/var/data/tradeiq.sqlite` across restarts and deployments.
6. Add `GOOGLE_PLACES_API_KEY` securely to enable discovery. Enable Places API (New) and billing, and apply suitable API restrictions.
7. Add the real Hostinger mailbox password as `SMTP_PASS` securely in the hosting environment. Verify the mailbox uses `smtp.hostinger.com:465`. Do not set the Codex-only `SMTP_PROXY` on Render. Restart or redeploy after setting credentials. Review one test message to an address you control before sending to business leads.

Only the first deployment is automatic here; `autoDeployTrigger: off` prevents future Git pushes from immediately replacing the running app. Deploy subsequent reviewed changes explicitly in Render. Never run multiple instances against independent SQLite copies.

### Optional custom domain

After the generated HTTPS hostname works, add a custom domain in Render and follow the exact DNS records Render provides. Set `PUBLIC_HOST` to that hostname (for example, a chosen subdomain of kleankickx.com). Wait for valid HTTPS before using it. Do not change Kleankickx's existing website records or mail MX/SPF/DKIM/DMARC records merely to deploy this app. The app does not configure email-domain authentication; check it separately in Hostinger before real outreach.

### Verify the hosted deployment

- `/api/health` returns `{"ok":true}`.
- The root page shows TradeIQ's sign-in screen; lead APIs return 401 without a session.
- Sign in with the generated password, add a test business, save a draft, restart the service, and verify the record remains.
- A live Places request returns real business results after connecting its key.
- Send only a reviewed test email to an address you control. Verify actual receipt and replies in Hostinger. SMTP acceptance alone does not prove delivery.
- Back up the persistent disk and use SQLite-aware backups before maintenance. Session cookies expire on restart, so sign in again afterwards.

Live HTTPS, disk restoration and provider connectivity must be checked on the actual host; local test results do not establish them.

## Existing Hostinger hosting

A Hostinger mailbox is separate from app hosting. Use a plan that supports a long-running Node 24 process, persistent writable disk and outbound SMTP, or a VPS. Static web hosting is insufficient for the current backend.

Install Node 24 and dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, run checks, then configure a process manager to run `npm start` from the checkout directory. Provide these runtime values securely:

```text
NODE_ENV=production
APP_PASSWORD=<generate a unique password of at least 16 characters>
COOKIE_SECURE=true
HOST=127.0.0.1
PORT=3000
PUBLIC_HOST=<your chosen hostname, without scheme or port>
DATABASE_PATH=<persistent absolute path>/tradeiq.sqlite
```

Place an HTTPS reverse proxy in front of the loopback service. Keep data and environment files outside the public document root, and restrict filesystem permissions to the app user. Supply Google Places and SMTP settings as described above. Do not use the Codex-specific proxy outside the managed cloud. Run only one application instance, and configure backups.

The repository is prepared for deployment, but creation of a hosting account/service, billing and domain changes require access to the selected provider. No provider credentials are included in the source.

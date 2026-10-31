# Deploy TradeIQ on your existing Hostinger plan

The application requires a persistent Node **24 or newer** process, a persistent writable directory for SQLite, and outbound SMTP for email. Mail hosting alone is not application hosting. The exact plan and hostname must be confirmed before changing your server or DNS.

The requested hostname is `opaux.com`. Its DNS, existing website and hosting have not been inspected or changed. Preserve any existing site before replacing it, and preserve existing mail DNS records.

## Managed Node.js hosting

1. In hPanel, verify that your plan offers a Node.js web application with Node 24+, a persistent filesystem path and outbound TCP access to Hostinger SMTP. If Node 24 is unavailable, use a VPS or another supported runtime host; this app uses Node's built-in SQLite module.
2. Connect the GitHub repository after the application source is published, or upload the source release if the plan supports uploading a Node app. The application root must contain `package.json`, `package-lock.json`, `server.js`, and `public/`. This is a backend service, not a static site; it does not have a `dist/` output directory.
3. Choose Node 24+, install with `npm ci --ignore-scripts --no-audit --no-fund`, and set the startup command to `npm start` (or `node server.js` if the panel asks for an entry file). Let the platform supply `PORT` if it provides one.
4. Add these runtime values through hPanel. Keep credentials private:

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `HOST` | `0.0.0.0` if required by the app platform |
   | `PUBLIC_HOST` | Your actual application hostname, without scheme or port |
   | `COOKIE_SECURE` | `true` |
   | `APP_PASSWORD` | A unique generated password, at least 16 characters |
   | `DATABASE_PATH` | A writable absolute path on persistent storage, outside the public web root |
   | `SMTP_HOST` | `smtp.hostinger.com` (confirm in mailbox settings) |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `gordon@kleankickx.com` |
   | `SMTP_PASS` | Actual mailbox/app password, entered securely |
   | `SMTP_FROM_NAME` | `Gordon \| Kleankickx` |
   | `GOOGLE_PLACES_API_KEY` | Your restricted Places API (New) key; optional for manual leads |

5. Assign your selected hostname to the app and enable valid HTTPS through hPanel. Restart the app after adding environment settings. Do not set the Codex-specific `SMTP_PROXY` on Hostinger.
6. Perform the live acceptance checks below. Confirm that the selected data path survives a redeploy; a writable but ephemeral deployment directory is insufficient.

## VPS deployment

Templates are in `deploy/hostinger/`. They assume a Linux VPS using systemd and Nginx, with Node 24+ installed from a trusted distribution and TLS certificates managed on the server. Inspect existing services and server configuration before applying them.

1. Create a non-login service user and group named `tradeiq`, if they do not already exist. Install the application source under `/opt/tradeiq`; keep it outside the public document root. Do not overwrite an unrelated directory or existing installation without preserving it.
2. In `/opt/tradeiq`, run the frozen dependency install and checks:

   ```sh
   npm ci --ignore-scripts --no-audit --no-fund
   npm run check
   npm test
   ```

3. Copy the environment template to `/etc/tradeiq.env` only if that file does not exist. Set the actual hostname and credentials privately, and set root ownership and mode `0600`. Keep `HOST=127.0.0.1`, `PORT=3100`, and `DATABASE_PATH=/var/lib/tradeiq/tradeiq.sqlite` for this service template. The empty example password deliberately prevents production startup.
4. Use a verified dedicated Node 24 runtime at `/opt/tradeiq-node` to preserve the existing Node 20 installation, then review `tradeiq.service`, and install it under `/etc/systemd/system/`. Systemd's `StateDirectory` creates the private persistent database directory. Run `systemctl daemon-reload` and `systemctl enable --now tradeiq`. Inspect `systemctl status tradeiq` and `journalctl -u tradeiq` if startup fails; do not publish logs containing credentials.
5. Verify the backend internally with `curl -fsS http://127.0.0.1:3100/api/health`. Keep port 3100 private. Allow only the intended inbound web/administration ports in the VPS firewall; preserve existing SSH access and services.
6. Point `opaux.com` to the VPS using the exact IP provided by Hostinger, after checking for an existing site and preserving it if necessary. Preserve all email records. Acquire a trusted certificate using the server's existing certificate manager or an ACME client. Complete the required DNS/HTTP challenge before enabling the supplied HTTPS Nginx template; it references certificate files that must exist.
7. Adapt `nginx.conf.example` to the actual hostname and certificate paths. Integrate it alongside existing virtual hosts, run `nginx -t`, then reload Nginx only if validation passes. Avoid replacing a global Nginx configuration.
8. Perform the live acceptance checks below. Configure SQLite-aware backups of `/var/lib/tradeiq` on the hosting system.

If migrating an existing Codex database, stop the app and preserve a coherent SQLite backup, including any active WAL state, before moving data. The current real workspace has no imported customer leads, but check again before migration. Do not copy a live `.sqlite` file in isolation while writes are in progress.

## Live acceptance checks

- The selected HTTPS hostname has a valid certificate and serves TradeIQ.
- `/api/health` returns `{"ok":true}`. `/api/leads` returns 401 before sign-in.
- Sign in using the private workspace password. Add a test business, save a draft, restart the application, and verify the record persists.
- If configured, Google Places returns real Accra results. Otherwise, manual leads and drafts still work.
- Send one reviewed email to an address you control, then verify actual receipt and replies in the Hostinger mailbox. Do not use a real prospect as a test recipient. SMTP acceptance does not establish inbox delivery or create an IMAP Sent-folder copy.
- Check backups, existing website availability and existing email delivery.

Local integration tests and simulated browser sending have passed. A real hosting deployment, DNS, HTTPS, live discovery and real SMTP sending remain unverified until they are tested on the selected host.

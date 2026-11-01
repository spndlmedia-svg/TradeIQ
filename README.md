# TradeIQ for Kleankickx

A small, working lead research and email outreach application for Kleankickx Sneaker Care in Accra, Ghana. Built with Node 24, SQLite, a browser interface, Google Places discovery and Hostinger SMTP. No build step or database service is required.

## Hosting

For your existing Hostinger plan, start with [HOSTINGER.md](HOSTINGER.md). VPS service, environment and Nginx templates are in `deploy/hostinger/`. [DEPLOY.md](DEPLOY.md) also documents an optional Render deployment. Hosting is not live until provider access, the runtime, persistent storage, credentials and HTTPS are configured and tested.

## Run

Use the existing `/workspace/TradeIQ` checkout. Cloud tasks are isolated; do not create a Git worktree unless explicitly requested.

```sh
cd /workspace/TradeIQ
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

The app defaults to the loopback interface on port 3000. `npm run dev` enables Node's file watcher. Create `.env` from `.env.example` only if it does not already exist; do not overwrite an existing environment file. Supply credentials through secure environment settings or a protected, ignored local `.env`. Never commit credentials. Node's environment-file support preserves injected process variables.

## Workflow

1. **Research company:** review the editable profile and notes. The initial reference information comes from the user and is marked unverified. Traffic, employee counts and carbon savings are not invented or included in drafts.
2. **Explore competitors:** inspect the 15 user-provided reference domains. These links are research leads, not independently verified competitor records.
3. **Define campaigns:** six campaign starting points prioritize companies/offices, hotels and gyms, with coworking spaces, retailers and event/sports organizations as additional business partnerships. Select a campaign to populate a search; no fabricated audience counts are shown.
4. **Find customers:** search live Google Places results biased to Accra, Ghana, or add real business contacts manually. Provider place IDs deduplicate repeated discoveries. Google's location bias is not a strict geographic boundary; review addresses. No fictional contacts are seeded into the real database.
5. **Find decision makers:** follow each business website and record a verified contact name, role and email. Google Places does not supply personal emails or decision-maker names; the app does not guess them. Named-contact enrichment and email deliverability verification are not implemented.
6. **Write emails:** generate an editable, segment-based template, verify the recipient and review the message, then explicitly confirm one send through Gordon's connected mailbox. Drafts are templates, not LLM-generated research. Company claims and offers are not automatically inserted.

## Connections

### Google Places

Set `GOOGLE_PLACES_API_KEY`, enable Places API (New) and billing, and restrict the key to the required API. Requests use `https://places.googleapis.com/v1/places:searchText` with a maximum of 20 results. The requested fields include website and phone details, which may affect API pricing. Check current Google Maps Platform pricing and data storage/display terms before production use. The service honors the managed HTTPS proxy and configured TLS trust. A configured key does not prove live authorization.

### Hostinger Mail

Confirm these settings in the Hostinger mailbox administration panel:

- `SMTP_HOST=smtp.hostinger.com`
- `SMTP_PORT=465` (implicit TLS); port 587 uses required STARTTLS if your mailbox supports it.
- `SMTP_USER=gordon@kleankickx.com`
- `SMTP_PASS`: the actual mailbox or supported app password, supplied securely.
- `SMTP_FROM_NAME=Gordon | Kleankickx`

SMTP requires a usable runtime password, not an HTTPS proxy placeholder. In this managed cloud, set `SMTP_PROXY=http://proxy:8088` and allow **TCP egress to smtp.hostinger.com on the selected SMTP port** in environment networking. The HTTP website allowlist alone does not permit SMTP. The configuration draft API used here does not expose TCP grant editing. Ordinary deployments with direct SMTP access may omit `SMTP_PROXY`. TLS certificate verification remains enabled.

This application sends messages via SMTP only. SMTP acceptance is not proof of inbox delivery. It does not read replies/bounces or append a copy to Hostinger's Sent folder via IMAP. Review delivery information in Hostinger. Record opt-outs with **Do not contact**; they suppress all records for that email. Sent or unresolved emails to an address block another send. A connection failure or interrupted send becomes **Check mailbox** and cannot automatically retry, because the provider may already have accepted the message. An explicit SMTP rejection, including a 535 authentication failure, remains an editable draft because the server did not accept it. Previously locked records remain locked until their delivery status is reconciled. In Needs review, open the original record and choose Resolve previous attempt only after confirming non-acceptance from the original SMTP failure or provider logs. Select the evidence and explicitly confirm; this returns the record to a draft without sending it. Accepted emails and suppressed addresses cannot be unlocked this way. Business and personal addresses (including Gmail, Yahoo and Outlook) are accepted. The Connections panel includes a mailbox login test that sends no email. Reconciliation requires an operator checking the actual mailbox/provider logs; there is deliberately no blind retry button.

No live emails were sent during setup. Tests use isolated databases and explicit test providers; credentials and real contacts are never used by tests.

## Data and deployment

The local SQLite database lives in ignored `.data/tradeiq.sqlite`. Keep `.data` on persistent storage, back it up with a SQLite-aware backup, and restrict access to it. Mail and search credentials remain server-side and are never returned by the API. Research and lead data are private to this single workspace.

The server refuses a non-loopback bind without `APP_PASSWORD`. For a deployed service, use a long unique `APP_PASSWORD`, set `HOST=0.0.0.0`, set `PUBLIC_HOST` to the actual hostname without scheme or port, terminate HTTPS at a trusted reverse proxy, and set `COOKIE_SECURE=true`. Do not trust unvalidated forwarded headers. Sessions are stored in memory and expire after 12 hours; restarting logs users out. This MVP has one shared workspace password, not multi-user account management. Do not expose it publicly before configuring authentication and HTTPS.

The application currently supports manual decision-maker research and one-off emails. Automated enrichment, bulk sequences, unsubscribe links, inbound synchronization and full CRM reporting are future work.

## Validation

```sh
npm run check
npm test
npm run test:browser
npm audit --audit-level=moderate
```

Backend integration tests cover lead/draft persistence, edited messages, single-send behavior, recipient validation, duplicate prevention, opt-outs, uncertain SMTP outcomes, restart behavior, discovery deduplication, missing credentials, company research, authentication and origin checks. The browser smoke test uses the installed `/usr/bin/chromium` (override with `CHROMIUM_PATH`) and covers research, campaign rendering, lead creation, decision-maker editing, draft editing, explicit test sending, discovery, filters and a 390px mobile viewport. It writes screenshots to `/tmp/tradeiq-desktop.png` and `/tmp/tradeiq-mobile.png`. It uses simulated search/mail providers, not live external services.

To confirm the real running instance internally, request `/api/health` and check for `{ "ok": true }`, then load `/` and verify the application title. Do not create a user-facing localhost preview during cloud onboarding.

# Running LendLoop in production

The take-home runs well on one machine. These are the changes I'd make before real neighbors used it, roughly in priority order.

## Before launch

**Environments.** Use separate Clerk production instances and Convex deployments, and never share secrets between staging and production. Deploy Convex from CI with `npx convex deploy`, so schema and functions ship together with the app.

**n8n hosting.** Move from SQLite to Postgres, and run queue mode with Redis and separate workers, each with its own runner sidecar. Put it behind HTTPS with a reverse proxy, and restrict the editor to a VPN or SSO. Only `/webhook/*` needs to be public. Remove `N8N_SECURE_COOKIE=false`.

**Secrets.** Move them to a managed store such as AWS Secrets Manager, and rotate on a schedule. Rotation needs no downtime if verifiers accept two secrets at once, since the `v1=` signature prefix leaves room for a key ID. Back up `N8N_ENCRYPTION_KEY` separately, because losing it loses every stored credential.

**Email.** Send through a real provider such as Amazon SES, with SPF, DKIM and DMARC configured. Handle bounces and complaints, and add an unsubscribe path and notification preferences.

**Access.** Require MFA for admins, and review admin grants on a schedule. Turn on the Clerk webhook for `user.updated` and `user.deleted`, so deletion requests are honored automatically.

## Soon after

**Abuse controls.** Add per-user and per-IP rate limits with the Convex rate limiter component, and a WAF in front of the app and the n8n webhook. Today's listing and pending-request caps limit one account, not a determined attacker with many.

**Observability.** Send app errors to Sentry and logs and metrics to Datadog. Alert on outbox failure rate, oldest pending event, unconfirmed events and a stale overdue heartbeat, so problems page someone instead of waiting in a panel. Scrub personal data from all of it.

**Audit log.** Ship `auditLog` to append-only storage outside the application database, so an admin with database access can't rewrite it, and set a retention policy with legal input.

**Testing.** Add Playwright end-to-end tests with Clerk test users, and run the n8n smoke test in CI against a containerized stack.

## With more scale

**Reliability.** Move retries to the Convex Workpool component if volume grows, and add a dead-letter view with bulk retry. Add a two-phase claim before sending reminders to narrow the double-send window.

**Product.** Store each user's time zone so "overdue" and reminder times match their day, and add pagination and search. In-app notifications would also remove the dependence on email.

**Upgrades.** Keep n8n pinned, and test each upgrade against the exported workflows in staging. n8n 3.0 removes internal runner mode, which this setup already avoids.

## In a healthcare setting

The same design would carry over, with stricter defaults. Patient data would never reach n8n: the webhook would carry only an opaque ID and a generic message such as "you have an update", and the recipient would read the details after signing in. It would also need a BAA with every vendor that touches regulated data, encrypted and access-logged reads as well as writes, and short session lifetimes. Failed n8n runs would keep no execution data at all, since a debugging convenience shouldn't become a second copy of sensitive records.

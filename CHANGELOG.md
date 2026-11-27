# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Enabled Dependabot security-only auto-merge for security advisories (PRs labelled `security_advisory`).
  - Auto-merge only proceeds when **all** CI checks pass.
  - **Critical** severity CVE patches are merged immediately after CI passes.
  - **High** severity patches are merged within 24 hours.
  - Each auto-merged security PR is logged in this section with its advisory ID, affected package, and severity.

<!-- Auto-merged security updates are appended below by the Dependabot auto-merge workflow. -->
<!-- Format: - [<advisory-id>] <package> (<severity>) - merged <timestamp> -->

---

## [1.0.0] — 2026-10-16

### Added

- `POST /api/v1/auth/login` — exchange email + password for a JWT access token and refresh token.
- `POST /api/v1/auth/refresh` — rotate an expiring JWT using a refresh token; returns a new access/refresh pair.
- `POST /api/v1/auth/logout` — invalidate the current session and clear the Redis session cache.
- `POST /api/v1/readings` — ingest a single Ed25519-signed meter reading; enqueues an `anchor_and_mint` background job.
- `POST /api/v1/readings/batch` — ingest multiple signed readings in one request; each reading is individually validated and enqueued.
- `GET /api/v1/verify/{certificateId}` — public endpoint returning the full certificate chain (reading hash, Stellar anchor tx, mint tx, I-REC certificate ID) for independent verification.
- `GET /api/v1/verify` — batch certificate lookup; accepts a `?ids=` query parameter.
- `GET /api/v1/certificates` — list certificates for the authenticated operator; supports cursor-based pagination via `cursor` and `limit` query parameters; response includes `has_more` field. **BREAKING:** legacy `page` parameter is accepted but maps internally to cursor-based pagination.
- `POST /api/v1/certificates/{id}/transfer` — transfer a minted certificate to another Stellar address; enforces balance pre-check before submission.
- `POST /api/v1/certificates/{id}/retire` — retire (redeem) a certificate; records retirement address and timestamp on-chain.
- `GET /api/v1/cooperatives/{id}` — return cooperative metadata and aggregate stats for the authenticated cooperative admin.
- `GET /api/v1/cooperative/stats` — return per-meter generation statistics with optional `granularity` (`day` / `month`) and date-range filtering.
- `POST /api/v1/meters` — register a new meter device under the authenticated cooperative; stores Ed25519 public key.
- `PATCH /api/v1/meters/{id}/revoke` — revoke a meter's signing key; all subsequent readings from that meter are rejected.
- `GET /api/v1/jobs/{id}` — poll the status of a background job (`pending` / `running` / `done` / `failed`) by its UUID.
- `GET /api/v1/audit-log` — return a paginated audit trail for the authenticated cooperative; restricted to cooperative admins.
- `GET /api/v1/health` — public health-check endpoint; returns service and dependency status (database, Redis, Stellar RPC).
- `GET /api/v1/docs` — Swagger UI serving the OpenAPI 3.1 specification at `/api/docs/ui`.
- `POST /api/irec/register-device` — register a solar installation as an I-REC device in the Evident registry.
- `POST /api/irec/submit-batch` — aggregate verified readings for a device + calendar-month period and submit an issuance request to Evident.
- `GET /api/irec/batch-status` — poll the status of an Evident issuance request (`pending` / `processing` / `issued` / `rejected`).
- `GET /api/irec/device-status` — check registration status for a meter's Evident device record.
- `GET /api/marketplace/listings` — list available certificates on the cooperative marketplace.
- `POST /api/marketplace/listings` — publish a certificate for peer-to-peer transfer on the marketplace.
- `DELETE /api/marketplace/listings/{id}` — remove a marketplace listing.

### Changed

- All `/api/` unversioned routes now return `301 Moved Permanently` to their `/api/v1/` equivalents. Existing integrations continue to work; new integrations must use `/api/v1/`.
- `GET /api/v1/certificates` pagination changed from offset-based (`page`) to cursor-based (`cursor`). The `page` parameter is accepted for backward compatibility but is mapped internally. **BREAKING** for clients that relied on stable page numbers across concurrent writes.
- `POST /api/v1/readings` now rejects readings from revoked meters with `403 Forbidden` before signature verification. Previously, revoked-meter readings were accepted and silently dropped after verification.
- Operator suspension is now enforced at ingestion time (`POST /api/v1/readings`). A suspended operator receives `403 Forbidden` immediately; previously suspension was only enforced at login.
- All state-mutating endpoints (`POST`, `PATCH`, `DELETE`) now require a valid CSRF token in the `X-CSRF-Token` header when called from a browser context.
- Error responses across all endpoints now follow a consistent schema: `{ "error": { "code": string, "message": string } }`. **BREAKING** for clients that parsed the previous ad-hoc error body shapes.
- `GET /api/v1/cooperative/stats` added `has_more` to paginated meter stats responses, consistent with the certificates endpoint.

### Security

- CSRF validation enforced on all state-mutating routes; token obtained from `GET /api/auth/csrf`.
- Ed25519 signature verification strengthened: readings with a `timestamp` more than 5 minutes in the future or more than 24 hours in the past are rejected with `422 Unprocessable Entity`.
- Webhook signatures verified using HMAC-SHA256; requests without a valid `X-Signature-256` header are rejected with `401 Unauthorized`.
- Sentry `beforeSend` hook scrubs `email`, `access_token`, `refresh_token`, `pubkey_hex`, and `signature_hex` from all error events.

---

## [0.1.0] — 2026-01-15

### Added

- Initial SolarProof platform: cryptographic renewable energy certification from physical meter to on-chain certificate.
- Ed25519 meter signing protocol with hardware key support (HSM / PKCS#11).
- Stellar Soroban smart contracts: `audit_registry` (reading anchoring) and `energy_token` (SEP-41 certificate minting and retirement).
- Supabase Postgres schema: `cooperatives`, `meters`, `readings`, `certificates`, `jobs`.
- Row Level Security on all tables; service-role key restricted to server-side routes only.
- Docker Compose local development stack including Postgres, two Redis instances (cache on `:6379`, queue on `:6380`), and Supabase Studio.
- Vercel deployment for staging and production; blue/green deployment pipeline via GitHub Actions.
- Daily Postgres backup to S3 with 30-day retention and Slack alerts.
- Uptime monitoring for `/api/health` and `/verify`.

[Unreleased]: https://github.com/katecatherinaa/solarproof/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/katecatherinaa/solarproof/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/katecatherinaa/solarproof/releases/tag/v0.1.0

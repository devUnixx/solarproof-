# Secrets & Key Rotation Procedures (#527)

This document outlines recommended procedures and tooling for rotating GitHub secrets, Stellar keys, and service role credentials safely without downtime.

Acceptance Criteria
- Rotation steps are documented
- Secrets can be rotated without downtime
- Compromised credential handling is defined

1. Goals

- Minimize service downtime during rotation.
- Ensure there is an auditable, repeatable process for rotating credentials.
- Provide a clear incident response for compromised credentials.

2. Scope

- GitHub repository secrets (Actions, Environments)
- Stellar keypairs used for contracts and service accounts
- Cloud/service role credentials (CI/CD runners, hosted services)

3. High-level Rotation Steps

- Prepare: identify secret owners, usage locations, and dependent services. Record current versions in a secure audit log.
- Staged rollout: create a new credential alongside the existing one and deploy config that accepts either key (dual-authorization) where possible.
- Switch: update consumers to use the new credential and verify functionality.
- Revoke: remove old credential once verification and cool-down windows complete.

4. GitHub Secrets

- Use GitHub Environments for environment-specific secrets and restrict access via required reviewers.
- To rotate:
  1. Add new secret value under a temporary key name (e.g., `MY_SERVICE_KEY_v2`).
  2. Update workflows or services to read the new key name (support both during rollout).
  3. After verification, rename or remove the old key and set the canonical key name to the new value.

5. Stellar Keys

- Use a key management system (HashiCorp Vault, AWS Secrets Manager) to store Stellar seed phrases.
- To rotate service keys:
  1. Generate new keypair and store seed securely.
  2. Update contract owners or service account associations to include the new public key where necessary.
  3. Update consumers incrementally to use new signing keys (dual-signing where possible).
  4. Revoke old seed access.

6. Service Role Credentials

- Where supported, use short-lived credentials (STS) and rotating tokens via a secrets manager.
- Document the rotation schedule and automate via CI jobs that update secrets and trigger a verification pipeline.

6.1 `SUPABASE_SERVICE_ROLE_KEY` — 90-day rotation

The `SUPABASE_SERVICE_ROLE_KEY` is a long-lived credential that bypasses Row Level Security (RLS). It must be rotated every **90 days** (or immediately on suspected compromise, see §7) and scoped to the minimum permissions required by the backend service. See `docs/SECRETS.md` for where this key is stored and consumed.

**Rotation procedure (no downtime):**

1. **Create the new key** — in the Supabase dashboard, generate a new service role key (or a scoped API key with the minimum required permissions). Store it in the secrets manager under a temporary name (e.g., `SUPABASE_SERVICE_ROLE_KEY_v2`). Do not overwrite the current key yet.
2. **Dual-accept window** — deploy configuration so consumers accept both the old and new keys (e.g., the backend reads `SUPABASE_SERVICE_ROLE_KEY` and falls back to `SUPABASE_SERVICE_ROLE_KEY_v2`, or the secrets manager serves both versions). Verify the new key works end-to-end before proceeding.
3. **Switch consumers** — update all consumers (CI/CD workflows, hosted services, backend jobs) to use the new key as the canonical `SUPABASE_SERVICE_ROLE_KEY`. Confirm health checks and integration tests pass.
4. **Revoke the old key** — after a cool-down window (minimum 24 hours) with no errors, revoke the old key in Supabase and remove it from the secrets manager and GitHub secrets.
5. **Record the rotation** — write an audit log entry (see below) and update the `updated_at` timestamp used by the reminder workflow.

**Testing the procedure:**

- Run the rotation in a staging environment first using the same steps above.
- Confirm the dual-accept window works by exercising a request with each key version.
- Run the verification pipeline (`.github/workflows/secrets-rotation-reminder.yml` with `dry_run=true`, plus the standard CI suite) to confirm consumers resolve the new key.
- Verify the old key is rejected after revocation (expect `401`/`403` from Supabase).

**Expiry alerting:**

- The `.github/workflows/secrets-rotation-reminder.yml` job compares the key's `updated_at` against the 90-day max age and opens a GitHub issue when it is exceeded.
- An additional warning issue is created when the key is within **14 days** of its 90-day expiry, so rotation can be scheduled before it lapses.
- Alerts are routed to the `backend-team` owner listed in §8.

**Audit log:**

- Every rotation must create an audit log entry recording: the secret name, the rotation timestamp, the operator, the old key version (never the key value), and the new key version.
- Audit entries are retained per the incident/audit policy and referenced in the rotation issue.
=======

7. Compromised Credential Handling

- Immediate actions:
  - Revoke the compromised credential immediately.
  - Audit recent logs and rotate any related keys.
  - Create incident ticket and notify stakeholders.
- Post-incident:
  - Rotate all related credentials.
  - Review and improve access controls.

8. Rotation Schedule (per secret type)

| Secret | Max Age | Owner | Procedure |
|--------|---------|-------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | 90 days | backend-team | §6.1 Service Role Credentials |
| `MINTER_SECRET_KEY` | 180 days | contracts-team | §5 Stellar Keys |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 365 days | backend-team | §4 GitHub Secrets |
| `STELLAR_TESTNET_SECRET_KEY` | 180 days | contracts-team | §5 Stellar Keys |
| `VERCEL_TOKEN` | 90 days | devops-team | §6 Service Role Credentials |
| `TURBO_TOKEN` | 90 days | devops-team | §6 Service Role Credentials |
| `INTERNAL_BRIDGE_SECRET` | 90 days | backend-team | §8a Internal Bridge Secret |

8a. Internal Bridge Secret (`INTERNAL_BRIDGE_SECRET`)

The bridge microservice requires an `X-Internal-Secret` header on all internal API requests (zero-trust internal service authentication). Next.js injects the secret from its environment on every outbound bridge call. The same value must be configured on both services.

- Where it lives:
  - Next.js: `INTERNAL_BRIDGE_SECRET` env var (server-side only; never expose via `NEXT_PUBLIC_*`).
  - Bridge: `INTERNAL_BRIDGE_SECRET` env var.
  - GitHub: repository/environment secret `INTERNAL_BRIDGE_SECRET` used by deploy workflows.
- To rotate without downtime (dual-accept window):
  1. Generate a new high-entropy secret (e.g., `openssl rand -hex 32`) and store it in the secrets manager.
  2. Deploy the bridge with both the old and new secrets accepted (dual-accept window). The bridge must continue to accept the old secret while the new one is being rolled out.
  3. Update the Next.js `INTERNAL_BRIDGE_SECRET` env var to the new value and redeploy. Verify outbound bridge calls succeed.
  4. Confirm no requests are still using the old secret (check bridge auth logs/metrics for the old key).
  5. Remove the old secret from the bridge's accepted set and redeploy the bridge.
  6. Revoke the old secret in the secrets manager and record the rotation in the audit log.
- Compromise handling: if the secret is leaked, skip the dual-accept window — rotate immediately on both services, then audit bridge logs for unauthorized `X-Internal-Secret` usage.

9. Automation — Rotation Reminder & Audit CI Job

The workflow `.github/workflows/secrets-rotation-reminder.yml` runs automatically on the 1st of every month at 09:00 UTC and can also be triggered manually via `workflow_dispatch`.

**What it does:**
- Reads the rotation manifest and rotation log (see below) to determine each secret's last rotation date.
- Compares each secret's age against its `max_age_days` policy.
- **Fails the job (and therefore blocks deployment) if any secret is older than its `max_age_days`.** The job output lists every overdue secret with its age and policy so it can be actioned immediately.
- Creates a GitHub issue for every overdue secret (skips if an open issue already exists for that secret).
- Supports a `dry_run` input to report without creating issues or failing the build.

**Trigger manually:**
```bash
gh workflow run secrets-rotation-reminder.yml --field dry_run=true
```

### 9.1 Rotation Manifest

The manifest `.github/secrets-rotation-manifest.yml` defines the rotation policy for every managed secret. Each entry has:

| Field | Description |
|-------|-------------|
| `name` | Secret name (must match the name used in the rotation log and in GitHub) |
| `max_age_days` | Maximum allowed age, in days, before the secret is considered overdue |
| `owner` | Team responsible for rotating the secret |
| `procedure` | Reference to the rotation procedure section in this document |

Example entry:

```yaml
secrets:
  - name: SUPABASE_SERVICE_ROLE_KEY
    max_age_days: 90
    owner: backend-team
    procedure: "§4 GitHub Secrets"
```

**Adding a new secret to the manifest:**
1. Add an entry to `.github/secrets-rotation-manifest.yml` with `name`, `max_age_days`, `owner`, and `procedure`.
2. Add a matching entry to the rotation log (`.github/secrets-rotation-log.yml`) with the date the secret was created/rotated.
3. Add the secret to the schedule table in §8 of this document.
4. Open a PR; CI will validate the manifest and log entries.

### 9.2 Rotation Log

The rotation log `.github/secrets-rotation-log.yml` records the last rotation date for each secret. The CI job uses this as the source of truth for secret age.

```yaml
rotations:
  - name: SUPABASE_SERVICE_ROLE_KEY
    last_rotated: 2024-01-15
    rotated_by: backend-team
```

**After rotating a secret:**
1. Update the `last_rotated` date for that secret in `.github/secrets-rotation-log.yml` (use the date the new credential went live).
2. Update `rotated_by` to the team or person who performed the rotation.
3. Commit the change (via PR) referencing the rotation ticket or incident.
4. Optionally add a note in the PR description describing verification steps performed.

If a secret is missing from the log, the CI job treats it as overdue and fails, so always keep the manifest and log in sync.

### 9.3 Deployment Blocking

Because the audit job fails on overdue secrets, any workflow that depends on it (deployment pipelines) will not proceed until the secret is rotated and the rotation log updated. This enforces the rotation schedule rather than relying on reminders alone.

**Gitleaks:**
The `secret-scanning.yml` workflow runs Gitleaks on every push and pull request to `main`/`develop` and on a weekly schedule. The `.gitleaks.toml` configuration file in the repo root controls which patterns are scanned.

10. References
- See `docs/DEPLOYMENT.md` and repository CI config for current secret usage patterns.
- Secret storage and consumption map: `docs/SECRETS.md`
- Automation workflow: `.github/workflows/secrets-rotation-reminder.yml`
- Secret scanning workflow: `.github/workflows/secret-scanning.yml`

Link to issue: #527 | #72

# Database Schema

## Migration 001

```sql
create table cooperatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_address text not null,
  created_at timestamptz not null default now()
);

create table meters (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  serial_number text not null unique,
  pubkey_hex text not null,   -- Ed25519 public key (64 hex chars = 32 bytes)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table readings (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references meters(id) on delete cascade,
  kwh numeric(12,4) not null check (kwh > 0),
  timestamp timestamptz not null,
  reading_hash text not null unique,   -- SHA-256 hex
  signature_hex text not null,         -- Ed25519 signature hex (128 chars)
  anchor_tx_hash text,
  mint_tx_hash text,
  anchored boolean not null default false,
  minted boolean not null default false
);

create table certificates (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null references cooperatives(id) on delete cascade,
  reading_id uuid not null references readings(id),
  reading_hash text not null,
  anchor_tx_hash text not null,
  mint_tx_hash text not null unique,
  kwh numeric(12,4) not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,   -- nullable; null = never expires
  retired boolean not null default false,
  retired_at timestamptz,
  retired_by text
);
```

## Migration 002 — indexes

```sql
create index on meters(cooperative_id);
create index on readings(meter_id);
create index on readings(reading_hash);
create index on certificates(cooperative_id);
create index on certificates(reading_hash);
create index on certificates(mint_tx_hash);
create index on certificates(expires_at);
```

---

## RLS Policy Matrix

Row Level Security is enabled on all tables. The API uses the Supabase **service role key** (bypasses RLS entirely) for server-side operations. Direct client connections use a JWT carrying `app_metadata.cooperative_id` and `app_metadata.role`.

**Role definitions used in this matrix:**

| Role | Description |
|---|---|
| `member` | Authenticated operator; JWT carries `cooperative_id` |
| `admin` | Authenticated operator with `role = 'admin'` in JWT |
| `service_role` | Server-side API key; bypasses RLS |
| `anon` | Unauthenticated request |

Legend: ✅ allowed · ❌ denied · `own` = rows belonging to the caller's cooperative only

### Core tables

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `cooperatives` | member | ✅ own | ❌ | ❌ | ❌ | Read own cooperative row |
| `cooperatives` | admin | ✅ all | ✅ | ✅ | ✅ | Full access |
| `cooperatives` | service_role | ✅ all | ✅ | ✅ | ✅ | Bypasses RLS |
| `cooperatives` | anon | ❌ | ❌ | ❌ | ❌ | |
| `meters` | member | ✅ own | ❌ | ❌ | ❌ | Via `cooperative_id` join |
| `meters` | admin | ✅ all | ✅ | ✅ | ✅ | |
| `meters` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `meters` | anon | ❌ | ❌ | ❌ | ❌ | |
| `readings` | member | ✅ own | ❌ | ❌ | ❌ | Via `meter_id → cooperative_id` |
| `readings` | admin | ✅ all | ✅ | ✅ | ✅ | |
| `readings` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `readings` | anon | ❌ | ❌ | ❌ | ❌ | |
| `certificates` | member | ✅ own | ❌ | ❌ | ❌ | Via `cooperative_id` |
| `certificates` | admin | ✅ all | ✅ | ✅ | ✅ | |
| `certificates` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `certificates` | anon | ❌ | ❌ | ❌ | ❌ | |

### Marketplace

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `marketplace_listings` | member | ✅ active + own | ✅ own | ✅ own | ✅ own | Active listings visible to all operators |
| `marketplace_listings` | admin | ✅ all | ✅ | ✅ | ✅ | |
| `marketplace_listings` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `marketplace_listings` | anon | ❌ | ❌ | ❌ | ❌ | |

### Audit log

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `audit_log` | member | ❌ | ❌ | ❌ | ❌ | Write via service_role only |
| `audit_log` | admin | ✅ all | ✅ | ❌ | ❌ | Append-only; UPDATE/DELETE blocked by rule |
| `audit_log` | service_role | ✅ all | ✅ | ❌ | ❌ | Append-only |
| `audit_log` | anon | ❌ | ❌ | ❌ | ❌ | |
| `audit_logs` | member | ❌ | ❌ | ❌ | ❌ | Service role only |
| `audit_logs` | service_role | ✅ all | ✅ | ❌ | ❌ | Append-only; UPDATE/DELETE revoked |
| `audit_logs` | anon | ❌ | ❌ | ❌ | ❌ | |

### Session and webhook tables

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `operator_sessions` | member | ❌ | ❌ | ❌ | ❌ | Service role only |
| `operator_sessions` | service_role | ✅ all | ✅ | ✅ | ✅ | Manages refresh token rotation |
| `webhook_endpoints` | member | ✅ own | ✅ own | ✅ own | ✅ own | Via `cooperative_id` |
| `webhook_endpoints` | admin | ✅ all | ✅ | ✅ | ✅ | |
| `webhook_endpoints` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `webhook_logs` | member | ✅ own | ❌ | ❌ | ❌ | Via endpoint → cooperative |
| `webhook_logs` | service_role | ✅ all | ✅ | ✅ | ✅ | Delivery retries managed server-side |

### Notification tables

| Table | Role | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|---|
| `notification_preferences` | member | ✅ own | ✅ own | ✅ own | ✅ own | Via `cooperative_members` membership |
| `notification_preferences` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `notifications` | member | ✅ own | ✅ own | ✅ own | ✅ own | Via `cooperative_members` membership |
| `notifications` | service_role | ✅ all | ✅ | ✅ | ✅ | |
| `notification_deliveries` | member | ✅ own | ✅ own | ✅ own | ✅ own | Via notification → cooperative |
| `notification_deliveries` | service_role | ✅ all | ✅ | ✅ | ✅ | Retry state managed server-side |

> **Maintenance note:** Update this matrix in every PR that adds or modifies a migration. The security lead must review and sign off any change that widens access (adds a ✅ or relaxes a scope). Migrations that add new tables without RLS policies will fail the `validate-rls` CI check.

---

## Migration Reference

| Migration file | Purpose |
|---|---|
| `20240101000001_initial_schema.sql` | Core tables: `cooperatives`, `meters`, `readings`, `certificates` |
| `20240101000002_indexes.sql` | Performance indexes on core tables |
| `20240101000003_rls.sql` | RLS policies for core tables + `marketplace_listings` |
| `20240101000005_audit_log.sql` | `audit_log` append-only table |
| `20240101000005_idempotency_keys.sql` | Idempotency key deduplication |
| `20240101000005_jobs.sql` | Background job queue |
| `20240101000005_certificate_retirement.sql` | Certificate retirement fields |
| `20240101000005_retention_policy.sql` | Data retention configuration |
| `20240101000006_webhooks.sql` | `webhook_endpoints` and `webhook_logs` |
| `20240101000007_notifications.sql` | `notification_preferences`, `notifications`, `notification_deliveries` with RLS |
| `20260426000007_operator_sessions.sql` | `operator_sessions` for JWT refresh rotation |
| `20260427000008_meter_name_mint_diagnosis.sql` | Meter display name and mint diagnosis fields |
| `20260428000009_perf_indexes.sql` | Additional performance indexes |
| `20260530000009_meter_revocation.sql` | `revoked_at` and `revocation_reason` on `meters` |
| `20260531000003_rls_policies.sql` | Refined RLS policies (member/admin separation) |
| `20260601000000_create_audit_logs.sql` | `audit_logs` table (service-role-only, append-only) |
| `20260601000009_multi_meter_support.sql` | Multi-meter per cooperative support |
| `20260601000009_operator_suspended.sql` | Operator suspension flag |
| `20260601000009_revoked_tokens.sql` | Revoked token tracking |

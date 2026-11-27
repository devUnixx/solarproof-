# Test Coverage Targets

This document defines coverage goals, critical modules, and failure criteria for the SolarProof project.

---

## Coverage goals by layer

| Layer | Tool | Target | Minimum to pass CI |
|---|---|---|---|
| Soroban contracts (Rust) | `cargo test` + `cargo llvm-cov` | **90 %** line coverage | **80 %** |
| API routes (Next.js) | Jest / Vitest | **90 %** line coverage | **80 %** |
| Frontend components | Vitest + React Testing Library | **70 %** line coverage | **60 %** |
| Shared `packages/stellar` | Vitest | **85 %** line coverage | **75 %** |

> Targets apply to new code merged into `main`. Legacy code brought in by third-party deps is excluded.

---

## Critical modules

The following modules have elevated importance. Coverage falling below the **minimum** threshold blocks merge.

### Contracts

| Module | Why critical |
|---|---|
| `energy_token` — `mint`, `burn`, `transfer` | Financial correctness; over/undercounting tokens is unrecoverable on-chain |
| `audit_registry` — `anchor`, `verify` | Immutable records; a bug here produces permanently incorrect proofs |
| `energy_token` — `set_minter` / admin auth | Privilege escalation risk |
| `audit_registry` — duplicate-anchor guard | Prevents replaying the same reading as multiple certificates |

### API routes

| Module | Why critical |
|---|---|
| `POST /api/readings` — Ed25519 verification | A bypass here allows minting without real generation |
| `POST /api/readings` — Supabase write path | Data integrity for meter records |
| `GET /api/verify` | Public-facing audit endpoint; incorrect output breaks trust |

### Frontend

| Module | Why critical |
|---|---|
| `src/lib/crypto.ts` — `verifyReading` | Client-side signature check mirrors server logic |
| `src/lib/stellar.ts` — contract invocation helpers | Incorrect ABI encoding silently produces bad transactions |

---

## What must be tested

### Contracts (must have unit tests)
- Happy-path for every public entrypoint
- Auth failures (`require_auth` panics when called by wrong account)
- Boundary / overflow conditions (zero amounts, duplicate anchors, double-voting)
- Event emission for state-changing calls

### API routes (must have integration tests)
- Valid request → 200 + expected payload
- Missing or malformed fields → 400
- Invalid Ed25519 signature → 403
- Supabase / Stellar errors → 500 with structured error body

### Frontend components
- Render without errors for all prop variants
- Error and loading states displayed correctly
- Wallet-connection flows (mocked)

---

## End-to-end QA scenario catalogue

This catalogue is the reference for QA engineers exercising the system end to end. Each row describes a scenario, its preconditions, the steps to reproduce it, the expected result, and the test file that covers it. When a scenario has no automated coverage yet, the linked file is the one where the test should live.

| Scenario | Preconditions | Steps | Expected result | Test file |
|---|---|---|---|---|
| **Invalid signature** — reading submitted with a signature that does not match the meter key | A registered meter with a known public key; a signed reading payload | Tamper with the payload (or signature) after signing, then submit it to `POST /api/readings` | Request rejected with **403**; no reading persisted; structured error body returned | [`apps/web/e2e/verify.spec.ts`](../apps/web/e2e/verify.spec.ts), [`apps/web/src/app/api/verify/route.test.ts`](../apps/web/src/app/api/verify/route.test.ts) |
| **Stale timestamp** — reading whose timestamp is outside the accepted freshness window | A registered meter; a correctly signed reading with a timestamp older than the allowed skew | Sign the reading with an old timestamp and submit it to `POST /api/readings` | Request rejected with **400/403**; error indicates stale timestamp; no reading persisted | [`apps/web/e2e/verify.spec.ts`](../apps/web/e2e/verify.spec.ts), [`apps/web/src/app/api/verify/route.test.ts`](../apps/web/src/app/api/verify/route.test.ts) |
| **Duplicate nonce** — replaying a previously accepted reading | A reading that has already been accepted and persisted | Re-submit the identical signed payload (same nonce) to `POST /api/readings` | Request rejected with **409**; the original reading is unchanged; no second certificate is minted | [`apps/web/e2e/certificate.spec.ts`](../apps/web/e2e/certificate.spec.ts), [`apps/web/src/app/api/verify/[id]/route.test.ts`](../apps/web/src/app/api/verify/[id]/route.test.ts) |
| **Revoked meter** — reading from a meter that has been revoked | A registered meter that an operator has revoked | Submit a correctly signed reading from the revoked meter | Request rejected with **403**; error identifies the meter as revoked; no reading persisted | [`apps/web/e2e/dashboard.spec.ts`](../apps/web/e2e/dashboard.spec.ts), [`apps/web/src/app/api/meters/[id]/revoke/route.ts`](../apps/web/src/app/api/meters/[id]/revoke/route.ts) |
| **Suspended operator** — action attempted by an operator whose account is suspended | An operator account in the suspended state | Attempt a privileged action (e.g. revoke a meter or approve a retirement) as the suspended operator | Action rejected with **403**; no state change; audit log records the denied attempt | [`apps/web/e2e/retirement.spec.ts`](../apps/web/e2e/retirement.spec.ts), [`apps/web/src/lib/operator-suspension.ts`](../apps/web/src/lib/operator-suspension.ts) |
| **CSRF protection** — state-changing request without a valid CSRF token | An authenticated session | Submit a state-changing request with a missing or invalid CSRF token | Request rejected with **403**; no state change | [`apps/web/e2e/csrf.spec.ts`](../apps/web/e2e/csrf.spec.ts) |
| **Public verify without auth** — unauthenticated access to the public verification endpoint | No session | Request `GET /api/verify` (and the public verify page) without credentials | Request succeeds with **200** and the expected public payload; no private data leaked | [`apps/web/e2e/verify-public-no-auth.spec.ts`](../apps/web/e2e/verify-public-no-auth.spec.ts), [`apps/web/src/app/api/verify/route.test.ts`](../apps/web/src/app/api/verify/route.test.ts) |

> **Maintenance rule:** every new feature PR **must** add the corresponding scenarios to this table (and link the covering test file) before it can be merged. A PR that introduces new behaviour without a matching scenario entry fails review.

---

## Failure criteria
=======

A PR **fails coverage checks** if any of the following are true:

1. Any layer's coverage drops **below the minimum** threshold in the table above.
2. A critical module listed above has **any untested public entrypoint**.
3. An auth-gating path (admin / minter require_auth) has no test asserting it panics when called without authorization.
4. The total number of contract tests decreases (tests must not be deleted to inflate line percentages).

---

## Running coverage locally

### Contracts

```bash
# Install cargo-llvm-cov once
cargo install cargo-llvm-cov

cd apps/contracts
cargo llvm-cov --all --html
# Report: apps/contracts/target/llvm-cov/html/index.html
```

### API + frontend

```bash
# From repo root
pnpm test -- --coverage
```

---

## Dependencies

- Contract coverage depends on `cargo-llvm-cov` being available in CI (see `.github/workflows/ci.yml`).
- Frontend/API coverage depends on a Vitest or Jest config with `coverage.provider = 'v8'`.
- See also: test strategy document (linked from CONTRIBUTING.md when available).

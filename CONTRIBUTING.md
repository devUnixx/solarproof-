# Contributing to SolarProof

Thanks for contributing! PRs target `develop`. All CI must pass before merge.

---

## Getting Started

> **First time here?** Follow the [Developer Onboarding Guide](docs/ONBOARDING.md) to set up your local environment end-to-end before contributing.

1. Browse [open issues](../../issues) — look for `good first issue`
2. Comment to claim before starting
3. Fork and branch from `develop`

```bash
git clone https://github.com/katecatherinaa/solarproof.git
cd solarproof
git checkout develop
git checkout -b feat/your-feature
pnpm install --frozen-lockfile
```

---

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<short-description>-<issue>` | `feat/batch-anchor-42` |
| Bug fix | `fix/<short-description>-<issue>` | `fix/signature-validation-17` |
| Docs | `docs/<short-description>` | `docs/contract-interfaces` |
| Chore / CI | `chore/<short-description>` | `chore/turbo-remote-cache` |
| Release | `release/v<semver>` | `release/v1.2.0` |

---

## Commit Message Format (Conventional Commits)

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: BREAKING CHANGE: ..., Closes #<issue>]
```

**Types:** `feat` · `fix` · `security` · `contracts` · `docs` · `chore` · `refactor` · `test` · `ci` · `perf`

**Scopes:** `api` · `contracts` · `web` · `stellar` · `ci` · `docs`

```
feat(contracts): add batch anchor support
fix(api): validate Ed25519 signature before DB write
security(api): add CSRF protection to operator endpoints
contracts: optimize audit_registry storage for large ledgers
docs(contracts): document energy_token interface
chore(ci): configure Turborepo remote caching
feat(contracts)!: rename anchor() parameter kwh → kwh_stroops

BREAKING CHANGE: kwh parameter renamed to kwh_stroops (units: kwh * 10^7)
Closes #42
```

---

## Development Commands

```bash
pnpm dev                              # Next.js dev server
pnpm lint                             # ESLint + tsc
pnpm build                            # Full monorepo build
cd apps/contracts && cargo test       # Rust contract tests
cd apps/contracts && stellar contract build  # Build WASM
```

---

## PR Checklist

Before opening a PR, confirm:

- [ ] Branch is based on `develop` (not `main`)
- [ ] Branch name follows the convention above
- [ ] All commits follow Conventional Commits format
- [ ] `pnpm lint` passes with no errors
- [ ] `pnpm build` succeeds
- [ ] Relevant tests added or updated
- [ ] `cargo test` passes for any contract changes
- [ ] Docs updated if public interfaces changed
- [ ] PR description references the issue (`Closes #<n>`)
- [ ] No secrets or `.env` files committed

---

## Code Review Expectations

**For authors:**
- Keep PRs focused — one concern per PR
- Respond to review comments within 2 business days
- Resolve conversations before requesting re-review
- Don't force-push after review has started (use new commits)

**For reviewers:**
- Review within 2 business days of assignment
- Distinguish blocking issues from suggestions (prefix suggestions with `nit:`)
- Approve only when all blocking issues are resolved
- At least 1 approval required before merge

**Merge strategy:** Squash and merge into `develop`. Merge commits into `main` for releases only.

---

## Smart Contract Changes

Contract changes require extra care:

- All public function signatures are part of the on-chain ABI — breaking changes need a `BREAKING CHANGE:` footer
- Update `docs/contracts/<name>.md` for any interface changes
- Run `cargo test` and include test output in the PR description
- Tag breaking changes with the `breaking-change` label

---

## Writing Soroban Contract Tests

> See also: [README.md — Contract Tests](README.md#contract-tests)

All Soroban contracts live under `apps/contracts/`. Each contract has its tests co-located in its `src/lib.rs` (unit tests) or in a `tests/` directory (integration tests).

### Environment setup

Every test that calls contract functions needs a `soroban_sdk::Env`. The idiomatic setup is:

```rust
use soroban_sdk::{testutils::Address as _, Env};

fn setup() -> (Env, Address, MyContractClient<'static>) {
    let env = Env::default();
    // mock_all_auths() satisfies every require_auth() call without real signatures.
    // Use it for unit tests. For auth-specific tests, use mock_auths() with explicit
    // expectations instead.
    env.mock_all_auths();

    let contract_id = env.register(MyContract, ());
    let client = MyContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    (env, admin, client)
}
```

### Unit tests

Unit tests live in a `#[cfg(test)] mod tests` block inside `src/lib.rs`. Keep each test focused on a single behaviour:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Ledger, Env};

    #[test]
    fn test_anchor_records_ledger_sequence() {
        let (env, api_signer, client) = setup();

        // Advance the ledger so the sequence number is predictable.
        env.ledger().set_sequence_number(42);

        let hash = BytesN::from_array(&env, &[1u8; 32]);
        let nonce = BytesN::from_array(&env, &[2u8; 32]);
        client.anchor(&api_signer, &hash, &nonce);

        let anchor = client.verify(&hash).unwrap();
        assert_eq!(anchor.anchored_at_ledger, 42);
    }

    // Test that a function panics with a specific message.
    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let (env, _, client) = setup();
        let admin2 = Address::generate(&env);
        client.initialize(&admin2); // must panic
    }

    // Test that a function returns a typed contract error.
    #[test]
    fn test_unauthorized_caller_rejected() {
        let (env, _, client) = setup();
        let attacker = Address::generate(&env);
        assert_eq!(
            client.try_anchor(&attacker, &hash(&env), &nonce(&env)),
            Err(Ok(Error::Unauthorized))
        );
    }
}
```

**Key patterns:**

- Use `client.try_<fn>()` to test expected errors — it returns `Result<T, Result<Error, InvokeError>>`.
- Use `#[should_panic(expected = "...")]` for panics with known messages.
- Use `env.ledger().set_sequence_number(n)` or `env.ledger().with_mut(|l| l.sequence_number += n)` to control ledger state.
- Generate test addresses with `Address::generate(&env)` — never hardcode them.

### Snapshot tests

Snapshot tests capture the full ledger state after a sequence of calls and compare it against a stored JSON file. They catch unintended storage layout changes.

Snapshots are stored in `<contract>/test_snapshots/`. They are committed to the repository and must be updated deliberately — a snapshot diff in a PR signals a storage change that reviewers should scrutinise.

```rust
// Snapshot tests are ordinary #[test] functions. The soroban-sdk testutils
// automatically write/compare the snapshot file based on the test name.
#[test]
fn test_anchor_and_verify() {
    let (env, api_signer, client) = setup();
    let hash = BytesN::from_array(&env, &[1u8; 32]);
    client.anchor(&api_signer, &hash, &BytesN::from_array(&env, &[9u8; 32]));
    // The snapshot file is written to:
    // test_snapshots/tests/test_anchor_and_verify.1.json
    assert!(client.is_anchored(&hash));
}
```

If you intentionally change storage layout, regenerate snapshots by deleting the relevant `.json` files and running `cargo test` to recreate them. Commit the new files alongside your code change.

### Proptest (property-based tests)

Property tests live in `apps/contracts/proptest/`. They use the `proptest` crate to generate random inputs and assert invariants:

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn mint_total_supply_equals_sum_of_balances(amount in 1_i128..1_000_000_i128) {
        let env = Env::default();
        env.mock_all_auths();
        // ... set up and exercise the contract ...
        // assert the invariant holds for every generated `amount`
        prop_assert!(total_supply >= 0);
    }
}
```

### Running tests locally

```bash
# All contract tests
cd apps/contracts
cargo test

# Single contract
cargo test -p audit-registry

# Single test by name
cargo test -p audit-registry test_anchor_and_verify

# With output (useful for debugging)
cargo test -p audit-registry -- --nocapture

# Proptest suite
cargo test -p solarproof-proptest
```

### Naming convention

Follow the same convention used for regression tests:

- Rust: `fn test_<behaviour>()`  — e.g. `fn test_duplicate_anchor_rejected()`
- Include the issue number for regression tests: `fn test_issue_73_duplicate_anchor_rejected()`

---

## Reporting Issues

Use the [issue templates](../../issues/new/choose). For security vulnerabilities, see [SECURITY.md](SECURITY.md).

---

## Regression Tests

Every closed bug issue must have a corresponding regression test to prevent the bug from being silently reintroduced.

### Process

1. **When a bug is fixed**, add a regression test in the same PR as the fix (or in a follow-up PR referencing the issue).
2. **File location** — regression tests live in `apps/web/src/app/api/__tests__/regression.test.ts` for API-layer bugs. For contract bugs, add tests in the relevant contract's `#[cfg(test)]` module.
3. **Naming convention** — test names must include the issue number:
   - TypeScript: `it('test_issue_<N>_<description>', ...)`
   - Rust: `#[test] fn test_issue_<N>_<description>()`
4. **Link the issue** — add a comment at the top of the test or describe block referencing the issue number and a one-line description of the bug.
5. **CI** — regression tests run automatically in CI via `pnpm test` (TypeScript) and `cargo test` (Rust). No extra configuration is needed.

### Example

```ts
// Regression for #29 — API routes accepted raw input without schema validation
it('test_issue_29_readings_rejects_negative_kwh', async () => {
  const res = await POST(makeRequest({ meter_id: METER_ID, kwh: -1, ... }))
  expect(res.status).toBe(400)
})
```

### Covered issues

| Issue | Description | Test file |
|-------|-------------|-----------|
| #29 | Input validation on all API routes | `src/app/api/__tests__/regression.test.ts` |
| #49 | Stellar account existence check before minting | `src/app/api/__tests__/regression.test.ts` |
| #51 | Overflow protection in energy_token mint arithmetic | `apps/contracts/energy_token/src/lib.rs` |
| #73 | Reading deduplication in audit_registry | `apps/contracts/audit_registry/src/lib.rs`, `src/app/api/__tests__/regression.test.ts` |

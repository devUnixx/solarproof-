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

## Adding a New Locale

SolarProof currently ships with **English (`en`)** and **French (`fr`)**. Community translators are welcome to add new locales (e.g. Spanish, Portuguese, Arabic). Follow the steps below to add one.

### Step-by-step

1. **Copy the English source file.** All translations start from the canonical English message catalogue:

   ```bash
   cp apps/web/messages/en.json apps/web/messages/<locale>.json
   ```

   Use the [BCP 47](https://www.rfc-editor.org/info/bcp47) language tag as the filename (e.g. `es.json`, `pt-BR.json`, `ar.json`).

2. **Translate every key.** Open `apps/web/messages/<locale>.json` and translate each value. Do **not**:
   - rename, add, or remove keys (the key set must match `en.json` exactly);
   - translate interpolation placeholders such as `{count}`, `{name}`, or `{date}` — keep them verbatim;
   - translate HTML tags or ICU syntax (`{count, plural, ...}`).

3. **Register the locale** in `apps/web/src/lib/locales.ts`. Add the new tag to each of the following exports:

   | Export | Purpose | Example entry |
   |---|---|---|
   | `locales` | Array of supported locale tags | `'es'` |
   | `LOCALE_LABELS` | Human-readable label shown in the language picker | `es: 'Español'` |
   | `LOCALE_NAMES` | English name used in metadata / logs | `es: 'Spanish'` |
   | `LOCALE_DIRECTIONS` | Text direction (`'ltr'` or `'rtl'`) | `es: 'ltr'` |

   ```ts
   // apps/web/src/lib/locales.ts (excerpt)
   export const locales = ['en', 'fr', 'es'] as const

   export const LOCALE_LABELS: Record<Locale, string> = {
     en: 'English',
     fr: 'Français',
     es: 'Español',
   }

   export const LOCALE_NAMES: Record<Locale, string> = {
     en: 'English',
     fr: 'French',
     es: 'Spanish',
   }

   export const LOCALE_DIRECTIONS: Record<Locale, 'ltr' | 'rtl'> = {
     en: 'ltr',
     fr: 'ltr',
     es: 'ltr',
   }
   ```

4. **Run the translation check.** The `i18n:check` script (`apps/web/scripts/check-translations.mjs`) verifies that every locale has 100% key coverage against `en.json` and that no placeholders are missing:

   ```bash
   pnpm --filter web i18n:check
   ```

   Fix any reported missing or extra keys before opening a PR. CI runs this check automatically.

5. **Open a PR** using the `docs` or `feat` type, e.g. `feat(web): add Spanish locale`. Reference this section in the PR description.

### Pluralisation rules per locale

Pluralisation is handled by ICU MessageFormat. Each locale has its own set of plural categories — use the correct category keys in your translations.

| Locale | Plural categories | Notes |
|---|---|---|
| English (`en`) | `one`, `other` | `one` for exactly 1, `other` for everything else (including 0). |
| French (`fr`) | `one`, `many`, `other` | `one` covers 0 and 1; `many` is used for large numbers (e.g. millions) in formal contexts; `other` for the rest. |
| Spanish (`es`) | `one`, `many`, `other` | `one` for exactly 1; `many` for large compact numbers; `other` otherwise. |
| Portuguese (`pt`, `pt-BR`) | `one`, `many`, `other` | Same shape as Spanish; `one` for exactly 1. |
| Arabic (`ar`) | `zero`, `one`, `two`, `few`, `many`, `other` | Six categories. Also **RTL** — set `LOCALE_DIRECTIONS.ar = 'rtl'`. |

Example (English):

```json
"readings.count": "{count, plural, one {# reading} other {# readings}}"
```

Example (Arabic):

```json
"readings.count": "{count, plural, zero {لا قراءات} one {قراءة واحدة} two {قراءتان} few {# قراءات} many {# قراءة} other {# قراءة}}"
```

If you are unsure which categories apply to your locale, consult the [CLDR plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules) or run `new Intl.PluralRules('<locale>').resolvedOptions().pluralCategories` in Node.

### RTL locales

For right-to-left languages (Arabic, Hebrew, Persian, Urdu), set `LOCALE_DIRECTIONS.<locale> = 'rtl'`. The web app reads this map to set the `dir` attribute on `<html>`. Verify layouts in both directions before submitting.

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
- [ ] For locale additions: `pnpm --filter web i18n:check` passes with 100% coverage

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

## Dependency Updates

Dependency updates are automated via [Dependabot](.github/dependabot.yml):

- **Schedule** — grouped PRs are opened weekly for npm and cargo dependencies, and monthly for GitHub Actions.
- **Auto-merge** — minor and patch updates for npm and cargo are auto-merged once **all** CI checks pass, via [`.github/workflows/dependabot-auto-merge.yml`](.github/workflows/dependabot-auto-merge.yml).
- **Major version bumps** — ignored by Dependabot and require a human-authored PR with review.
- **Security advisories** — follow the existing severity-based auto-merge rules.

If you need to land a dependency change manually, open a regular PR following the checklist above.

---

## Smart Contract Changes
=======

Contract changes require extra care:

- All public function signatures are part of the on-chain ABI — breaking changes need a `BREAKING CHANGE:` footer
- Update `docs/contracts/<name>.md` for any interface changes
- Run `cargo test` and include test output in the PR description
- Tag breaking changes with the `breaking-change` label

---

## GitHub Actions Pinning Policy

All third-party actions used in `.github/workflows/` **must be pinned to a full 40-character commit SHA** — never a mutable tag or branch (e.g. `@v4`, `@main`). A compromised or re-pointed tag could inject malicious code into CI, so SHAs are the only trusted reference.

### Format

Always add a trailing comment with the human-readable version so updates are reviewable:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4.1.0
```

Rules:

- The SHA must be the **full 40 hex characters** — short SHAs are rejected.
- The `# vX.Y.Z` comment is required and must match the pinned release.
- Local actions (`./.github/actions/...`) and reusable workflows in this repo are exempt.
- Never use `@latest`, `@main`, `@master`, or floating major tags (`@v4`).

### Enforcement

- **`supply-chain.yml`** runs on every PR and push to `develop`/`main`. It scans all workflow files and **fails the build** if any `uses:` entry references an action by tag, branch, or short SHA.
- **Dependabot** (`.github/dependabot.yml`, `github-actions` ecosystem) opens PRs that bump pinned SHAs and update the version comment. Review and merge these like any other dependency update — do not edit the SHA by hand unless Dependabot can't.

### Updating a pinned SHA

1. Find the release tag you want on the action's GitHub releases page.
2. Resolve the tag to its commit SHA:
   ```bash
   git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>
   # or, for annotated tags, dereference with ^{}:
   git ls-remote https://github.com/<owner>/<repo> 'refs/tags/<tag>*'
   ```
3. Replace the `uses:` line with the new SHA and update the `# vX.Y.Z` comment.
4. Run the `supply-chain.yml` check locally (or push and let CI run) to confirm the pin is valid.

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
# Deployment Guide

This guide covers deploying SolarProof smart contracts to Stellar testnet and mainnet, verifying deployed bytecode on the Stellar explorer, and rolling back a bad deployment.

Deployed contract addresses are tracked in [docs/deployments.md](deployments.md).

---

## Prerequisites

- Rust toolchain pinned in `apps/contracts/rust-toolchain.toml`
- `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: `cargo install --locked stellar-cli --features opt`
- A funded Stellar account (see below for testnet faucet)

---

## 1. Build contracts

```bash
cd apps/contracts
stellar contract build
```

Compiled WASM files are written to `target/wasm32-unknown-unknown/release/`.

---

## 2. Deploy to testnet

### 2a. Fund a deployer account

```bash
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet
# Or use the friendbot directly:
# curl "https://friendbot.stellar.org?addr=$(stellar keys address deployer)"
```

### 2b. Deploy each contract

```bash
TOKEN_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/energy_token.wasm \
  --source deployer --network testnet)

REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/audit_registry.wasm \
  --source deployer --network testnet)

GOV_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/community_governance.wasm \
  --source deployer --network testnet)

echo "TOKEN_ID=$TOKEN_ID"
echo "REGISTRY_ID=$REGISTRY_ID"
echo "GOV_ID=$GOV_ID"
```

### 2c. Initialize each contract

```bash
ADMIN=$(stellar keys address deployer)

stellar contract invoke --id $TOKEN_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN --minter $ADMIN

stellar contract invoke --id $REGISTRY_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN

stellar contract invoke --id $GOV_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN --quorum 51 --voting_period_ledgers 17280
```

### 2d. Record the addresses

Update [docs/deployments.md](deployments.md) with the three contract IDs, then set them in your environment:

All contract addresses and network settings are read from environment variables. Copy `.env.example` to `.env.local` and fill in the values from the deploy steps above.

### Testnet

```env
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_ENERGY_TOKEN_ID=<TOKEN_ID>
NEXT_PUBLIC_AUDIT_REGISTRY_ID=<REGISTRY_ID>
NEXT_PUBLIC_COMMUNITY_GOVERNANCE_ID=<GOV_ID>
MINTER_SECRET_KEY=<deployer-secret>
```

---

## 3. Deploy to mainnet

> ⚠️ Mainnet deployments are irreversible. Use a hardware wallet or HSM-backed key for the deployer account.

The steps are identical to testnet — replace `--network testnet` with `--network mainnet` throughout.

```bash
stellar keys generate deployer-mainnet --network mainnet
# Fund from a real XLM source (no friendbot on mainnet)

TOKEN_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/energy_token.wasm \
  --source deployer-mainnet --network mainnet)
# ... repeat for audit_registry and community_governance
```

Update [docs/deployments.md](deployments.md) with the mainnet contract IDs.

---

## 4. Automated deployment (CI)

The `.github/workflows/deploy-contracts.yml` workflow automates testnet deployment on pushes to `main`. It reads the deployer secret from the `DEPLOYER_SECRET` GitHub Actions secret and writes the resulting contract IDs back to the repository.

To trigger manually:

```
GitHub → Actions → Deploy Contracts → Run workflow
```

### 4a. Deployment protection rules (GitHub Environments)

Production deployments are gated behind a GitHub Environment so that no change can reach mainnet without human approval. The workflows use two environments:

| Environment  | Workflow                     | Required reviewers | Behaviour                          |
| ------------ | ---------------------------- | ------------------ | ---------------------------------- |
| `staging`    | `deploy-contracts.yml`       | None               | Auto-deploys on push to `main`     |
| `production` | `deploy-production.yml`      | At least 1         | Waits for approval before deploying |

#### Configuring the environments

A repository admin must configure the environments once:

1. Go to **GitHub → Settings → Environments**.
2. Create the `staging` environment. Leave **Required reviewers** empty — staging deploys automatically.
3. Create the `production` environment.
4. Under **Deployment protection rules**, enable **Required reviewers** and add at least one reviewer (individual or team). Optionally enable **Prevent self-review** so the person who triggered the run cannot approve it.
5. Optionally set a **Wait timer** or restrict **Deployment branches** to `main` for extra safety.
6. Save the protection rules.

Environment-scoped secrets (e.g. `DEPLOYER_SECRET`) can be stored per environment under the same settings page; secrets defined on `production` are only exposed to jobs that reference that environment.

#### Approving a production deployment

When a run of `deploy-production.yml` reaches the deployment job, it pauses and shows **Waiting for approval**:

1. Open **GitHub → Actions → Deploy Production → <run>**.
2. Click **Review deployments**.
3. Select the `production` environment, add an optional comment, and click **Approve and deploy**.
4. The job resumes and deploys to mainnet. Rejecting the deployment cancels the run without touching production.

If no reviewer approves within 30 days, the pending deployment expires automatically.

---

## 4a. Web image publishing (GHCR)

The web app Docker image is built and pushed to the GitHub Container Registry (GHCR) on every merge to `main`, so deployments pull a pre-built image instead of rebuilding from scratch.

### Image names and tags

| Tag | When it is pushed | Example |
| --- | --- | --- |
| `ghcr.io/<owner>/solarproof/web:<sha>` | Every merge to `main` | `ghcr.io/acme/solarproof/web:3f9c1ab` |
| `ghcr.io/<owner>/solarproof/web:latest` | Every merge to `main` | `ghcr.io/acme/solarproof/web:latest` |
| `ghcr.io/<owner>/solarproof/web:<semver>` | On release (git tag `v*.*.*`) | `ghcr.io/acme/solarproof/web:1.4.0` |

`<owner>` is the GitHub organization or user that owns the repository (lowercased). The `<sha>` tag is the short git commit SHA of the merge commit, which lets you pin a deployment to an exact revision.

### Pulling the image

```bash
docker pull ghcr.io/<owner>/solarproof/web:<sha>
docker pull ghcr.io/<owner>/solarproof/web:latest
```

### Image pull secret for Vercel / ECS

GHCR packages are private by default. Configure a pull secret wherever the image is deployed:

- **Vercel** — add the following environment variables to the project (Production and Preview):
  - `DOCKER_REGISTRY_URL=ghcr.io`
  - `DOCKER_REGISTRY_USERNAME=<github-username>`
  - `DOCKER_REGISTRY_PASSWORD=<personal-access-token>` (a classic PAT with `read:packages` scope)
- **AWS ECS** — store the same credentials in AWS Secrets Manager and reference them from the task definition's `repositoryCredentials.credentialsParameter`, or create an ECS pull secret:

```bash
aws secretsmanager create-secret \
  --name solarproof/ghcr-pull-secret \
  --secret-string '{"username":"<github-username>","password":"<personal-access-token>"}'
```

Alternatively, make the package public in the repository's **Packages** settings to skip authentication entirely.

### Image retention policy

Only the last **20** image tags are retained in GHCR. Older tags are pruned automatically by the image publishing workflow; `latest` and any semver tags referenced by an active deployment are always kept. If you need to pin an older revision beyond the retention window, re-run the publish workflow for that commit.

---

## 4b. Canary deployment (blue-green)

The `.github/workflows/blue-green-deploy.yml` workflow deploys the new version alongside the current one and shifts traffic gradually instead of cutting over 100% at once.

### Traffic ramp

| Stage | Traffic to new version | Duration |
| --- | --- | --- |
| Canary | 10% | 5 minutes |
| Promote | 50% | 5 minutes |
| Full | 100% | — |

Total ramp time is approximately 15 minutes.

### Automatic rollback

During each stage the workflow monitors the error rate of the new version. If the error rate exceeds **1%**, the workflow aborts the ramp, shifts 100% of traffic back to the previous version, and marks the deployment as failed.

### Manual override (hotfixes)

For urgent hotfixes you can skip the canary stages and cut over immediately. Trigger the workflow manually with the `skip_canary` input set to `true`:

```
GitHub → Actions → Blue-Green Deploy → Run workflow → skip_canary: true
```

When `skip_canary` is enabled, traffic moves to 100% immediately and the error-rate monitor is bypassed. Use this only for hotfixes that cannot wait for the full ramp.

### Sentry release tracking

Each deployment creates a Sentry release and sends a deployment event, so errors can be attributed to the exact version that was rolled out. The release name matches the image tag (`<sha>` or `<semver>`). Ensure `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` / `SENTRY_PROJECT` are configured as GitHub Actions secrets.

---

## 5. Verify deployed bytecode on Stellar Expert

After deployment, confirm the on-chain WASM matches your local build:

1. Open `https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>`
2. Click the **Contract** tab → **WASM** section.
3. Copy the **WASM hash** shown on the page.
4. Compute the hash of your local build:

```bash
sha256sum target/wasm32-unknown-unknown/release/energy_token.wasm
```

5. The two hashes must match. A mismatch means the on-chain contract was deployed from a different build.

---

## 7. Rollback procedure

Soroban contracts are immutable once deployed — you cannot overwrite a contract ID. The rollback procedure is:

1. **Deploy a new contract** from the corrected WASM (produces a new contract ID).
2. **Update environment variables** (`NEXT_PUBLIC_ENERGY_TOKEN_ID`, etc.) to point to the new contract ID.
3. **Redeploy the web app** (Vercel picks up the new env vars automatically on the next deployment).
4. **Update [docs/deployments.md](deployments.md)** with the new contract ID and a note explaining the rollback.
5. **Do not delete the old contract** — it remains on-chain as an audit record.

For the `audit_registry` contract specifically, all historical anchors remain valid on the old contract ID. The new deployment starts a fresh registry; existing certificates still resolve against the old contract via the `anchor_explorer` links stored in the database.

---

## 8. Register a meter after deployment

```bash
node scripts/gen-meter-key.mjs
# Insert the meter into Supabase:
# INSERT INTO meters (id, pubkey_hex, name, cooperative_id, active)
# VALUES (gen_random_uuid(), '<public_key_hex>', 'meter-name', '<coop-id>', true);
```

See [ONBOARDING.md](ONBOARDING.md) for the full end-to-end local setup.

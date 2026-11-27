# Runbook: Stellar RPC Outage

Covers detecting and recovering from downtime on the Stellar testnet or mainnet
RPC endpoint. The status page reports each RPC endpoint separately from the web
app — an alert on "Stellar Testnet RPC" or "Stellar Mainnet RPC" in the upptime
status page triggers this runbook.

---

## Alert conditions

Upptime fires an incident after **2 consecutive** failed health checks against
the RPC endpoint. Each check calls `getHealth` via JSON-RPC and expects the
response body to contain `"status":"healthy"`. A single failure does not page;
two in a row do.

---

## Severity

| Scenario | Severity |
|---|---|
| Testnet RPC down | P3 — development and staging affected; production unaffected |
| Mainnet RPC down | P2 — anchor and mint jobs fail silently; new readings queue up |

---

## Step 1 — Confirm the outage

```bash
# Testnet
curl -s -X POST https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .

# Mainnet (replace key placeholder)
curl -s -X POST https://mainnet.stellar.validationcloud.io/v1/$STELLAR_MAINNET_RPC_KEY \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
```

Expected healthy response:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "status": "healthy" } }
```

Also check the official Stellar network status page:
https://status.stellar.org

---

## Step 2 — Assess impact

While the RPC is down, `POST /api/readings` calls that try to anchor or mint
will fail at the Stellar transaction step (the API returns `500`). Readings
that passed signature verification are stored in the database in a `pending`
state; they are **not lost**.

Check how many readings are stuck:

```sql
SELECT status, count(*) FROM readings
WHERE created_at > now() - interval '2 hours'
GROUP BY status;
```

If `mint_jobs` is used as the queue table:

```sql
SELECT status, count(*) FROM mint_jobs
WHERE created_at > now() - interval '2 hours'
GROUP BY status;
```

---

## Step 3 — Pause new anchor jobs (optional, mainnet only)

If the outage is prolonged and the failed-job queue is growing, pause the mint
job processor to avoid log noise and unnecessary retries:

```bash
# Set an environment variable or feature flag recognised by the job runner
# (adjust to the actual mechanism used by the deployment)
vercel env add MINT_JOB_PAUSED true --environment production
vercel redeploy --prod
```

---

## Step 4 — Switch to a fallback RPC provider

If the primary RPC is confirmed down and no ETA is available, update the
`NEXT_PUBLIC_STELLAR_RPC_URL` / `STELLAR_RPC_URL` environment variables to a
secondary provider.

Known alternatives:

| Provider | Testnet | Mainnet |
|---|---|---|
| Stellar Foundation (public) | `https://soroban-testnet.stellar.org` | `https://soroban-rpc.mainnet.stellar.gateway.fm` |
| Validation Cloud | — | `https://mainnet.stellar.validationcloud.io/v1/<key>` |
| Ankr | — | `https://rpc.ankr.com/stellar_soroban` |

```bash
# Update in Vercel and redeploy
vercel env rm STELLAR_RPC_URL production
vercel env add STELLAR_RPC_URL https://<fallback-url> --environment production
vercel redeploy --prod
```

---

## Step 5 — Replay pending readings after recovery

Once the RPC endpoint is healthy again, trigger a replay of stuck readings:

```bash
# Identify failed mint jobs
SELECT id FROM mint_jobs WHERE status = 'failed'
  AND created_at > now() - interval '24 hours';

# Reset them to 'pending' so the job runner retries
UPDATE mint_jobs SET status = 'pending', retries = 0
  WHERE status = 'failed'
  AND created_at > now() - interval '24 hours';
```

Then un-pause the job runner if it was paused in Step 3:

```bash
vercel env rm MINT_JOB_PAUSED production
vercel redeploy --prod
```

Confirm readings are progressing:

```sql
SELECT status, count(*) FROM mint_jobs
WHERE updated_at > now() - interval '15 minutes'
GROUP BY status;
```

---

## Step 6 — Post-incident

1. Confirm the upptime incident closes automatically (Upptime detects recovery
   and closes the GitHub issue on the status repo).
2. If the outage exceeded 10 minutes on mainnet, file a postmortem using
   [post-mortem-template.md](post-mortem-template.md).
3. If the outage revealed a gap in retry logic or alerting, open a follow-up
   GitHub issue with the `devops` label.

---

## Related runbooks

- [incident-response.md](incident-response.md) — general incident procedure
- [failed-mint-investigation.md](failed-mint-investigation.md) — diagnosing
  individual failed mints after the RPC recovers

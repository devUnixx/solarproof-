# ADR-010 — Redis Dual-Instance Design (Cache vs Queue)

**Status:** Accepted
**Date:** 2026-10-20
**Issue:** [#731](https://github.com/katecatherinaa/solarproof/issues/731)
**Supersedes:** Extends [ADR-009](./009-redis-caching.md) (Redis Caching Strategy), which documented the decision to use Redis but assumed a single instance. This ADR documents the subsequent decision to split into two instances.

---

## Context

[ADR-009](./009-redis-caching.md) established Redis as the caching layer for session tokens, rate-limit counters, idempotency keys, and operator suspension state. All four patterns use `ioredis` with TTL-based expiry.

As the queue-based anchor-and-mint pipeline was added (BullMQ, `lib/queue.ts`), a conflict emerged between the two workloads:

**Cache workload** (session, rate-limit, idempotency, suspension):
- Keys are short-lived (1 minute to 24 hours).
- If Redis runs out of memory, dropping the least-recently-used key is acceptable — a cache miss falls back to Supabase Auth or a fresh database read.
- The correct eviction policy is `allkeys-lru`: Redis evicts the least-recently-used key when memory is full.

**Queue workload** (BullMQ job state: pending, running, failed, delayed):
- Job records must survive until they are explicitly consumed or confirmed failed.
- BullMQ relies on Redis `RPOPLPUSH` and `ZADD` primitives. If Redis evicts a job key because memory is full, the job is silently lost. There is no fallback.
- The correct eviction policy is `noeviction`: Redis rejects new writes rather than evict existing keys, making the problem visible rather than silent.

These two policies are mutually exclusive on a single Redis instance. Applying `allkeys-lru` risks silent job loss. Applying `noeviction` risks cache misses turning into write failures under memory pressure.

### Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| **Single instance with `allkeys-lru`** | Simpler infra | BullMQ jobs silently evicted under memory pressure; jobs lost with no error |
| **Single instance with `noeviction`** | Jobs never evicted | Cache write failures under memory pressure; session creation returns an error instead of a graceful fallback |
| **Single instance with `volatile-lru`** (evict only keys with a TTL set) | Partial solution | BullMQ sets TTLs on some internal keys; eviction behaviour is unpredictable; still risks partial job loss |
| **Two Redis instances — `allkeys-lru` for cache, `noeviction` for queue** | Each instance uses the correct policy for its workload | Two Redis processes in Docker Compose; two `REDIS_URL` environment variables in production |
| **Upstash (HTTP-based serverless Redis)** | No infra ops; two logical databases available | HTTP overhead incompatible with BullMQ's connection requirements; vendor lock-in |

The two-instance design was chosen because the policies are genuinely incompatible and the operational cost of a second Redis container is low.

---

## Decision

Run two Redis instances with separate eviction policies and connection URLs:

| Instance | Docker service | Port | Eviction policy | Used by |
|---|---|---|---|---|
| **Cache** | `redis-cache` | `6379` | `allkeys-lru` | `lib/redis.ts` → session, rate-limit, idempotency, suspension |
| **Queue** | `redis-queue` | `6380` | `noeviction` | `lib/queue.ts` → BullMQ job queues |

Both instances are configured in `docker-compose.yml`:

```yaml
redis-cache:
  image: redis:7-alpine
  command: redis-server --maxmemory 512mb --maxmemory-policy allkeys-lru
  ports:
    - "6379:6379"

redis-queue:
  image: redis:7-alpine
  command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy noeviction
  ports:
    - "6380:6379"
```

The queue instance also enables `--appendonly yes` (AOF persistence) so job state survives a container restart. The cache instance does not need persistence — all cached data can be reconstructed from the source of truth (Supabase).

### Environment variables

```
REDIS_URL=redis://localhost:6379       # cache instance
REDIS_QUEUE_URL=redis://localhost:6380 # queue instance
```

`lib/redis.ts` reads `REDIS_URL` for cache operations.
`lib/queue.ts` reads `REDIS_QUEUE_URL` for BullMQ connections.

### Decision criteria for new features

**Use the cache instance (`REDIS_URL`, `lib/redis.ts`) when:**
- The data can be reconstructed from Supabase or another source of truth if the key is missing.
- A cache miss causes a performance cost (extra database round-trip) but not a correctness failure.
- The data has a natural TTL (session tokens, rate-limit windows, idempotency locks).

**Use the queue instance (`REDIS_QUEUE_URL`, `lib/queue.ts`) when:**
- The data must not be silently lost if Redis runs low on memory.
- The operation is a background job, a scheduled task, or any work that must complete exactly once.
- You are using BullMQ or any queue primitive (`RPOPLPUSH`, `ZADD`, `BRPOP`).

If you are unsure, use the queue instance. Silent data loss is harder to debug than a write rejection.

---

## Consequences

**Easier:**
- Each instance uses the eviction policy that matches its workload. BullMQ job loss under memory pressure is eliminated. Cache-write failures under memory pressure are eliminated.
- AOF persistence on the queue instance means jobs survive a Redis container restart without re-submission.
- Memory pressure on one workload does not affect the other.

**Harder:**
- Production environments must provision and monitor two Redis instances instead of one. Both `REDIS_URL` and `REDIS_QUEUE_URL` must be set in deployment configuration.
- Developers running the stack locally must start both Docker services (`redis-cache` and `redis-queue` are both listed in `depends_on` for the `web` service in `docker-compose.yml`).
- Any new caching use case must be explicitly assigned to the correct instance. The rule above (reconstruct-able → cache; must-not-lose → queue) should be applied and documented in a comment at the call site.

---

## References

- [ADR-009 — Redis Caching Strategy](./009-redis-caching.md)
- [BullMQ documentation — Redis configuration](https://docs.bullmq.io/guide/connections)
- [`docker-compose.yml`](../../docker-compose.yml) — `redis-cache` and `redis-queue` service definitions
- [`lib/redis.ts`](../../apps/web/src/lib/redis.ts) — cache instance connection
- [`lib/queue.ts`](../../apps/web/src/lib/queue.ts) — queue instance connection via BullMQ

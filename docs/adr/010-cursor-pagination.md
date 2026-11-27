# ADR-010: Cursor-Based Pagination over Offset Pagination

**Status:** Accepted  
**Date:** 2026-10-27  
**Approvers:** @katecatherinaa, @emmanueltony792-blip  
**Issue:** #722

---

## Context

Several SolarProof list endpoints (`GET /api/readings`, `GET /api/certificates`,
`GET /api/v1/certificates`) previously used offset-based pagination
(`?page=N&limit=N`). As the dataset grew, three problems emerged:

1. **Consistency drift** — if a row is inserted between page 1 and page 2
   requests, offset pagination either skips a row or returns a duplicate.
   For an append-heavy time-series dataset like meter readings, this happens
   routinely.

2. **Performance** — `OFFSET N` forces Postgres to scan and discard the first
   N rows on every request. At the scale SolarProof targets (millions of
   readings per cooperative per year), `OFFSET 100000` causes full sequential
   scans even with indexes.

3. **API contract fragility** — clients that bookmark a page number receive
   different data if rows are inserted or deleted since the last request,
   making reliable export and reconciliation impossible.

The data model is well-suited to cursor pagination: readings and certificates
are both append-only, ordered by a monotonically increasing timestamp
(`created_at` / `issued_at`). A cursor that encodes the timestamp of the last
seen row is stable, cheap to evaluate (a range scan on an indexed column), and
produces consistent pages regardless of concurrent writes.

---

## Decision

All new SolarProof list endpoints use **cursor-based pagination**. The cursor
is an opaque base64-encoded string encoding the `issued_at` (or `created_at`)
timestamp of the last row on the current page.

**Request parameters:**

| Parameter | Type | Description |
|---|---|---|
| `cursor` | string (optional) | Opaque cursor from `next_cursor` in a previous response. Omit for the first page. |
| `limit` | integer (optional) | Page size, 1–100, default 20. |

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `data` | array | The rows for this page. |
| `next_cursor` | string \| null | Pass as `cursor` in the next request. `null` when no more pages exist. |
| `has_more` | boolean | Whether additional pages exist. |

The deprecated `page` offset parameter is retained on existing endpoints for
backward compatibility but is documented as deprecated in `openapi.yaml` and
will be removed in API v2.

**Server-side implementation pattern:**

```sql
-- Readings after a given cursor (decoded to a timestamp)
SELECT *
FROM readings
WHERE created_at < :cursor_ts   -- or > for ascending
ORDER BY created_at DESC
LIMIT :limit + 1;               -- fetch one extra to detect has_more
```

The extra row is used to determine `has_more`; it is not returned to the
client. If `limit + 1` rows are returned, `has_more = true` and `next_cursor`
encodes `created_at` of the last included row.

**Affected endpoints (see `openapi.yaml` for full schemas):**

- `GET /api/readings` — cursor on `created_at`
- `GET /api/certificates` — cursor on `issued_at`
- `GET /api/v1/certificates` — cursor on `issued_at`
- `GET /api/governance/proposals` — cursor on `created_at`

---

## Trade-offs considered

| Dimension | Offset pagination | Cursor pagination |
|---|---|---|
| Consistency under concurrent writes | ❌ skips / duplicates rows | ✅ stable, based on indexed value |
| Query performance at high offsets | ❌ O(offset) scan | ✅ O(log n) index range scan |
| Arbitrary page jump (e.g. page 50) | ✅ trivial | ❌ not supported |
| Bookmark-able URL | ✅ `?page=3` is human-readable | ⚠️ cursor is opaque |
| Implementation complexity | ✅ simple | ⚠️ slightly more complex |
| Total count (`total` field) | ✅ easy with `COUNT(*)` | ⚠️ expensive; returned as estimate or omitted |

For SolarProof's use cases (dashboard feed, export, audit), sequential page
traversal is the dominant access pattern. Arbitrary page jumps are not
required. The performance and consistency advantages of cursor pagination
outweigh the loss of human-readable page numbers.

The `total` count field is retained on the `GET /api/certificates` response
for display purposes (e.g. "showing 20 of 1 450 certificates"), computed with
a separate `COUNT(*)` query. This is acceptable because the certificates table
is smaller and less write-heavy than readings.

---

## Consequences

- New list endpoints must implement the cursor pattern described above.
- The `page` parameter is deprecated and must not be used in new client code;
  existing clients should migrate to `cursor` before API v2.
- Client code that relied on stable page numbers for bookmarking must be
  updated to store `next_cursor` instead.
- The `openapi.yaml` documents the cursor fields on all affected operations;
  the `page` parameter is marked `deprecated: true`.
- Future list endpoints added to the API must use cursor pagination unless
  there is a documented reason in a follow-up ADR.

---

## References

- `openapi.yaml` — `GET /api/readings`, `GET /api/certificates` operations
- [ADR-002](002-stellar-soroban.md) — Stellar/Soroban over EVM (context for
  append-only data model)
- Postgres documentation — [LIMIT / OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)
- "Pagination with Relative Cursors" — Markus Winand, Use The Index, Luke:
  https://use-the-index-luke.com/sql/partial-results/fetch-next-page

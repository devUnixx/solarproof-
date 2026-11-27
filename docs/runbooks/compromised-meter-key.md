# Runbook: Compromised Meter Private Key

A meter's Ed25519 private key is considered compromised when it has been exposed, lost, or is suspected of being in the hands of an unauthorized party. This runbook covers the full response from detection through post-incident review.

For scheduled rotation without a suspected compromise, see [meter-key-rotation.md](./meter-key-rotation.md).

---

## 1. Detect

Signs that a meter key may be compromised:

- A reading arrives with a valid signature but an unexpected `kwh` value, timestamp, or `meter_id`.
- Readings are submitted from an unexpected IP or at an unexpected rate (see `audit_logs` table).
- The device reports key-material loss (stolen, firmware bug, storage fault).
- A member of your team or a third party reports access to the device or its key file.

If any of these apply, treat the key as compromised and proceed immediately to revocation.

---

## 2. Revoke via API

Revoke the meter record using the authenticated operator endpoint. This sets `active = false` and records `revoked_at` and `revocation_reason` in the `meters` table. The API will reject all future readings from this meter.

```bash
curl -X POST https://<your-api-host>/api/meters/<meter-id>/revoke \
  -H "Authorization: Bearer <operator-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "private key suspected compromised — detected <date>"}'
```

Expected response:

```json
{ "id": "<meter-id>", "active": false, "revoked_at": "<iso-timestamp>", "revocation_reason": "private key suspected compromised — detected <date>" }
```

A `200` response means the meter is revoked. Any reading submitted by the compromised key after this point will be rejected with `404 Meter not found or inactive`.

> If you do not have a valid operator JWT, contact a cooperative admin who does. Do not delay revocation while obtaining credentials — the compromised key remains active until this step completes.

---

## 3. Notify the Cooperative Admin

After revoking, notify the cooperative admin immediately so they can:

- Confirm the revocation took effect (check the meter record in the Supabase dashboard: `active = false`, `revoked_at` populated).
- Decide whether any readings submitted in the window between suspected compromise and revocation need to be investigated or invalidated.
- Approve issuing a replacement meter record (see step 5).

Notification channels in order of priority:

1. Direct message to the cooperative admin via your internal communications tool.
2. Email to the address on file for the cooperative (`admin_address` in the `cooperatives` table).
3. If neither is reachable within 1 hour, escalate to the on-call engineer via `@solarproof/oncall` on GitHub.

---

## 4. Review the Audit Log

Query `audit_logs` for all activity associated with the compromised meter since the last known-good reading. Look for unexpected anchor calls, duplicate readings, or any action taken with the meter's identity.

```sql
-- Supabase SQL editor or psql
SELECT *
FROM audit_logs
WHERE resource_id = '<meter-id>'
  AND timestamp >= '<last-known-good-timestamp>'
ORDER BY timestamp ASC;
```

Also check `readings` for any records tied to this meter in the same window:

```sql
SELECT id, kwh, timestamp, reading_hash, anchored, minted
FROM readings
WHERE meter_id = '<meter-id>'
  AND timestamp >= '<last-known-good-timestamp>'
ORDER BY timestamp ASC;
```

Flag any readings that look anomalous (unexpected `kwh`, duplicate `reading_hash`, or readings minted to certificates you did not authorise). If you find any, mark the corresponding `certificates` rows as suspect for manual review:

```sql
UPDATE certificates
SET retired = true,
    retired_by = 'security-review',
    retired_at = now()
WHERE reading_id IN (<list-of-suspect-reading-ids>);
```

Document your findings — which readings are confirmed legitimate, which are suspect, and which were anchored on-chain. This record is required for the post-incident review.

---

## 5. Issue a Replacement Meter

Once the old key is revoked and the audit window is clear, generate a replacement:

```bash
node scripts/gen-meter-key.mjs
# Outputs meter-key-new.json: { private_key_hex, public_key_hex }
```

For production devices, generate the keypair on the device itself. Never generate a production private key on a workstation.

Register the new public key in the `meters` table with a new UUID:

```sql
INSERT INTO meters (id, cooperative_id, serial_number, pubkey_hex, active)
VALUES (gen_random_uuid(), '<cooperative-uuid>', '<serial-number>', '<new-64-char-hex-pubkey>', true);
```

Note the new `meter_id`. Deploy the new private key and new UUID to the device, then send a test reading to confirm it works:

```bash
node scripts/send-reading.mjs \
  --meter-id <new-meter-uuid> \
  --kwh 0.001 \
  --key ./meter-key-new.json \
  --api https://<your-api-host>
```

Expect a `201 Created` response. Only proceed once the test reading succeeds.

---

## 6. Post-Incident Review

Complete within 5 business days of revocation:

- [ ] Root cause documented (how was the key exposed?)
- [ ] Suspect readings identified, flagged, and reviewed by cooperative admin
- [ ] Replacement meter deployed and confirmed working
- [ ] `audit_logs` reviewed for the full incident window
- [ ] Any on-chain anomalies noted (unexpected anchors or mints during compromise window)
- [ ] Controls improved to reduce the same exposure (e.g. HSM for key storage, rate limiting alerts)
- [ ] Incident summary filed in `docs/runbooks/post-mortems/`

---

## Related Documents

- [meter-key-rotation.md](./meter-key-rotation.md) — scheduled key rotation without a compromise
- [minter-key-rotation.md](./minter-key-rotation.md) — rotating the API minter key
- [incident-response.md](./incident-response.md) — general incident response process
- [docs/SECURITY_INCIDENT_PLAYBOOK.md](../SECURITY_INCIDENT_PLAYBOOK.md) — contract and minter key compromise playbook

import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E: Complete reading-to-certificate happy path.
 *
 * Covers, in sequence:
 *   1. Login (seeded cooperative user)
 *   2. Register a seeded meter for the seeded cooperative
 *   3. Submit a signed reading
 *   4. Poll the job endpoint until complete
 *   5. Navigate to /verify and assert the certificate ID is visible
 *
 * Stellar RPC and Supabase REST calls are mocked via page.route so the test
 * runs hermetically against the local dev server.
 */

const SEEDED_COOPERATIVE = {
  id: 'coop-seeded-0001',
  name: 'Seeded Solar Cooperative',
  slug: 'seeded-solar-coop',
};

const SEEDED_USER = {
  id: 'user-seeded-0001',
  email: 'operator@seeded-solar-coop.test',
  password: 'seeded-password-123',
  cooperativeId: SEEDED_COOPERATIVE.id,
};

const SEEDED_METER = {
  id: 'meter-seeded-0001',
  serialNumber: 'SEED-MTR-0001',
  cooperativeId: SEEDED_COOPERATIVE.id,
  devicePublicKey: 'GSEEDEDMETERPUBLICKEY0000000000000000000000000000000000',
};

const SEEDED_READING = {
  id: 'reading-seeded-0001',
  meterId: SEEDED_METER.id,
  energyKwh: 42.5,
  timestamp: '2024-01-15T12:00:00.000Z',
  signature: 'seeded-signature-base64==',
};

const SEEDED_JOB_ID = 'job-seeded-0001';
const SEEDED_CERTIFICATE_ID = 'CERT-SEEDED-0001';

const SUPABASE_URL_PATTERN = /https?:\/\/[^/]*supabase[^/]*\/.*/i;
const SUPABASE_REST_PATTERN = /\/rest\/v1\//i;
const STELLAR_RPC_PATTERN = /\/rpc\/?$|\/soroban\/?$|horizon|stellar/i;

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill(jsonResponse(body, status));
}

/**
 * Installs route mocks for Supabase REST and Stellar RPC.
 * Must be called before any navigation so the app's initial requests are
 * intercepted.
 */
async function installMocks(page: Page) {
  // ---- Supabase REST mocks -------------------------------------------------
  await page.route(SUPABASE_REST_PATTERN, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // Auth: token / session exchange
    if (path.includes('/auth/v1/token') || path.includes('/auth/v1/signup')) {
      return fulfillJson(route, {
        access_token: 'seeded-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'seeded-refresh-token',
        user: {
          id: SEEDED_USER.id,
          email: SEEDED_USER.email,
          user_metadata: { cooperative_id: SEEDED_COOPERATIVE.id },
        },
      });
    }

    // Auth: current user
    if (path.includes('/auth/v1/user')) {
      return fulfillJson(route, {
        id: SEEDED_USER.id,
        email: SEEDED_USER.email,
        user_metadata: { cooperative_id: SEEDED_COOPERATIVE.id },
      });
    }

    // Cooperatives table
    if (path.includes('/cooperatives')) {
      return fulfillJson(route, [SEEDED_COOPERATIVE]);
    }

    // Meters table
    if (path.includes('/meters')) {
      if (method === 'POST') {
        return fulfillJson(route, [SEEDED_METER], 201);
      }
      return fulfillJson(route, [SEEDED_METER]);
    }

    // Readings table
    if (path.includes('/readings')) {
      if (method === 'POST') {
        return fulfillJson(route, [SEEDED_READING], 201);
      }
      return fulfillJson(route, [SEEDED_READING]);
    }

    // Jobs table
    if (path.includes('/jobs')) {
      return fulfillJson(route, [
        {
          id: SEEDED_JOB_ID,
          status: 'completed',
          certificate_id: SEEDED_CERTIFICATE_ID,
        },
      ]);
    }

    // Certificates table
    if (path.includes('/certificates')) {
      return fulfillJson(route, [
        {
          id: SEEDED_CERTIFICATE_ID,
          certificate_id: SEEDED_CERTIFICATE_ID,
          reading_id: SEEDED_READING.id,
          meter_id: SEEDED_METER.id,
          cooperative_id: SEEDED_COOPERATIVE.id,
          energy_kwh: SEEDED_READING.energyKwh,
          issued_at: '2024-01-15T12:05:00.000Z',
        },
      ]);
    }

    // Default: empty list
    return fulfillJson(route, []);
  });

  // ---- Stellar RPC mocks ---------------------------------------------------
  await page.route(STELLAR_RPC_PATTERN, async (route) => {
    const request = route.request();
    let payload: any = null;
    try {
      payload = request.postDataJSON();
    } catch {
      payload = null;
    }

    const method = payload?.method ?? '';

    if (method === 'getLatestLedger') {
      return fulfillJson(route, {
        jsonrpc: '2.0',
        id: payload?.id ?? 1,
        result: { sequence: 123456, id: 'seeded-ledger', protocolVersion: 21 },
      });
    }

    if (method === 'getTransaction' || method === 'sendTransaction') {
      return fulfillJson(route, {
        jsonrpc: '2.0',
        id: payload?.id ?? 1,
        result: {
          status: 'SUCCESS',
          hash: 'seeded-tx-hash',
          ledger: 123456,
          returnValue: SEEDED_CERTIFICATE_ID,
        },
      });
    }

    if (method === 'simulateTransaction') {
      return fulfillJson(route, {
        jsonrpc: '2.0',
        id: payload?.id ?? 1,
        result: {
          transactionData: 'seeded-transaction-data',
          minResourceFee: '100',
          results: [{ auth: [], xdr: 'seeded-xdr' }],
        },
      });
    }

    // Generic success for any other RPC method
    return fulfillJson(route, {
      jsonrpc: '2.0',
      id: payload?.id ?? 1,
      result: { status: 'SUCCESS' },
    });
  });

  // ---- Job polling endpoint ------------------------------------------------
  await page.route(/\/api\/jobs\/[^/]+/i, async (route) => {
    return fulfillJson(route, {
      id: SEEDED_JOB_ID,
      status: 'completed',
      certificateId: SEEDED_CERTIFICATE_ID,
      progress: 100,
    });
  });

  // ---- Certificate verification endpoint -----------------------------------
  await page.route(/\/api\/verify(\/|\?|$)/i, async (route) => {
    return fulfillJson(route, {
      valid: true,
      certificateId: SEEDED_CERTIFICATE_ID,
      certificate: {
        id: SEEDED_CERTIFICATE_ID,
        certificate_id: SEEDED_CERTIFICATE_ID,
        reading_id: SEEDED_READING.id,
        meter_id: SEEDED_METER.id,
        cooperative_id: SEEDED_COOPERATIVE.id,
        energy_kwh: SEEDED_READING.energyKwh,
        issued_at: '2024-01-15T12:05:00.000Z',
      },
    });
  });
}

test.describe('Reading to certificate happy path', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page);
  });

  test('login → register meter → submit reading → poll job → verify certificate', async ({
    page,
  }) => {
    // ---------------------------------------------------------------------
    // Step 1: Login
    // ---------------------------------------------------------------------
    await page.goto('/login');

    await page.getByLabel(/email/i).fill(SEEDED_USER.email);
    await page.getByLabel(/password/i).fill(SEEDED_USER.password);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();

    // Land on an authenticated page (dashboard or cooperative home).
    await expect(page).toHaveURL(/\/(dashboard|cooperatives|home|app)/i, {
      timeout: 15_000,
    });

    // ---------------------------------------------------------------------
    // Step 2: Register the seeded meter for the seeded cooperative
    // ---------------------------------------------------------------------
    await page.goto(`/cooperatives/${SEEDED_COOPERATIVE.id}/meters/new`);

    await page.getByLabel(/serial number/i).fill(SEEDED_METER.serialNumber);
    await page
      .getByLabel(/device public key|public key/i)
      .fill(SEEDED_METER.devicePublicKey);

    await page.getByRole('button', { name: /register meter|add meter|save/i }).click();

    // The newly registered meter should be visible in the list.
    await expect(page.getByText(SEEDED_METER.serialNumber)).toBeVisible({
      timeout: 15_000,
    });

    // ---------------------------------------------------------------------
    // Step 3: Submit a signed reading
    // ---------------------------------------------------------------------
    await page.goto(`/meters/${SEEDED_METER.id}/readings/new`);

    await page
      .getByLabel(/energy|kwh/i)
      .fill(String(SEEDED_READING.energyKwh));
    await page.getByLabel(/timestamp|reading time/i).fill(SEEDED_READING.timestamp);
    await page.getByLabel(/signature/i).fill(SEEDED_READING.signature);

    await page.getByRole('button', { name: /submit reading|submit/i }).click();

    // ---------------------------------------------------------------------
    // Step 4: Poll the job endpoint until complete
    // ---------------------------------------------------------------------
    // The app should navigate to a job status page after submission.
    await expect(page).toHaveURL(new RegExp(`/jobs/${SEEDED_JOB_ID}|/jobs/`), {
      timeout: 15_000,
    });

    // Poll the job endpoint directly to confirm completion (mirrors the UI's
    // polling behavior and asserts the mocked contract).
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/jobs/${SEEDED_JOB_ID}`);
          if (!response.ok()) {
            return null;
          }
          const body = await response.json();
          return body?.status ?? null;
        },
        { timeout: 15_000, intervals: [500, 1000, 2000] },
      )
      .toBe('completed');

    // The UI should reflect the completed job and surface the certificate ID.
    await expect(page.getByText(SEEDED_CERTIFICATE_ID)).toBeVisible({
      timeout: 15_000,
    });

    // ---------------------------------------------------------------------
    // Step 5: Navigate to /verify and assert the certificate ID is visible
    // ---------------------------------------------------------------------
    await page.goto(`/verify?id=${encodeURIComponent(SEEDED_CERTIFICATE_ID)}`);

    await expect(page.getByText(SEEDED_CERTIFICATE_ID)).toBeVisible({
      timeout: 15_000,
    });

    // Sanity check: the verify page reports the certificate as valid.
    await expect(page.getByText(/valid|verified/i).first()).toBeVisible();
  });
});
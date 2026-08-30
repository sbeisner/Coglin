import path from 'node:path';
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: the Cloudflare *Vite* plugin cannot
// run under vitest's own dev server. Tests instead run inside a real workerd
// runtime, which is what makes the tenancy-isolation tests in Phase 1
// meaningful — they exercise the actual D1 binding, not a mock.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, 'migrations'),
      );

      return {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            // Test-only binding; the setup file replays these into each test
            // file's isolated database so tests run against the real schema.
            TEST_MIGRATIONS: migrations,
            // Auth secrets are per-environment secrets in real deployments;
            // tests need fixed values to sign up against.
            SESSION_PEPPER: 'test-pepper',
            APP_BASE_URL: 'http://coglin.test',
            // Must be set, or sendInvite short-circuits before the fetch the
            // invite tests are asserting on. The value is never used: the
            // tests intercept every api.resend.com request.
            RESEND_API_KEY: 'test-resend-key',
            // Billing (COG-047). Both must be set or the routes short-circuit
            // to 503 before reaching the logic under test. Every api.stripe.com
            // request is intercepted by stubStripe(); the webhook secret is a
            // real HMAC key that the tests sign fixtures with.
            STRIPE_SECRET_KEY: 'sk_test_coglin',
            STRIPE_WEBHOOK_SECRET: 'whsec_test_coglin',
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ['./worker/test-setup.ts'],
  },
});

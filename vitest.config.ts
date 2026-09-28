import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: {
      TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
      ISSUER_NAME: 'TEST ONLY', ISSUER_ADDRESS: 'TEST ONLY', ISSUER_CONTACT: 'test@example.invalid',
      ISSUER_TAX_DETAILS: 'TEST ONLY', PAYMENT_INSTRUCTIONS: 'TEST ONLY',
    } },
  }))],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
})

/**
 * Stand-in for the `cloudflare:workers` built-in module, which only exists
 * inside the Workers runtime. Aliased in vitest.config.ts.
 *
 * Every lib reads `env.X` lazily inside a function, so the object can be
 * populated by test/setup.ts after the modules are imported.
 */
export const env: Record<string, unknown> = {
  SESSION_SECRET: 'test-secret-for-hmac-signing-only',
  ADMIN_SETUP_KEY: 'test-admin-setup-key',
};

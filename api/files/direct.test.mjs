import { expect, test } from 'vitest';
import { APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS } from './direct.mjs';

test('uses Appwrite custom-token expiry as seconds within the supported range', () => {
  expect(APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS).toBe(3600);
  expect(APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS).toBeGreaterThanOrEqual(60);
  expect(APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS).toBeLessThanOrEqual(31_536_000);
});

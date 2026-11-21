import { expect, test } from 'vitest';
import { APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS, appwriteOriginalSize, normalizeMimeType } from './direct.mjs';

test('uses Appwrite custom-token expiry as seconds within the supported range', () => {
  expect(APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS).toBe(3600);
  expect(APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS).toBeGreaterThanOrEqual(60);
  expect(APPWRITE_CUSTOM_TOKEN_EXPIRY_SECONDS).toBeLessThanOrEqual(31_536_000);
});

test('reads Appwrite Storage File sizeOriginal and rejects invalid sizes', () => {
  expect(appwriteOriginalSize({ sizeOriginal: 8157 })).toBe(8157);
  expect(Number.isNaN(appwriteOriginalSize({ $sizeOriginal: 8157 }))).toBe(true);
  expect(Number.isNaN(appwriteOriginalSize({ sizeOriginal: 'not-a-number' }))).toBe(true);
});

test('normalizes MIME case and ZIP aliases before metadata comparison', () => {
  expect(normalizeMimeType('Application/X-Zip-Compressed; charset=binary')).toBe('application/zip');
  expect(normalizeMimeType('APPLICATION/PDF; charset=utf-8')).toBe('application/pdf');
  expect(normalizeMimeType('image/jpg')).toBe('image/jpeg');
  expect(normalizeMimeType('application/x-pdf')).toBe('application/pdf');
  expect(normalizeMimeType(undefined)).toBe('');
});

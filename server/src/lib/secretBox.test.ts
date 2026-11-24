import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { open, seal } from './secretBox';

test('加密后能解回原文，且每次密文不同', () => {
  const key = randomBytes(32);
  const a = seal('sk-test-1234567890', key);
  const b = seal('sk-test-1234567890', key);
  assert.notEqual(a, b);
  assert.ok(!a.includes('sk-test'));
  assert.equal(open(a, key), 'sk-test-1234567890');
});

test('密钥不对或密文被改动都解不开', () => {
  const key = randomBytes(32);
  const sealed = seal('sk-abc', key);
  assert.throws(() => open(sealed, randomBytes(32)));
  const raw = Buffer.from(sealed, 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => open(raw.toString('base64'), key));
});

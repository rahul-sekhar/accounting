import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountInputError, parseAccountInput } from '../lib/accounts.ts';

test('account input accepts arbitrary Unicode institutions and trims labels', () => {
  assert.deepEqual(
    parseAccountInput({
      bank: '  任意信用組合  ',
      name: '  Everyday 💳  ',
      type: 'Credit card',
      currency: 'CAD',
    }),
    {
      bank: '任意信用組合',
      name: 'Everyday 💳',
      type: 'Credit card',
      currency: 'CAD',
    },
  );
});

test('account input rejects blanks, oversized labels, and unsupported classifications', () => {
  for (const input of [
    { bank: '', name: 'Main', type: 'Chequing', currency: 'CAD' },
    { bank: 'A', name: ' '.repeat(3), type: 'Chequing', currency: 'CAD' },
    { bank: 'A'.repeat(81), name: 'Main', type: 'Chequing', currency: 'CAD' },
    { bank: 'A', name: 'Main', type: 'Wallet', currency: 'CAD' },
    { bank: 'A', name: 'Main', type: 'Chequing', currency: 'EUR' },
  ])
    assert.throws(() => parseAccountInput(input), AccountInputError);
});

test('duplicate account labels remain valid because account IDs disambiguate them', () => {
  const input = {
    bank: 'Generic Bank',
    name: 'Main',
    type: 'Chequing',
    currency: 'USD',
  };
  assert.deepEqual(parseAccountInput(input), parseAccountInput(input));
});

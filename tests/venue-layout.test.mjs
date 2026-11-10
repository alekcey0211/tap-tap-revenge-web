import test from 'node:test';
import assert from 'node:assert/strict';
import { spectrumColumn, spectrumLevel } from '../prototype/venue-layout.js';

test('spectrum columns fill a symmetric circle and never protrude through its rim', () => {
  const columns = Array.from({ length: 31 }, (_, i) => spectrumColumn(i));
  for (const [i, column] of columns.entries()) {
    assert.ok(column.width > 0 && column.height > 0);
    assert.ok((Math.abs(column.x) + column.width / 2) ** 2 + (column.height / 2) ** 2 <= 6.1 ** 2 + 1e-9);
    assert.equal(column.height, columns[30 - i].height);
    assert.ok(Math.abs(column.x + columns[30 - i].x) < 1e-9);
  }
  assert.ok(columns[15].height > 12);
  assert.ok(columns[30].x + columns[30].width / 2 > 6);
});

test('expanded spectrum interpolates the actual bands and keeps silence silent', () => {
  const spectrum = Float32Array.from({ length: 21 }, (_, i) => i / 20);
  for (let i = 0; i < 31; i++) {
    assert.ok(Math.abs(spectrumLevel(spectrum, i) - i / 30) < 1e-6);
    assert.equal(spectrumLevel(null, i), 0);
    assert.equal(spectrumLevel(new Float32Array(21), i), 0);
  }
});

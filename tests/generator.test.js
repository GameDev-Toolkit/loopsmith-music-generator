'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

// The generator is intentionally browser-first. A minimal window shim is enough
// to exercise its pure composition layer without introducing a DOM dependency.
global.window = {};
require(path.join(__dirname, '..', 'assets', 'js', 'config.js'));
require(path.join(__dirname, '..', 'assets', 'js', 'generator.js'));

const app = global.window.LoopSmith;
const densities = [68, 76, 88, 94, 100];

for (const [scaleKey, scale] of Object.entries(app.catalog.scales)) {
  for (const density of densities) {
    for (let sample = 0; sample < 100; sample += 1) {
      const settings = { seed: `test-${scaleKey}-${density}-${sample}`, scale: scaleKey, density };
      const first = app.generator.composeMelody(settings);
      const second = app.generator.composeMelody(settings);
      const expectedActiveNotes = Math.max(28, Math.min(app.constants.steps, Math.round(app.constants.steps * density / 100)));

      assert.deepEqual(first, second, 'The same seed and controls must reproduce the same composition.');
      assert.equal(app.generator.validateMelody(first.notes, scale.semitones.length), true, 'Generated notes must satisfy all structural invariants.');
      assert.equal(first.notes.filter((note) => note !== null).length, expectedActiveNotes, 'The realized density must match the constrained target.');
    }
  }
}

console.log('Generator tests passed: 2,000 deterministic compositions validated.');

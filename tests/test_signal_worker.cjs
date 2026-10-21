/* Pure Node VM checks; no browser, packages, network or generated files. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const messages = [];
const context = vm.createContext({self: {postMessage(value) { messages.push(value); }}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js/signal-worker.js'), 'utf8'), context);
function run(series, selectedYear, id = 'analysis-1') {
  context.self.onmessage({data: {id, series, selectedYear}});
  return JSON.parse(JSON.stringify(messages[messages.length - 1]));
}
function year(year, values) { return {year, values}; }
function months(mapper) { return Array.from({length: 12}, (_, month) => mapper(month)); }
function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}
const tests = [];
function test(name, body) { tests.push([name, body]); }

test('lag12 keeps real calendar alignment and valid zero observations', () => {
  const input = [year(2021, months(m => m)), year(2022, months(m => m === 3 ? null : m)),
    year(2023, months(m => m === 8 ? null : m))];
  const result = run(input, 2023);
  assert.equal(result.available, true);
  assert.equal(result.lag12.pairs, 21);
  near(result.lag12.value, 1);
  assert.deepEqual(result.coverage, {observed: 34, expected: 36, missing: 2});
  assert.equal(result.nearestYear, null);
});

test('missing whole years never become adjacent annual pairs', () => {
  const result = run([year(2021, months(m => m)), year(2023, months(m => m))], 2023);
  assert.equal(result.lag12.pairs, 0);
  assert.equal(result.lag12.value, null);
  assert.deepEqual(result.coverage, {observed: 24, expected: 36, missing: 12});
});

test('strong seasonality reports Pearson +1 while anticorrelation reports -1', () => {
  const seasonal = run([year(2021, months(m => m)), year(2022, months(m => m * 2))], 2022);
  near(seasonal.lag12.value, 1);
  const reversed = run([year(2021, months(m => m)), year(2022, months(m => 11 - m))], 2022);
  near(reversed.lag12.value, -1);
  assert.equal(run([year(2021, months(m => m)), year(2022, months(m => m < 11 ? m : null))], 2022).lag12.value, null);
});

test('all-zero and all-null values preserve mathematical edge cases', () => {
  const zero = run([year(2021, months(() => 0)), year(2022, months(() => 0))], 2022);
  assert.equal(zero.coverage.observed, 24);
  assert.equal(zero.lag12.value, null);
  assert.equal(zero.trend.slopePerMonth, 0);
  assert.deepEqual(zero.nearestYear, {year: 2021, distance: 0});
  const missing = run([year(2021, months(() => null))], 2021);
  assert.equal(missing.available, true);
  assert.equal(missing.trend.slopePerMonth, null);
  assert.deepEqual(missing.coverage, {observed: 0, expected: 12, missing: 12});
});

test('Theil–Sen uses true month gaps and resists isolated outliers', () => {
  const sparse = run([year(2021, months(m => m === 0 ? 0 : null)),
    year(2023, months(m => m === 0 ? 24 : null))], 2023);
  near(sparse.trend.slopePerMonth, 1);
  const robust = run([year(2021, months(m => m === 5 ? 100 : 10 + m)),
    year(2022, months(m => 22 + m)), year(2023, months(m => 34 + m))], 2023);
  near(robust.trend.slopePerMonth, 1);
  assert.equal(robust.trend.method, 'Theil–Sen');
  assert.equal(robust.trend.sampled, false);
});

test('long histories sample at most 360 ordered actual-time observations', () => {
  const series = Array.from({length: 40}, (_, offset) => year(1960 + offset, months(m => 1 + (offset * 12 + m) * 0.1)));
  const result = run(series, 1999);
  assert.equal(result.trend.sampled, true);
  near(result.trend.slopePerMonth, 0.1);
  assert.equal(result.coverage.observed, 480);
});

test('leave-one-year-out anomaly baselines exclude the selected observation', () => {
  const source = [year(2020, months(() => 1)), year(2021, months(() => 2)),
    year(2022, months(() => 3)), year(2023, months(m => m === 0 ? 20 : 2))];
  const result = run(source, 2023);
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].month, 1);
  assert.equal(result.anomalies[0].baseline, 2);
  near(result.anomalies[0].score, 0.6744897501960817 * 18);
  source[3].values[0] = 80;
  const changed = run(source, 2023);
  assert.equal(changed.anomalies[0].baseline, 2);
  near(changed.anomalies[0].score, 0.6744897501960817 * 78);
});

test('zero MAD and insufficient peer years never produce anomaly flags', () => {
  const peers = [year(2020, months(() => 2)), year(2021, months(() => 2)),
    year(2022, months(() => 2)), year(2023, months(() => 99))];
  const result = run(peers, 2023);
  assert.deepEqual(result.anomalies, []);
  assert.match(result.note, /MAD为0/);
  assert.deepEqual(run(peers.slice(1), 2023).anomalies, []);
});

test('nearest year uses normalized monthly shape rather than absolute levels', () => {
  const result = run([year(2021, months(m => m * 2 + 20)),
    year(2022, months(m => 20 - m)), year(2023, months(m => m))], 2023);
  assert.equal(result.nearestYear.year, 2021);
  near(result.nearestYear.distance, 0);
  const constants = run([year(2021, months(() => 2)), year(2022, months(() => 50))], 2022);
  assert.deepEqual(constants.nearestYear, {year: 2021, distance: 0});
});

test('fractional constants and tiny valid observations stay numerically defined', () => {
  const constant = run([year(2021, months(() => 0.1)), year(2022, months(() => 0.3))], 2022);
  assert.equal(constant.lag12.value, null);
  assert.deepEqual(constant.nearestYear, {year: 2021, distance: 0});
  const tiny = run([year(2021, months(m => m * 1e-200)), year(2022, months(m => m * 2e-200))], 2022);
  near(tiny.lag12.value, 1);
  near(tiny.nearestYear.distance, 0);
});

test('duplicate years merge once without losing zero; conflicting values return error', () => {
  const merged = run([year(2021, months(m => m === 0 ? 0 : null)),
    year('2021', months(m => m === 0 ? null : 2))], '2021');
  assert.equal(merged.available, true);
  assert.equal(merged.coverage.observed, 12);
  assert.equal(merged.coverage.expected, 12);
  const conflict = run([year(2021, months(() => 1)), year(2021, months(() => 2))], 2021);
  assert.equal(conflict.available, false);
  assert.match(conflict.error, /冲突/);
});

test('invalid input produces graceful errors instead of uncaught exceptions', () => {
  [null, {}, {series: []}, {series: [year(2021, [1])]},
    {series: [year(1899, months(() => 1))]},
    {series: [year(2021, months(() => NaN))]},
    {series: [year(2021, months(() => Infinity))]},
    {series: [year(2021, months(() => 101))]},
    {series: [year(2021, months(() => -1))]},
    {series: [year(2021, months(() => '0'))]},
    {series: [year(2021, months(() => 1))], selectedYear: 2022}]
    .forEach(input => {
      assert.doesNotThrow(() => context.self.onmessage({data: input}));
      const result = messages[messages.length - 1];
      assert.equal(result.available, false);
      assert.equal(typeof result.error, 'string');
    });
});

test('reused message ids are echoed and recomputed independently', () => {
  const before = messages.length;
  const first = run([year(2021, months(() => 0))], 2021, 'same-id');
  const second = run([year(2021, months(m => m))], 2021, 'same-id');
  assert.equal(messages.length, before + 2);
  assert.equal(first.id, 'same-id');
  assert.equal(second.id, 'same-id');
  assert.equal(first.trend.slopePerMonth, 0);
  assert.equal(second.trend.slopePerMonth, 1);
});

let failed = 0;
for (const [name, body] of tests) {
  try { body(); process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { failed++; process.stderr.write('FAIL ' + name + '\n' + error.stack + '\n'); }
}
process.stdout.write(`${tests.length - failed}/${tests.length} worker checks passed\n`);
process.exitCode = failed ? 1 : 0;

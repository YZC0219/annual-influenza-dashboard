/* Run: node tests/test_specimen_gl.cjs
 * These deterministic tests exercise the engine's data, geometry and lifecycle.
 * The GL double does not replace compilation and visual checks in a real GPU.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/specimen-gl.js'), 'utf8');

function fixture(options = {}) {
  let clock = 10, identifier = 0;
  const frames = new Map(), uploads = [], shaders = [], drawn = [], uniforms = [], motionListeners = new Set();
  const gl = new Proxy({
    getShaderParameter: () => true, getProgramParameter: () => true,
    checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; },
    isContextLost: () => false, getUniformLocation: (program, name) => ({name}),
    uniform1fv(location, values) { uniforms.push({name: location.name, values: Array.from(values)}); },
    shaderSource(shader, text) { shaders.push(text); },
    bufferData(target, values) { uploads.push(values); },
    createShader: () => ({}), createProgram: () => ({}),
    createVertexArray: () => ({}), createBuffer: () => ({}),
    createTexture: () => ({}), createFramebuffer: () => ({})
  }, {get(target, key) {
    if (key in target) return target[key];
    if (/^[A-Z_0-9]+$/.test(key)) return key;
    return () => {};
  }});
  const context2D = new Proxy({
    fillText(text, x, y) { drawn.push({text, x, y, font: this.font}); }
  }, {get: (target, key) => key in target ? target[key] : () => {},
    set(target, key, value) { target[key] = value; return true; }});
  class CanvasNode {
    constructor() {
      this.style = {}; this.listeners = {}; this.children = []; this.captures = new Set();
      this.clientWidth = options.width || 900; this.clientHeight = options.height || 650;
    }
    setAttribute() {}
    appendChild(node) { node.parentNode = this; this.children.push(node); }
    removeChild(node) { this.children = this.children.filter(child => child !== node); node.parentNode = null; }
    getContext(kind, settings) {
      if (kind === 'webgl2') { this.contextOptions = settings; return options.webgl === false ? null : gl; }
      return context2D;
    }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    removeEventListener(name) { delete this.listeners[name]; }
    getBoundingClientRect() { return {left: 0, top: 0, width: root.clientWidth, height: root.clientHeight}; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    toDataURL() { return 'data:image/png;base64,TEST'; }
  }
  const root = new CanvasNode(), created = [], ready = [], hover = [], selected = [];
  const document = {getElementById: () => root, createElement() {
    const node = new CanvasNode(); created.push(node); return node;
  }};
  const motionQuery = {matches: !!options.reduced,
    addEventListener(name, callback) { if (name === 'change') motionListeners.add(callback); },
    removeEventListener(name, callback) { if (name === 'change') motionListeners.delete(callback); }};
  const window = {
    performance: {now: () => clock}, devicePixelRatio: 3,
    matchMedia: () => motionQuery, getComputedStyle: () => ({position: 'relative'}),
    requestAnimationFrame(callback) { frames.set(++identifier, callback); return identifier; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {observe() {} disconnect() {this.disconnected = true;}}
  };
  vm.runInNewContext(source, {window, document});
  const engine = window.FluSpecimen.create('specimen', {
    onReady: info => ready.push(info), onHover: point => hover.push(point),
    onSelect: (year, month) => selected.push([year, month])
  });
  return {engine, root, canvas: created[0], created, frames, uploads, shaders, drawn, ready, hover, selected, uniforms, motionListeners,
    tick(delta = 1000) { clock += delta; const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback(clock)); },
    advance(delta) { clock += delta; },
    setReduced(value) { motionQuery.matches = value; motionListeners.forEach(callback => callback({matches: value})); }};
}

function data() {
  const years = ['2021', '2022', '2023', '2024', '2025'];
  return {years, selectedYear: '2025', series: years.map((year, y) => ({year,
    values: Array.from({length: 12}, (_, month) => 2 + month * 0.4 + y * 0.2)}))};
}
function event(pointerId, x, y, type) {
  return {pointerId, clientX: x, clientY: y, button: 0, type, preventDefault() {}};
}
function screenPoint(position, camera, width, height) {
  const direction = [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)];
  const right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
  const up = [-Math.sin(camera.yaw) * Math.sin(camera.pitch), Math.cos(camera.pitch), -Math.cos(camera.yaw) * Math.sin(camera.pitch)];
  const relative = [position[0], position[1] - 0.38, position[2]];
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const depth = camera.distance - dot(direction, relative), focal = 1 / Math.tan(42 * Math.PI / 360);
  return [(1 + dot(right, relative) * focal / (width / height) / depth) * width / 2,
    (1 - dot(up, relative) * focal / depth) * height / 2];
}
function test(name, callback) { callback(); console.log('PASS ' + name); }
function near(actual, expected, message) { assert(Math.abs(actual - expected) < 0.00001, message || `${actual} ≈ ${expected}`); }
function weights(engine) { return Array.from(engine.getState().monthMix); }

test('fixed month indexing, valid zero, missing-month ridge breaks and common scale', () => {
  const f = fixture();
  f.engine.update({years: ['2024', '2025'], selectedYear: '2025', series: [
    {year: '2024', values: [0, null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 999]},
    {year: '2025', values: Array.from({length: 12}, (_, i) => i)}]});
  const state = f.engine.getState();
  assert.equal(state.pointCount, 23);
  assert.equal(state.ridgeVertexCount, 360); // (9 + 11) adjacent pairs, 18 vertices each.
  assert(state.scaleMax < 999); // The 13th month is neither rendered nor used for scaling.
  const instances = f.uploads.filter(values => values.length === 23 * 21).at(-1);
  assert.equal(instances[19], 0);
  assert(Math.abs(instances[6] - 0.055) < 1e-6);
  f.engine.dispose();
});

test('real instance targets differ between modes, animation pauses, idle RAF stops', () => {
  const f = fixture(); f.engine.update(data()); f.tick();
  const corolla = Array.from(f.uploads.filter(values => values.length === 60 * 21).at(-1));
  f.engine.setMode('strata');
  const strata = Array.from(f.uploads.filter(values => values.length === 60 * 21).at(-1));
  assert.notDeepEqual(corolla.slice(3, 6), strata.slice(3, 6));
  assert(f.engine.getState().animating);
  f.engine.setActive(false); assert.equal(f.frames.size, 0);
  f.advance(1000); f.engine.setMode('orbit'); assert.equal(f.frames.size, 0);
  f.advance(1000); f.engine.setActive(true); assert(f.frames.size > 0);
  f.tick(400); assert(f.engine.getState().animating);
  f.tick(450); assert.equal(f.engine.getState().animating, false); assert.equal(f.frames.size, 0);
  f.engine.setMonth(2); assert.equal(f.engine.getState().month, 2);
  f.engine.setMonth(13); assert.equal(f.engine.getState().month, null);
  f.engine.dispose();
});

test('desktop close framing and portrait fitting preserve all month labels', () => {
  const f = fixture(); f.engine.update(data());
  for (const [width, height] of [[900, 650], [640, 600], [390, 520], [360, 680], [300, 500]]) {
    f.root.clientWidth = width; f.root.clientHeight = height;
    f.engine.resize(); f.engine.reset(); f.drawn.length = 0; f.tick();
    const months = f.drawn.filter(item => /^\d{1,2}月$/.test(item.text));
    assert.equal(months.length, 12, `month labels at ${width}×${height}`);
    for (const item of months) {
      assert(item.x >= 16 && item.x <= width - 16);
      assert(item.y >= 14 && item.y <= height - 14);
      assert(parseFloat(item.font) >= (width < 480 ? 10 : 12));
    }
    assert(f.drawn.some(item => item.text === '0'));
    assert(f.drawn.some(item => item.text === '4%'));
  }
  f.root.clientWidth = 900; f.root.clientHeight = 650; f.engine.resize(); f.engine.reset();
  assert(Math.abs(f.engine.getState().camera.distance - 8.6) < 1e-6);
  const distance = f.engine.getState().camera.distance;
  f.root.clientWidth = 0; f.root.clientHeight = 0; f.engine.resize();
  assert.equal(f.engine.getState().camera.distance, distance);
  f.engine.dispose();
});

test('strata retains year/month labels and adds 0, midpoint, maximum ILI ticks', () => {
  const f = fixture(); f.engine.update(data()); f.engine.setMode('strata');
  for (const [width, height] of [[900, 650], [360, 540]]) {
    f.root.clientWidth = width; f.root.clientHeight = height;
    f.engine.resize(); f.engine.reset(); f.drawn.length = 0; f.tick();
    assert.equal(f.drawn.filter(item => /^\d{1,2}月$/.test(item.text)).length, 12);
    assert.equal(f.drawn.filter(item => /^202\d$/.test(item.text)).length, 5);
    for (const text of ['0', '4', '8', 'ILI%']) assert(f.drawn.some(item => item.text === text), text);
  }
  f.engine.dispose();
});

test('CPU picking selects actual zero observation and dragging never misclicks', () => {
  const f = fixture(); f.engine.update({years: ['2025'], selectedYear: '2025', series: [{year: '2025', values: [0, null]}]}); f.tick();
  const p = screenPoint([0, 0.05, -1.0275], f.engine.getState().camera, 900, 650);
  f.canvas.listeners.pointermove(event(1, p[0], p[1]));
  assert.equal(f.hover.at(-1).value, 0); assert.equal(f.hover.at(-1).zero, true);
  f.canvas.listeners.pointerdown(event(1, p[0], p[1])); f.canvas.listeners.pointerup(event(1, p[0], p[1], 'pointerup'));
  assert.deepEqual(f.selected, [['2025', 1]]);
  f.canvas.listeners.pointerdown(event(2, p[0], p[1])); f.canvas.listeners.pointermove(event(2, p[0] + 40, p[1] + 20));
  f.canvas.listeners.pointerup(event(2, p[0] + 40, p[1] + 20, 'pointerup'));
  assert.equal(f.selected.length, 1); f.engine.dispose();
});

test('touch rotation, pinch zoom and cancellation never select data accidentally', () => {
  const f = fixture({width: 360, height: 540}); f.engine.update(data()); f.tick();
  const initial = {...f.engine.getState().camera};
  f.canvas.listeners.pointerdown(event(1, 120, 200));
  f.canvas.listeners.pointermove(event(1, 150, 210));
  assert.notEqual(f.engine.getState().camera.yaw, initial.yaw);
  const distance = f.engine.getState().camera.distance;
  f.canvas.listeners.pointerdown(event(2, 230, 210));
  f.canvas.listeners.pointermove(event(2, 270, 210));
  assert(f.engine.getState().camera.distance < distance);
  f.canvas.listeners.pointercancel(event(2, 270, 210, 'pointercancel'));
  f.canvas.listeners.pointercancel(event(1, 150, 210, 'pointercancel'));
  assert.equal(f.selected.length, 0); assert.equal(f.canvas.captures.size, 0);
  f.canvas.listeners.pointerdown(event(3, 120, 200));
  f.canvas.listeners.pointermove(event(3, 110, 200));
  f.canvas.listeners.pointerup(event(3, 110, 200, 'pointerup'));
  assert.equal(f.selected.length, 0); f.engine.dispose();
});

test('DPR, opaque output, capture, context recovery and disposal', () => {
  const f = fixture(); f.engine.update(data()); f.tick();
  assert.equal(f.canvas.width, 1575); assert.equal(f.canvas.contextOptions.alpha, false);
  assert.equal(f.engine.capture(), 'data:image/png;base64,TEST');
  f.canvas.listeners.webglcontextlost({preventDefault() {}});
  assert.equal(f.engine.getState().available, false); assert.equal(f.ready.at(-1).available, false);
  f.canvas.listeners.webglcontextrestored(); f.tick();
  assert.equal(f.engine.getState().available, true); assert.equal(f.engine.getState().pointCount, 60);
  for (const text of f.shaders) {
    assert(text.startsWith('#version 300 es'));
    assert.equal([...text].filter(ch => ch === '{').length, [...text].filter(ch => ch === '}').length);
    assert(!text.includes('texture2D('));
  }
  f.engine.dispose(); assert.equal(f.root.children.length, 0); assert.equal(f.frames.size, 0);
  assert.equal(f.engine.capture(), null);
});

test('unavailable WebGL returns a harmless controller; reduced motion skips morphs', () => {
  const absent = fixture({webgl: false}); assert.equal(absent.ready.at(-1).available, false);
  absent.engine.update(data()); absent.engine.setMode('strata'); absent.engine.reset(); absent.engine.resize();
  assert.equal(absent.engine.capture(), null); assert.equal(absent.frames.size, 0); absent.engine.dispose();
  const reduced = fixture({reduced: true}); reduced.engine.update(data()); reduced.engine.setMode('orbit');
  assert.equal(reduced.engine.getState().animating, false); reduced.engine.dispose();
});

test('month materials crossfade for 650ms without changing data geometry', () => {
  const f = fixture(); f.engine.update(data()); f.tick();
  const uploadCount = f.uploads.length, pointCount = f.engine.getState().pointCount;
  f.engine.setMonth(2); assert.equal(f.engine.getState().monthAnimating, true);
  f.tick(325);
  weights(f.engine).forEach((weight, i) => near(weight, i === 1 ? 1 : 0.5));
  const sent = f.uniforms.filter(item => item.name === 'uMonthWeights[0]').at(-1).values;
  assert.deepEqual(sent, weights(f.engine));
  assert.equal(f.uploads.length, uploadCount, 'month focus cannot rewrite heights, lengths or observations');
  assert.equal(f.engine.getState().pointCount, pointCount);
  f.tick(325);
  weights(f.engine).forEach((weight, i) => near(weight, i === 1 ? 1 : 0));
  assert.equal(f.engine.getState().monthAnimating, false); assert.equal(f.frames.size, 0);
  f.engine.dispose();
});

test('rapid month retargeting continues from the currently visible mixture', () => {
  const f = fixture(); f.engine.update(data()); f.tick();
  f.engine.setMonth(1, {immediate: true}); f.tick(0); f.engine.setMonth(2); f.tick(200);
  const before = weights(f.engine); assert(before[0] > before[1] && before[1] > 0);
  f.engine.setMonth(3); assert.deepEqual(weights(f.engine), before);
  f.tick(325); const middle = weights(f.engine);
  near(middle[0], before[0] / 2); near(middle[1], before[1] / 2); near(middle[2], 0.5);
  middle.slice(3).forEach(weight => near(weight, 0));
  f.tick(325); weights(f.engine).forEach((weight, i) => near(weight, i === 2 ? 1 : 0));
  assert.equal(f.frames.size, 0); f.engine.dispose();
});

test('December to January blends only its endpoints, and annual view returns smoothly', () => {
  const f = fixture(); f.engine.update(data()); f.tick();
  f.engine.setMonth(12, {immediate: true}); f.tick(0); f.engine.setMonth(1); f.tick(325);
  weights(f.engine).forEach((weight, i) => near(weight, i === 0 || i === 11 ? 0.5 : 0));
  f.tick(325); f.engine.setMonth(null); f.tick(325);
  weights(f.engine).forEach((weight, i) => near(weight, i === 0 ? 1 : 0.5));
  f.tick(325); weights(f.engine).forEach(weight => near(weight, 1));
  assert.equal(f.engine.getState().month, null); assert.equal(f.frames.size, 0); f.engine.dispose();
});

test('month fade freezes when inactive or context-lost and capture preserves that instant', () => {
  const f = fixture(); f.engine.update(data()); f.tick();
  f.engine.setMonth(1, {immediate: true}); f.tick(0); f.engine.setMonth(2); f.tick(200);
  const frozen = weights(f.engine); f.engine.setActive(false); f.advance(5000);
  assert.deepEqual(weights(f.engine), frozen); assert.equal(f.frames.size, 0);
  assert.equal(f.engine.capture(), 'data:image/png;base64,TEST'); assert.deepEqual(weights(f.engine), frozen);
  f.engine.setMonth(3); f.advance(1000); assert.deepEqual(weights(f.engine), frozen);
  f.engine.setActive(true); assert.deepEqual(weights(f.engine), frozen); f.tick(325);
  const interrupted = weights(f.engine);
  f.canvas.listeners.webglcontextlost({preventDefault() {}}); f.advance(3000);
  assert.deepEqual(weights(f.engine), interrupted); assert.equal(f.frames.size, 0);
  f.canvas.listeners.webglcontextrestored(); f.tick(0); assert.deepEqual(weights(f.engine), interrupted);
  f.tick(325); weights(f.engine).forEach((weight, i) => near(weight, i === 2 ? 1 : 0));
  assert.equal(f.engine.getState().pointCount, 60); assert.equal(f.frames.size, 0); f.engine.dispose();
});

test('repeating the target does not restart; immediate and reduced motion settle it', () => {
  const f = fixture(); f.engine.update(data()); f.tick(); f.engine.setMonth(1, {immediate: true}); f.tick(0);
  f.engine.setMonth(2); f.tick(250); f.engine.setMonth(2, {duration: 200}); f.tick(400);
  assert.equal(f.engine.getState().monthAnimating, false); assert.equal(f.frames.size, 0);
  f.engine.setMonth(3); f.tick(100); f.engine.setMonth(3, {immediate: true});
  weights(f.engine).forEach((weight, i) => near(weight, i === 2 ? 1 : 0));
  assert.equal(f.engine.getState().monthAnimating, false);
  f.engine.setMonth(4); f.tick(100); f.setReduced(true);
  weights(f.engine).forEach((weight, i) => near(weight, i === 3 ? 1 : 0));
  assert.equal(f.engine.getState().monthAnimating, false); f.engine.setMonth(5);
  weights(f.engine).forEach((weight, i) => near(weight, i === 4 ? 1 : 0));
  f.tick(0); assert.equal(f.frames.size, 0); f.engine.dispose(); assert.equal(f.motionListeners.size, 0);
});

test('month duration supports fast scrubbing and safely normalizes invalid options', () => {
  const f = fixture(); f.engine.update(data()); f.tick(); f.engine.setMonth(1, {immediate: true}); f.tick(0);
  f.engine.setMonth(2, {duration: 180}); f.tick(90); near(weights(f.engine)[1], 0.5); f.tick(90);
  assert.equal(f.engine.getState().monthAnimating, false);
  f.engine.setMonth(3, {duration: Infinity}); f.tick(325); near(weights(f.engine)[2], 0.5); f.tick(325);
  f.engine.setMonth(4, {duration: NaN}); f.tick(325); near(weights(f.engine)[3], 0.5); f.tick(325);
  f.engine.setMonth(5, {duration: '180'}); f.tick(325); near(weights(f.engine)[4], 0.5); f.tick(325);
  f.engine.setMonth(6, {duration: 9000}); f.tick(1000); near(weights(f.engine)[5], 0.5); f.tick(1000);
  f.engine.setMonth(7, {duration: -20}); assert.equal(f.engine.getState().monthAnimating, false); near(weights(f.engine)[6], 1);
  f.engine.setMonth(8); f.tick(100); f.engine.setMonth(8, {duration: 0}); near(weights(f.engine)[7], 1);
  assert.equal(f.engine.getState().monthAnimating, false);
  f.engine.setMonth(9, {animate: false}); near(weights(f.engine)[8], 1); f.tick(0);
  assert.equal(f.frames.size, 0); f.engine.dispose();
});

/* Run: node tests/test_soundscape.cjs
 * Web Audio API lifecycle doubles verify user intent, timing and resource use.
 * These tests do not assess musical quality; that requires a real listening test.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/soundscape.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture(options = {}) {
  let clock = 0, id = 0;
  const timers = new Map(), audioEnds = new Map(), contexts = [], states = [];
  class Target {
    constructor() { this.events = new Map(); }
    addEventListener(name, listener) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(listener); }
    removeEventListener(name, listener) { this.events.get(name)?.delete(listener); }
    dispatch(name, event = {}) { for (const listener of [...(this.events.get(name) || [])]) listener(event); }
  }
  class Parameter {
    constructor(value = 0) { this.value = value; this.events = []; }
    setValueAtTime(value, time) { this.events.push({kind: 'set', value, time}); this.value = value; return this; }
    linearRampToValueAtTime(value, time) { this.events.push({kind: 'linear', value, time}); this.value = value; return this; }
    exponentialRampToValueAtTime(value, time) { this.events.push({kind: 'exponential', value, time}); this.value = value; return this; }
    cancelScheduledValues(time) { this.events.push({kind: 'cancel', time}); return this; }
    cancelAndHoldAtTime(time) { this.events.push({kind: 'hold', time}); return this; }
  }
  class AudioNode {
    constructor(context, kind) {
      this.context = context; this.kind = kind; this.connections = []; this.disconnected = false;
      for (const name of ['gain', 'frequency', 'detune', 'pan', 'Q', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[name] = new Parameter();
      context.nodes.push(this);
    }
    connect(target) { this.connections.push(target); return target; }
    disconnect() { this.disconnected = true; this.connections = []; }
    setPeriodicWave() { this.waveAssigned = true; }
    start(when = this.context.currentTime) { this.started = when; this.context.starts.push({kind: this.kind, when, node: this}); }
    stop(when = this.context.currentTime) {
      this.stopped = when;
      audioEnds.set(this, {at: clock + Math.max(0, when - this.context.currentTime) * 1000,
        callback: () => { audioEnds.delete(this); if (this.onended) this.onended(); }});
    }
  }
  class AudioContext extends Target {
    constructor() {
      super(); this.state = 'suspended'; this.sampleRate = 8000; this.nodes = []; this.starts = [];
      this.elapsed = 0; this.runningSince = clock; this.resumeCalls = 0; this.suspendCalls = 0; this.closeCalls = 0;
      this.destination = new AudioNode(this, 'destination'); contexts.push(this);
    }
    get currentTime() { return this.elapsed + (this.state === 'running' ? (clock - this.runningSince) / 1000 : 0); }
    change(next) { this.elapsed = this.currentTime; this.runningSince = clock; this.state = next; this.dispatch('statechange'); }
    resume() {
      this.resumeCalls++;
      if (this.rejectNextResume) { const error = this.rejectNextResume; this.rejectNextResume = null; return Promise.reject(error); }
      if (options.deferFirstResume && this.resumeCalls === 1) return new Promise((resolve, reject) => {
        this.finishResume = () => { if (this.state === 'closed') reject(Object.assign(new Error('closed'), {name: 'InvalidStateError'})); else { this.change('running'); resolve(); } };
      });
      if (this.state === 'closed') return Promise.reject(new Error('closed'));
      this.change('running'); return Promise.resolve();
    }
    suspend() { this.suspendCalls++; if (this.state !== 'closed') this.change('suspended'); return Promise.resolve(); }
    close() { this.closeCalls++; this.change('closed'); return Promise.resolve(); }
    createGain() { return new AudioNode(this, 'gain'); }
    createOscillator() { return new AudioNode(this, 'oscillator'); }
    createBufferSource() { return new AudioNode(this, 'bufferSource'); }
    createBiquadFilter() { return new AudioNode(this, 'filter'); }
    createStereoPanner() { return new AudioNode(this, 'panner'); }
    createDynamicsCompressor() { return new AudioNode(this, 'compressor'); }
    createDelay() { return new AudioNode(this, 'delay'); }
    createPeriodicWave() { return {}; }
    createBuffer(channels, length) { return {getChannelData: () => new Float32Array(length)}; }
  }
  const document = new Target(); document.visibilityState = 'visible'; document.hidden = false;
  const window = new Target();
  if (!options.unsupported) window.AudioContext = AudioContext;
  window.setTimeout = (callback, delay) => { timers.set(++id, {at: clock + delay, callback}); return id; };
  window.clearTimeout = key => timers.delete(key);
  vm.runInNewContext(source, {window, document});
  const engine = window.FluSound.create({onState: state => states.push(state)});
  return {engine, window, document, contexts, states, timers,
    async advance(milliseconds) {
      const end = clock + milliseconds;
      for (let guard = 0; guard < 10000; guard++) {
        await flush();
        let next = null, token = null, collection = null;
        for (const list of [timers, audioEnds]) for (const [key, item] of list) {
          if (item.at <= end && (!next || item.at < next.at)) { next = item; token = key; collection = list; }
        }
        if (!next) { clock = end; await flush(); return; }
        clock = Math.max(clock, next.at); collection.delete(token); next.callback();
      }
      throw new Error('Unexpected persistent scheduling loop');
    },
    async visibility(hidden) { document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible'; document.dispatch('visibilitychange'); await flush(); },
    noteStarts() { return contexts.flatMap(context => context.starts.filter(start => start.kind === 'oscillator' && start.when > 0)); },
    master() { return contexts[0]?.nodes.find(node => node.kind === 'gain' && node.connections.some(target => target.kind === 'compressor')); }
  };
}

const cases = [];
function test(name, callback) { cases.push({name, callback}); }

test('default silence never constructs an AudioContext from frames or page events', async () => {
  const f = fixture();
  assert.equal(f.engine.getState().status, 'off'); assert.equal(f.engine.getState().volume, 0.24);
  f.engine.setFrame({month: 4, mode: 'strata', hasData: true}); f.engine.setVolume(0.4);
  f.engine.setPageActive(false); f.engine.setPageActive(true); await f.visibility(true); await f.visibility(false);
  assert.equal(f.contexts.length, 0); assert.equal(f.timers.size, 0); f.engine.dispose();
});

test('explicit unlock, bounded gain, literal zero volume and fade-out suspension', async () => {
  const f = fixture(); await f.engine.toggle();
  assert.equal(f.contexts.length, 1); assert.equal(f.contexts[0].resumeCalls, 1);
  assert.equal(f.engine.getState().playing, true); assert.equal(f.engine.getState().enabled, true);
  assert.equal(f.timers.size, 1);
  f.engine.setVolume(0); assert.equal(f.engine.getState().volume, 0); assert.equal(f.master().gain.events.at(-1).value, 0);
  assert.equal(f.engine.getState().enabled, true);
  f.engine.setVolume(9); assert.equal(f.engine.getState().volume, 1); assert(f.master().gain.events.at(-1).value <= 0.28);
  const off = f.engine.toggle(); await f.advance(600); await off;
  assert.equal(f.engine.getState().status, 'off'); assert.equal(f.contexts[0].state, 'suspended'); assert.equal(f.timers.size, 0);
  f.engine.dispose();
});

test('rapid toggles and pending resume honor the most recent user intent', async () => {
  const f = fixture({deferFirstResume: true});
  const a = f.engine.toggle(), b = f.engine.toggle(), c = f.engine.toggle();
  assert.equal(f.contexts.length, 1); f.contexts[0].finishResume(); await Promise.all([a, b, c]);
  assert.equal(f.engine.getState().playing, true); assert.equal(f.timers.size, 1);
  const off = f.engine.toggle(); await flush(); const on = f.engine.toggle(); await Promise.all([off, on]);
  assert.equal(f.engine.getState().playing, true); assert.equal(f.contexts.length, 1); assert.equal(f.timers.size, 1);
  f.engine.dispose();
});

test('backgrounding during resume cannot resurrect sound; visible return can resume', async () => {
  const f = fixture({deferFirstResume: true}); const click = f.engine.toggle();
  await f.visibility(true); f.contexts[0].finishResume(); await f.advance(600); await click;
  assert.equal(f.engine.getState().playing, false); assert.equal(f.engine.getState().enabled, true);
  assert.equal(f.engine.getState().status, 'paused'); assert.equal(f.contexts[0].state, 'suspended');
  await f.visibility(false); assert.equal(f.engine.getState().playing, true); assert.equal(f.contexts.length, 1);
  f.engine.dispose();
});

test('non-overview pause and BFCache preserve intent; ordinary pagehide releases audio', async () => {
  const f = fixture(); await f.engine.toggle(); f.engine.setPageActive(false); await f.advance(600);
  assert.equal(f.engine.getState().status, 'paused'); assert.equal(f.engine.getState().enabled, true); assert.equal(f.timers.size, 0);
  f.engine.setFrame({month: 5, mode: 'orbit', hasData: true}); assert.equal(f.timers.size, 0);
  f.engine.setPageActive(true); await flush(); assert.equal(f.engine.getState().playing, true);
  f.window.dispatch('pagehide', {persisted: true}); await f.advance(600);
  assert.equal(f.engine.getState().enabled, true); assert.equal(f.contexts[0].state, 'suspended');
  f.window.dispatch('pageshow', {persisted: true}); await flush(); assert.equal(f.engine.getState().playing, true);
  f.window.dispatch('pagehide', {persisted: false}); await flush();
  assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.timers.size, 0);
  await f.engine.toggle(); assert.equal(f.contexts.length, 1); assert.equal(f.engine.getState().enabled, false);
});

test('no-data suppresses glass notes; unchanged month does not retrigger', async () => {
  const f = fixture(); await f.engine.toggle(); await f.advance(10000);
  assert.equal(f.noteStarts().length, 0);
  f.engine.setFrame({month: 6, mode: 'corolla', hasData: true}); await f.advance(250);
  const count = f.noteStarts().length; assert.equal(count, 2);
  f.engine.setFrame({month: 6, mode: 'corolla', hasData: true}); await f.advance(500);
  assert.equal(f.noteStarts().length, count);
  f.engine.setFrame({month: 7, mode: 'paper', hasData: true}); await f.advance(400);
  assert.equal(f.noteStarts().length, count + 2);
  f.engine.setFrame({month: 8, hasData: false}); await f.advance(10000);
  assert.equal(f.noteStarts().length, count + 2); assert.equal(f.contexts.length, 1);
  f.engine.dispose();
});

test('blocked automatic resume turns off and recovers with one explicit click', async () => {
  const f = fixture(); await f.engine.toggle(); await f.visibility(true); await f.advance(600);
  f.contexts[0].rejectNextResume = Object.assign(new Error('gesture required'), {name: 'NotAllowedError'});
  await f.visibility(false);
  assert.equal(f.engine.getState().enabled, false); assert.equal(f.engine.getState().status, 'off');
  assert.match(f.engine.getState().reason, /点击播放/); assert.equal(f.timers.size, 0);
  await f.engine.toggle(); assert.equal(f.engine.getState().playing, true); assert.equal(f.contexts.length, 1);
  f.engine.dispose();
});

test('unsupported Web Audio and disposal while unlocking are harmless', async () => {
  const absent = fixture({unsupported: true}); await absent.engine.toggle();
  assert.equal(absent.engine.getState().status, 'unavailable'); assert.equal(absent.contexts.length, 0);
  absent.engine.setVolume(0); absent.engine.setPageActive(false); await flush();
  assert.equal(absent.timers.size, 0); absent.engine.dispose();
  const pending = fixture({deferFirstResume: true}); const opening = pending.engine.toggle();
  pending.engine.dispose(); pending.contexts[0].finishResume(); await opening; await flush();
  assert.equal(pending.engine.getState().playing, false); assert.equal(pending.contexts[0].state, 'closed');
  assert.equal(pending.timers.size, 0);
  await pending.engine.toggle(); assert.equal(pending.contexts.length, 1);
});

(async () => {
  for (const item of cases) { await item.callback(); console.log('PASS ' + item.name); }
})().catch(error => { console.error(error); process.exitCode = 1; });

/* Integration regressions for experience.js public behavior. No browser packages. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/js/experience.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const elements = new Map(), documentEvents = new Map(), windowEvents = new Map();
  const workers = [], observers = [], intervals = new Map(), timeouts = new Map(), animations = [];
  const motionListeners = new Set();
  const motionQuery = {matches: !!options.reducedMotion,
    addEventListener(name, callback) { if (name === 'change') motionListeners.add(callback); },
    removeEventListener(name, callback) { if (name === 'change') motionListeners.delete(callback); }};
  let serial = 0, currentURL = new URL(options.url || 'http://localhost:5000/');
  const state = {payload: null, active: false, updates: 0, callbacks: null, paper: null};

  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set(), events = new Map();
    let content = '';
    const node = {
      id, style: {setProperty(name, value) { this[name] = String(value); },
        getPropertyValue(name) { return this[name] || ''; }},
      dataset: {}, children: [], value: '', hidden: false, disabled: false, isConnected: true,
      classList: {add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
        toggle(name, force) { const add = force === undefined ? !classes.has(name) : force;
          if (add) classes.add(name); else classes.delete(name); return add; },
        contains(name) { return classes.has(name); }},
      setAttribute(name, value) { this[name] = String(value); },
      removeAttribute(name) { delete this[name]; },
      appendChild(child) { this.children.push(child); return child; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; content = ''; },
      addEventListener(name, callback) { events.set(name, callback); },
      dispatch(name, event = {}) { if (events.has(name)) events.get(name).call(this, event); },
      animate(keyframes, timing) {
        const animation = {targetId: id, keyframes, timing, cancelled: false,
          cancel() { this.cancelled = true; }};
        animations.push(animation); return animation;
      },
      querySelector() { return null; }, querySelectorAll() { return []; },
      getBoundingClientRect() { return {left: 0, top: 0, width: 800, height: 600}; },
      focus() { document.activeElement = this; }, remove() {}, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; }
    };
    Object.defineProperty(node, 'textContent', {
      get() { return content; }, set(value) { content = String(value); node.children = []; }
    });
    elements.set(id, node);
    return node;
  }

  const document = {
    hidden: false, body: element('body'), activeElement: null,
    getElementById: element,
    createElement: tag => element(`${tag}-${++serial}`),
    createTextNode: text => ({textContent: String(text)}),
    querySelectorAll: selector => selector === '[data-scene]' ? sceneButtons : [],
    addEventListener(name, callback) { documentEvents.set(name, callback); }
  };
  const sceneButtons = ['corolla', 'strata', 'orbit'].map(mode => {
    const button = element('mode-' + mode); button.dataset.scene = mode; return button;
  });
  const location = {};
  ['href', 'search', 'hash'].forEach(name => Object.defineProperty(location, name, {
    get() { return currentURL[name]; }, set(value) { currentURL[name] = value; }
  }));
  const renderer = {
    update(payload) {
      state.payload = payload; state.updates++;
      // Real renderer updates notify readiness synchronously as well. A recovery
      // callback must therefore not trigger recursive resynchronization.
      if (state.updates > 10) throw new Error('recursive renderer update');
      state.callbacks.onReady({available: true, renderer: 'Mock WebGL 2', pointCount: 12});
    },
    setMonth(value, options) { state.month = value; state.monthOptions = options ? plain(options) : {}; },
    setMode(value) { state.mode = value; },
    setActive(value) { state.active = value; }, resize() {}, reset() {}, dispose() {},
    getState() { return {active: state.active, selectedYear: state.payload?.selectedYear}; }
  };
  const atlas = {render(id, payload) { state.paper = payload; }, clear() { state.paper = null; }};
  function Worker() {
    this.sent = [];
    this.postMessage = message => this.sent.push(plain(message));
    this.terminate = () => {};
    workers.push(this);
  }
  function IntersectionObserver(callback) {
    this.observe = () => {}; this.disconnect = () => {};
    this.deliver = visible => callback([{isIntersecting: visible}]);
    observers.push(this);
  }
  const window = {
    document, location, IntersectionObserver,
    matchMedia: () => motionQuery,
    history: {replaceState(_state, _title, url) { currentURL = new URL(url, currentURL); }},
    addEventListener(name, callback) { windowEvents.set(name, callback); },
    FluAtlas: atlas,
    FluSpecimen: {create(_id, callbacks) {
      state.callbacks = callbacks;
      callbacks.onReady({available: options.webglAvailable !== false, renderer: 'Mock WebGL 2', pointCount: 0});
      return renderer;
    }}
  };
  const context = vm.createContext({
    window, document, FluAtlas: atlas, Worker, IntersectionObserver, URL, URLSearchParams,
    requestAnimationFrame(callback) { callback(); return ++serial; },
    setInterval(callback) { const id = ++serial; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback) { const id = ++serial; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); }
  });
  vm.runInContext(source, context, {filename: 'experience.js'});
  element('region').value = '全国'; element('group').value = '全部年龄';

  const api = window.FluExperience;
  function payload(year, extra = {}) {
    return Object.assign({
      meta: {id: 'database', kind: 'demo'}, years: [String(year)],
      series: [{year: String(year), values: Array.from({length: 12}, (_, month) => month + 1)}],
      selectedYear: String(year), scope: '全国 / 全部年龄', onSelect() {}
    }, extra);
  }
  function response(id, correlation = 0.8) {
    return {data: {id, available: true, lag12: {value: correlation, pairs: 12},
      trend: {slopePerMonth: 1, sampled: false}, nearestYear: {year: 2020, distance: 0.1},
      coverage: {observed: 12}, anomalies: []}};
  }
  return {api, state, element, workers, observers, intervals, location, payload, response, animations,
    focused() { return document.activeElement; },
    keydown(key, extra = {}) { const event = Object.assign({key, defaultPrevented:false, preventDefault() { this.defaultPrevented=true; }}, extra);documentEvents.get('keydown')(event);return event; },
    finishFade() { const animation=animations.findLast(item=>!item.cancelled&&typeof item.onfinish==='function');if(animation)animation.onfinish(); },
    currentRequest() { return workers[0].sent.at(-1).id; },
    visibility(hidden) { document.hidden = hidden; documentEvents.get('visibilitychange')(); },
    motion(reduced) {
      motionQuery.matches = reduced;
      motionListeners.forEach(callback => callback({matches: reduced}));
    },
    ready(available) { state.callbacks.onReady({available, renderer: 'Mock WebGL 2', pointCount: 12}); }};
}

const tests = [];
function test(name, body) { tests.push([name, body]); }
function emptyMetrics(h) {
  ['signalCorrelation', 'signalTrend', 'signalNeighbor'].forEach(id => assert.equal(h.element(id).textContent, '—'));
}

test('clearing data and revisiting overview never reveals the old sculpture', () => {
  const h = harness(); h.api.update(h.payload(2021));
  assert.equal(h.state.active, true);
  h.api.clear(); h.api.setActive(false); h.api.setActive(true);
  assert.equal(h.state.active, false);
  assert.equal(h.element('specimenMount').style.visibility, 'hidden');
  assert.equal(h.element('sceneYears').children.length, 0);
  assert.equal(h.element('pointDate').textContent, '等待数据');
  h.api.update(h.payload(2025));
  assert.equal(h.state.active, true);
  assert.equal(h.element('specimenMount').style.visibility, '');
  assert.equal(h.state.payload.selectedYear, '2025');
});

test('context recovery catches up to changed filters without recursive updates', () => {
  const h = harness(); h.api.update(h.payload(2021)); h.ready(false);
  assert.equal(h.api.getState().mode, 'paper');
  h.api.update(h.payload(2025));
  assert.equal(h.state.payload.selectedYear, '2021');
  h.ready(true); h.api.setMode('corolla');
  assert.equal(h.state.payload.selectedYear, '2025');
  assert.equal(h.state.updates, 2);
  assert.equal(h.state.active, true);
});

test('responses for older filters and cleared datasets cannot replace current statistics', () => {
  const h = harness(); h.api.update(h.payload(2021)); const oldID = h.currentRequest();
  h.api.update(h.payload(2025)); const newID = h.currentRequest();
  h.workers[0].onmessage(h.response(oldID, -0.9)); emptyMetrics(h);
  h.workers[0].onmessage(h.response(newID, 0.8));
  assert.equal(h.element('signalCorrelation').textContent, 'r 0.80');
  h.api.clear(); h.workers[0].onmessage(h.response(newID, 0.1)); emptyMetrics(h);
});

test('a rejected analysis never retains values belonging to earlier filters', () => {
  const h = harness(); h.api.update(h.payload(2021));
  h.workers[0].onmessage(h.response(h.currentRequest()));
  h.api.update(h.payload(2025)); emptyMetrics(h);
  h.workers[0].onmessage({data: {id: h.currentRequest(), available: false, error: 'invalid series'}});
  emptyMetrics(h); assert.equal(h.element('signalNote').textContent, 'invalid series');
});

test('a worker runtime failure cannot leave previous numbers after changing filters', () => {
  const h = harness(); h.api.update(h.payload(2021));
  h.workers[0].onmessage(h.response(h.currentRequest())); h.workers[0].onerror();
  h.api.update(h.payload(2025)); emptyMetrics(h);
  assert.match(h.element('signalNote').textContent, /不可用|不支持/);
});

test('fractional and out-of-range months normalize to valid month slices', () => {
  const h = harness({url: 'http://localhost:5000/?month=2.5'}); h.api.update(h.payload(2025));
  assert.equal(h.api.getState().month, 3);
  assert.equal(h.element('sceneMonth')['aria-valuetext'], '3月');
  assert.equal(Number(h.element('sceneMonth').value), 3);
  assert.equal(h.element('pointDate').textContent, '2025 年 · 3 月');
  assert.equal(new URL(h.location.href).searchParams.get('month'), '3');
  h.api.setMonth(8.7); assert.equal(h.api.getState().month, 9);
  h.api.setMonth(99); assert.equal(h.api.getState().month, 12);
  h.api.setMonth(-1); assert.equal(h.api.getState().month, 0);
  assert.equal(new URL(h.location.href).searchParams.has('month'), false);
});

test('the visual rail follows integer month targets without changing slider semantics', () => {
  const h = harness(); h.api.update(h.payload(2025)); h.api.setMonth(5.8);
  const rail = h.element('timelineScrubber');
  assert.equal(h.api.getState().month, 6);
  assert.equal(rail.dataset.month, '6');
  assert.equal(rail.style.getPropertyValue('--timeline-position'), '50%');
  assert.equal(rail.style.getPropertyValue('--timeline-fraction'), '0.5');
  assert.equal(h.element('sceneMonth')['aria-valuetext'], '6月');
  assert.equal(new URL(h.location.href).searchParams.get('month'), '6');
  assert.equal(h.state.monthOptions.duration, 650);
  assert.equal(rail.classList.contains('is-wrapping'), false);
  assert.equal(rail.classList.contains('is-direct'), false);
});

test('December wraps directly to January instead of traversing intermediate months', () => {
  const h = harness(); h.api.update(h.payload(2025)); h.api.setMonth(12);
  h.element('scenePlay').dispatch('click');
  h.intervals.values().next().value();
  assert.equal(h.api.getState().month, 12, 'old month remains readable while fading out');
  h.finishFade();
  const rail = h.element('timelineScrubber');
  assert.equal(h.api.getState().month, 1);
  assert.equal(rail.dataset.month, '1');
  assert.ok(Math.abs(parseFloat(rail.style.getPropertyValue('--timeline-position')) - 100 / 12) < 1e-10);
  assert.equal(rail.classList.contains('is-wrapping'), true);
  assert.equal(rail.classList.contains('is-direct'), false);
  assert.equal(h.state.month, 1);
  assert.equal(h.element('sceneMonth')['aria-valuetext'], '1月');
  assert.equal(new URL(h.location.href).searchParams.get('month'), '1');
  h.element('scenePlay').dispatch('click');
  assert.equal(h.api.getState().month, 1);
  assert.equal(h.api.getState().playing, false);
  assert.equal(h.intervals.size, 0);
});

test('dragging during playback preserves the chosen month and immediately stops advancement', () => {
  const h = harness(); h.api.update(h.payload(2025)); h.api.setMonth(2);
  h.element('scenePlay').dispatch('click');
  h.element('sceneMonth').value = '9'; h.element('sceneMonth').dispatch('input');
  assert.equal(h.api.getState().playing, false);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.api.getState().month, 9);
  assert.equal(h.element('sceneMonth')['aria-valuetext'], '9月');
  assert.equal(h.element('timelineScrubber').dataset.month, '9');
  assert.equal(h.element('timelineScrubber').classList.contains('is-direct'), true);
  assert.equal(h.element('timelineScrubber').classList.contains('is-wrapping'), false);
  assert.equal(h.state.monthOptions.duration, 180);
  assert.equal(new URL(h.location.href).searchParams.get('month'), '9');
});

test('a live reduced-motion change stops playback and settles the current month immediately', () => {
  const h = harness(); h.api.update(h.payload(2025)); h.api.setMonth(7);
  h.element('scenePlay').dispatch('click'); assert.equal(h.api.getState().playing, true);
  h.motion(true);
  assert.equal(h.api.getState().playing, false); assert.equal(h.intervals.size, 0);
  assert.equal(h.element('scenePlay').disabled, true);
  assert.equal(h.state.month, 7); assert.equal(h.state.monthOptions.immediate, true);
  assert.equal(h.element('timelineScrubber').classList.contains('is-direct'), true);
  assert.equal(h.animations.filter(animation => !animation.cancelled).length, 0);
  assert.equal(new URL(h.location.href).searchParams.get('month'), '7');
  h.motion(false); assert.equal(h.element('scenePlay').disabled, false);
  assert.equal(h.api.getState().playing, false);
  h.element('scenePlay').dispatch('click'); assert.equal(h.api.getState().playing, true);
});

test('repeated months do not replay readouts and rapid changes cancel superseded animations', () => {
  const h = harness(); h.api.update(h.payload(2025)); h.api.setMonth(3);
  assert.equal(h.animations.length, 2);
  h.api.setMonth(3); assert.equal(h.animations.length, 2);
  h.api.setMonth(4);
  assert.ok(h.animations.slice(0, 2).every(animation => animation.cancelled));
  assert.equal(h.animations.filter(animation => !animation.cancelled).length, 2);
  h.api.setMonth(5); h.api.setMonth(11);
  assert.equal(h.animations.filter(animation => !animation.cancelled).length, 2);
  assert.equal(h.api.getState().month, 11);
  assert.equal(h.element('pointDate').textContent, '2025 年 · 11 月');
  assert.equal(h.element('pointValue').textContent, '11.00');
  h.motion(true); assert.equal(h.animations.filter(animation => !animation.cancelled).length, 0);
});

test('syncFilters writes the active selections on every page without requiring a scene payload', () => {
  const h = harness({url: 'http://localhost:5000/?scene=strata&month=8#analysis'});
  ['overview', 'analysis', 'forecast', 'data'].forEach((page, index) => {
    h.location.hash = '#' + page;
    h.element('region').value = '华东'; h.element('group').value = '0–4岁';
    h.api.syncFilters('imported-' + index, String(2021 + index));
    const url = new URL(h.location.href);
    assert.equal(url.hash, '#' + page);
    assert.equal(url.searchParams.get('dataset'), 'imported-' + index);
    assert.equal(url.searchParams.get('year'), String(2021 + index));
    assert.equal(url.searchParams.get('region'), '华东');
    assert.equal(url.searchParams.get('group'), '0–4岁');
    assert.equal(url.searchParams.get('scene'), 'strata');
    assert.equal(url.searchParams.get('month'), '8');
  });
  assert.equal(h.state.updates, 0);
});

test('initial URL filters restore once and cannot leak into another dataset', () => {
  const h = harness({url: 'http://localhost:5000/?dataset=archive&year=2024&region=华南&group=全部年龄'});
  assert.equal(h.api.initialDataset(), 'archive');
  assert.deepEqual(plain(h.api.consumeFilters('archive')), {dataset: 'archive', year: '2024', region: '华南', group: '全部年龄'});
  assert.deepEqual(plain(h.api.consumeFilters('database')), {});
  const missing = harness({url: 'http://localhost:5000/?dataset=unknown&year=2024&region=华南'});
  assert.deepEqual(plain(missing.api.consumeFilters('database')), {});
});

test('offscreen and background transitions stop playback and suspend the renderer', () => {
  const h = harness(); h.api.update(h.payload(2025)); h.element('scenePlay').dispatch('click');
  assert.equal(h.api.getState().playing, true); assert.equal(h.intervals.size, 1);
  h.observers[0].deliver(false);
  assert.equal(h.state.active, false); assert.equal(h.api.getState().playing, false); assert.equal(h.intervals.size, 0);
  h.observers[0].deliver(true); assert.equal(h.state.active, true);
  h.element('scenePlay').dispatch('click'); h.visibility(true);
  assert.equal(h.state.active, false); assert.equal(h.api.getState().playing, false);
  h.visibility(false); assert.equal(h.state.active, true); assert.equal(h.api.getState().playing, false);
});

test('renderer failure falls back to SVG and preserves valid zero versus missing readings', () => {
  const h = harness({webglAvailable: false});
  h.api.update(h.payload(2025, {series: [{year: '2025', values: [0, null, ...Array(10).fill(null)]}]}));
  assert.equal(h.api.getState().mode, 'paper');
  assert.equal(h.element('atlasChart').hidden, false);
  assert.equal(h.state.paper.series[0].values[0], 0);
  assert.equal(h.state.paper.series[0].values[1], null);
  assert.equal(h.state.active, false);
});

test('year changes disappear before committing and emerge after the swap', () => {
  const h=harness();h.api.update(h.payload(2025));let commits=0;
  h.api.changeYear('2023',()=>{commits++;h.api.update(h.payload(2023));});
  assert.equal(commits,0);assert.equal(h.state.payload.selectedYear,'2025');
  assert.equal(h.element('atlasSection')['aria-busy'],'true');
  const outgoing=h.animations.filter(a=>!a.cancelled);
  assert(outgoing.length>=5);assert.equal(outgoing[0].keyframes.at(-1).opacity,0);
  h.finishFade();assert.equal(commits,1);assert.equal(h.state.payload.selectedYear,'2023');
  const incoming=h.animations.filter(a=>!a.cancelled);
  assert.equal(incoming[0].keyframes[0].opacity,0);assert.equal(incoming[0].keyframes.at(-1).opacity,1);
  assert.equal(incoming[0].timing.delay,40);assert.equal(incoming[0].timing.duration,720);
  h.finishFade();assert.equal(h.element('specimenMount').style.opacity,'');
  assert.equal(h.element('atlasSection')['aria-busy'],undefined);
});

test('rapid year requests commit only the latest target, including returning to the old year', () => {
  const h=harness();h.api.update(h.payload(2025));const committed=[];
  h.api.changeYear('2023',()=>committed.push('2023'));
  const stale=h.animations.find(a=>typeof a.onfinish==='function');
  h.api.changeYear('2024',()=>committed.push('2024'));
  stale.onfinish();assert.deepEqual(committed,[]);
  h.api.changeYear('2025',()=>committed.push('2025'));
  h.finishFade();assert.deepEqual(committed,['2025']);h.finishFade();
});

test('clearing data discards pending year commits and restores opacity', () => {
  const h=harness();h.api.update(h.payload(2025));let commits=0;
  h.api.changeYear('2023',()=>commits++);const stale=h.animations.find(a=>typeof a.onfinish==='function');
  h.api.clear();stale.onfinish();assert.equal(commits,0);
  assert.equal(h.element('specimenMount').style.opacity,'');assert(h.animations.every(a=>a.cancelled));
});

test('reduced motion and leaving overview settle the latest requested year without hidden work', () => {
  for(const action of ['motion','leave']){
    const h=harness();h.api.update(h.payload(2025));let commits=0;
    h.api.changeYear('2023',()=>{commits++;h.api.update(h.payload(2023));});
    if(action==='motion')h.motion(true);else h.api.setActive(false);
    assert.equal(commits,1);assert(h.animations.every(a=>a.cancelled));
    assert.equal(h.element('specimenMount').style.opacity,'');
  }
});

test('year legend buttons survive selection changes to preserve focus and color transitions', () => {
  const h=harness(),years=['2023','2024','2025'];
  h.api.update(h.payload(2025,{years}));const buttons=Array.from(h.element('sceneYears').children);
  h.api.update(h.payload(2023,{years}));
  assert.deepEqual(Array.from(h.element('sceneYears').children),buttons);
  assert.equal(buttons[0]['aria-pressed'],'true');assert.equal(buttons[2]['aria-pressed'],'false');
});

test('WebGL loss during a year dissolve settles the latest year into the SVG fallback', () => {
  const h=harness();h.api.update(h.payload(2025));
  h.api.changeYear('2023',()=>h.api.update(h.payload(2023)));h.ready(false);
  assert.equal(h.api.getState().mode,'paper');assert.equal(h.state.paper.selectedYear,'2023');
  assert(h.animations.every(a=>a.cancelled));assert.equal(h.element('specimenMount').style.opacity,'');
});

test('Quick Explore owns Escape and Tab above an expanded scene', () => {
  const h=harness();h.api.update(h.payload(2025));
  h.element('sceneExpand').focus();h.element('sceneExpand').dispatch('click');
  assert(h.element('atlasSection').classList.contains('is-expanded'));
  h.keydown('k',{ctrlKey:true});
  assert(h.element('commandDialog').open);
  for(const key of ['Escape','Tab']){
    assert.equal(h.keydown(key).defaultPrevented,false);
    assert(h.element('atlasSection').classList.contains('is-expanded'));
  }
  // Native dialog handles Escape without the scene cancelling its default action.
  h.element('commandDialog').close();
  assert.equal(h.keydown('Escape').defaultPrevented,true);
  assert(!h.element('atlasSection').classList.contains('is-expanded'));
});

test('closing mobile immersive view returns focus to the entry button', () => {
  const h=harness();h.api.update(h.payload(2025));
  const entry=h.element('mobileExplore');entry.focus();entry.dispatch('click');
  assert.equal(h.focused(),h.element('sceneExpand'));
  h.element('sceneExpand').dispatch('click');
  assert.equal(h.focused(),entry);
  assert(!h.element('atlasSection').classList.contains('is-expanded'));
});

test('leaving overview closes immersive view without stealing navigation focus', () => {
  const h=harness();h.api.update(h.payload(2025));
  const entry=h.element('mobileExplore');entry.focus();entry.dispatch('click');
  const navigation=h.element('analysisNavigation');navigation.focus();
  h.api.setActive(false);
  assert.equal(h.focused(),navigation);
  assert(!h.element('atlasSection').classList.contains('is-expanded'));
});

test('closing immersive view never focuses a removed opener', () => {
  const h=harness();h.api.update(h.payload(2025));
  const entry=h.element('mobileExplore');entry.focus();entry.dispatch('click');entry.isConnected=false;
  h.keydown('Escape');assert.equal(h.focused(),h.element('sceneExpand'));
});

let failed = 0;
for (const [name, body] of tests) {
  try { body(); process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { failed++; process.stderr.write('FAIL ' + name + '\n' + error.stack + '\n'); }
}
process.stdout.write(`${tests.length - failed}/${tests.length} experience checks passed\n`);
process.exitCode = failed ? 1 : 0;

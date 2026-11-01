/* Chart motion and responsive camera regressions; no browser dependencies. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/visuals.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function harness({reduced = false, media = true, webgl = true, animatedCamera = false} = {}) {
  const elements = new Map(), charts = new Map(), listeners = [];
  function merge(target, patch) {
    Object.keys(patch).forEach(key => {
      const value = patch[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
        merge(target[key], value);
      } else target[key] = value;
    });
    return target;
  }
  function element(id, width = 800) {
    if (!elements.has(id)) elements.set(id, {id, clientWidth:width, clientHeight:350, style:{}, children:[],
      appendChild(node) { this.children.push(node); }, setAttribute() {}});
    return elements.get(id);
  }
  const echarts = {
    getInstanceByDom(node) { return charts.get(node); },
    init(node) {
      const chart = {option:{}, disposed:false, patches:[], resizes:0,
        setOption(patch, config = {}) {
          this.patches.push(patch);
          const normalized = {...patch};
          const control = patch.grid3D && patch.grid3D.viewControl;
          const oldControl = this.option.grid3D && this.option.grid3D[0].viewControl;
          if (animatedCamera && control && control.animation === true && control.distance && oldControl) {
            normalized.grid3D = {...patch.grid3D,viewControl:{...control,
              distance:(oldControl.distance+control.distance)/2}};
          }
          for (const key of ['grid3D','xAxis3D','yAxis3D','zAxis3D']) {
            if (normalized[key] && !Array.isArray(normalized[key])) normalized[key] = [normalized[key]];
          }
          for (const key of ['grid3D','xAxis3D','yAxis3D','zAxis3D','series']) {
            if (!Array.isArray(normalized[key])) continue;
            const replace = (config.replaceMerge || []).includes(key);
            const old = this.option[key] || [];
            this.option[key] = normalized[key].map((item,index) => merge(replace ? {} :
              (item.id ? old.find(entry => entry.id === item.id) : old[index]) || {}, item));
            delete normalized[key];
          }
          merge(this.option,normalized);
        },
        getOption() { return this.option; }, resize() { this.resizes++; },
        isDisposed() { return this.disposed; }, dispose() { this.disposed = true; }, off() {}, on() {}}
      charts.set(node,chart); return chart;
    }
  };
  const window = {echarts};
  if (media) window.matchMedia = () => ({matches:reduced, addEventListener(name,callback) { listeners.push(callback); }});
  const document = {getElementById: id => element(id), createElement(tag) {
    if (tag === 'canvas') return {getContext: () => webgl ? {getExtension: () => null} : null};
    return {style:{}, setAttribute() {}};
  }};
  vm.runInNewContext(source,{window,document});
  return {api:window.FluVisuals,element, changeMotion(matches) { listeners.forEach(callback => callback({matches})); }};
}

const matrixPayload = {regions:['全国','华北'],years:['2024','2025'],data:[{value:[0,0,0]},{value:[1,1,4.7]}]};
const trendPayload = {months:['1月','2月'],year:'2025',current:[0,null],previous:[2.5,4]};
let count = 0;
function test(name,run) { run(); console.log('PASS '+name); count++; }

test('chart text meets normal-text contrast against the existing paper background',() => {
  const h = harness(), chart = h.api.render('trend',h.element('trend'),trendPayload);
  const luminance = hex => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(part => parseInt(part,16)/255)
      .map(channel => channel <= .04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4);
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  };
  assert.ok((luminance('#f3f0e7')+.05)/(luminance(chart.option.textStyle.color)+.05) >= 4.5);
  assert.equal(chart.option.series[1].lineStyle.color,'#476c56');
  assert.deepEqual(plain(chart.option.series[1].data),[0,null]);
});

test('initial reduced motion disables both chart series and the WebGL camera',() => {
  const h = harness({reduced:true});
  for (const [type,payload] of [['trend',trendPayload],['matrix',matrixPayload]]) {
    const chart = h.api.render(type,h.element(type),payload);
    assert.equal(chart.option.animation,false);
    assert.equal(chart.option.animationDurationUpdate,0);
    chart.option.series.forEach(series => { assert.equal(series.animation,false); assert.equal(series.animationDurationUpdate,0); });
    if (type === 'matrix') assert.equal(chart.option.grid3D[0].viewControl.animation,false);
  }
});

test('live motion changes preserve chart data and the user camera angles',() => {
  const h = harness();
  const chart = h.api.render('matrix',h.element('matrix'),matrixPayload);
  const data = plain(chart.option.series[0].data);
  chart.setOption({grid3D:{viewControl:{alpha:44,beta:72,distance:190}}});
  h.changeMotion(true);
  assert.equal(chart.option.animation,false);
  assert.equal(chart.option.series[0].animationDurationUpdate,0);
  assert.equal(chart.option.grid3D[0].viewControl.animation,false);
  assert.equal(chart.option.grid3D[0].viewControl.alpha,44);
  assert.equal(chart.option.grid3D[0].viewControl.distance,190);
  assert.deepEqual(plain(chart.option.series[0].data),data);
  h.changeMotion(false);
  assert.equal(chart.option.animation,true);
  assert.equal(chart.option.series[0].animationDurationUpdate,800);
  assert.equal(chart.option.grid3D[0].viewControl.animation,false);
  assert.equal(chart.option.grid3D[0].viewControl.animationDurationUpdate,0);
});

test('camera framing follows screen width while preserving rotation and relative zoom',() => {
  const h = harness(), node = h.element('matrix');
  const chart = h.api.render('matrix',node,matrixPayload);
  chart.setOption({grid3D:{viewControl:{alpha:43,beta:62,distance:186}}});
  for (const [width,distance,axisName] of [[350,252,''],[550,216,'年度'],[800,186,'年度']]) {
    node.clientWidth = width; h.api.resize();
    const view = chart.option.grid3D[0].viewControl;
    assert.ok(Math.abs(view.distance-distance)<1e-9);
    assert.equal(view.alpha,43); assert.equal(view.beta,62);
    assert.equal(chart.option.yAxis3D[0].name,axisName);
  }
  node.clientWidth = 350; h.api.resize(); h.api.reset3D();
  const view = chart.option.grid3D[0].viewControl;
  assert.equal(view.distance,210); assert.equal(view.alpha,30); assert.equal(view.beta,25);
  node.clientWidth = 800; h.api.reset3D(); h.api.resize();
  assert.equal(chart.option.grid3D[0].viewControl.distance,155);
});

test('rapid viewport crossings settle immediately instead of compounding animated camera distances',() => {
  const h = harness({animatedCamera:true}), node = h.element('matrix');
  const chart = h.api.render('matrix',node,matrixPayload);
  h.api.render('matrix',node,matrixPayload);
  h.changeMotion(true); h.changeMotion(false);
  for (const patch of chart.patches) {
    if (patch.grid3D && patch.grid3D.viewControl) assert.equal(patch.grid3D.viewControl.animation,false);
  }
  for (const width of [350,800,550,350,800,350,800]) {
    node.clientWidth = width; h.api.resize();
    const view = chart.option.grid3D[0].viewControl;
    assert.equal(view.distance,width < 480 ? 210 : width < 640 ? 180 : 155);
    assert.equal(view.animation,false);
    assert.equal(view.animationDurationUpdate,0);
  }
  h.api.reset3D();
  assert.equal(chart.option.grid3D[0].viewControl.animation,false);
});

test('hovered or tapped heatmap values retain dark text against pale cells',() => {
  const h = harness();
  const chart = h.api.render('season',h.element('season'),{months:['1月'],years:['2025'],data:[[0,0,1.5]]});
  assert.equal(chart.option.series[0].emphasis.label.color,'#3d5b42');
  assert.equal(chart.option.series[0].emphasis.itemStyle.borderColor,'#476c56');
});

test('resizing inside one width band does not override user framing; hidden charts wait',() => {
  const h = harness(), node = h.element('matrix');
  const chart = h.api.render('matrix',node,matrixPayload);
  chart.setOption({grid3D:{viewControl:{distance:175,beta:75}}});
  node.clientWidth=700; h.api.resize();
  assert.equal(chart.option.grid3D[0].viewControl.distance,175);
  node.clientWidth=0; h.api.resize();
  assert.equal(chart.option.grid3D[0].viewControl.distance,175);
  node.clientWidth=350; h.api.resize();
  assert.ok(Math.abs(chart.option.grid3D[0].viewControl.distance-175*210/155)<1e-9);
  assert.equal(chart.option.grid3D[0].viewControl.beta,75);
});

test('missing media APIs and a WebGL fallback remain usable',() => {
  const noMedia = harness({media:false});
  assert.equal(noMedia.api.render('trend',noMedia.element('trend'),trendPayload).option.animation,true);
  const h = harness({webgl:false,reduced:true});
  const chart = h.api.render('matrix',h.element('matrix'),matrixPayload);
  assert.equal(chart.option.series[0].type,'heatmap');
  h.element('matrix').clientWidth=350; h.api.resize(); h.changeMotion(false); h.api.reset3D();
  assert.equal(chart.option.grid3D,undefined);
  assert.equal(chart.option.animation,true);
});
console.log(count+'/'+count+' visual checks passed');

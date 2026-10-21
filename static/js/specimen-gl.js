/* Local WebGL 2 specimen engine. Every instance is one observed year/month. */
(function (window, document) {
  'use strict';
  var PALETTE = ['#31594b', '#88a99c', '#c3a49e', '#b99b62', '#b75a48', '#6d8085', '#958a6d', '#8b7581'];
  var MODES = ['corolla', 'strata', 'orbit'], PI = Math.PI, SHADOW_SIZE = 1024;
  var PAPER = [243 / 255, 240 / 255, 231 / 255], DURATION = 800, MONTH_DURATION = 650;

  function mix(a, b, t) { return a + (b - a) * t; }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function mixArray(a, b, t) { return a.map(function (value, index) { return mix(value, b[index], t); }); }
  function cubic(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }
  function rgb(hex) { return [1, 3, 5].map(function (offset) { return parseInt(hex.slice(offset, offset + 2), 16) / 255; }); }
  function valid(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
  function notify(callback, value) { if (typeof callback === 'function') { try { callback(value); } catch (_) {} } }
  function niceMax(value) {
    if (!value) return 10;
    var power = Math.pow(10, Math.floor(Math.log10(value / 4)));
    var step = [1, 2, 2.5, 5, 10].filter(function (candidate) { return candidate * power >= value / 4; })[0] * power;
    return Math.ceil(value / step) * step;
  }
  function normalize(v) { var n = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(function (x) { return x / n; }); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return out;
  }
  function lookAt(eye, center) {
    var z = normalize(eye.map(function (value, i) { return value - center[i]; }));
    var x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function perspective(aspect) {
    var f = 1 / Math.tan(42 * PI / 360), near = 0.1, far = 60;
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  }
  function ortho(radius) {
    return new Float32Array([1 / radius, 0, 0, 0, 0, 1 / radius, 0, 0, 0, 0, -2 / 24, 0, 0, 0, -(24.2 / 24), 1]);
  }

  var LEAF_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aParam;
    layout(location=1) in vec3 aFromPosition;
    layout(location=2) in vec3 aToPosition;
    layout(location=3) in vec4 aFromShape;
    layout(location=4) in vec4 aToShape;
    layout(location=5) in vec3 aColor;
    layout(location=6) in vec4 aMeta;
    uniform mat4 uVP;
    uniform float uBlend;
    out vec3 vWorld;
    out vec3 vColor;
    out vec4 vMeta;
    void main() {
      vec3 origin = mix(aFromPosition, aToPosition, uBlend);
      vec4 shape = mix(aFromShape, aToShape, uBlend);
      float t = aParam.x, theta = aParam.y;
      float profile = sin(3.141592654 * t);
      vec3 local = vec3(t * shape.x,
        profile * shape.z * (0.50 + 0.50 * sin(theta)) + shape.x * 0.10 * t * t,
        profile * shape.y * cos(theta));
      float c = cos(shape.w), s = sin(shape.w);
      vWorld = origin + vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);
      vColor = aColor;
      vMeta = aMeta;
      gl_Position = uVP * vec4(vWorld, 1.0);
    }`;
  var RIDGE_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aFromPosition;
    layout(location=1) in vec3 aToPosition;
    layout(location=2) in vec3 aColor;
    layout(location=3) in vec4 aMeta;
    uniform mat4 uVP;
    uniform float uBlend;
    uniform float uStrata;
    out vec3 vWorld;
    out vec3 vColor;
    out vec4 vMeta;
    void main() {
      vWorld = mix(aFromPosition, aToPosition, uBlend);
      vWorld.y = 0.025 + (vWorld.y - 0.025) * uStrata;
      vColor = aColor;
      vMeta = aMeta;
      gl_Position = uVP * vec4(vWorld, 1.0);
    }`;
  var FLOOR_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 aPosition;
    uniform mat4 uVP;
    out vec3 vWorld;
    out vec3 vColor;
    out vec4 vMeta;
    void main() {
      vWorld = aPosition;
      vColor = vec3(0.952941, 0.941176, 0.905882);
      vMeta = vec4(-10.0);
      gl_Position = uVP * vec4(aPosition, 1.0);
    }`;
  var DEPTH_FRAGMENT = `#version 300 es
    precision highp float;
    void main() { }`;
  var MATERIAL_FRAGMENT = `#version 300 es
    precision highp float;
    in vec3 vWorld;
    in vec3 vColor;
    in vec4 vMeta;
    uniform vec3 uEye;
    uniform mat4 uLightVP;
    uniform sampler2D uShadow;
    uniform float uIsFloor;
    uniform float uOpacity;
    uniform float uSelectedYear;
    uniform float uMonthWeights[12];
    uniform float uHover;
    out vec4 outColor;
    float shadowAt(vec3 normal, vec3 light) {
      vec4 lightPosition = uLightVP * vec4(vWorld, 1.0);
      vec3 samplePosition = lightPosition.xyz / lightPosition.w * 0.5 + 0.5;
      if (samplePosition.z > 1.0 || samplePosition.z < 0.0 || any(lessThan(samplePosition.xy, vec2(0.0))) || any(greaterThan(samplePosition.xy, vec2(1.0)))) return 1.0;
      float bias = max(0.0011 * (1.0 - max(dot(normal, light), 0.0)), 0.00045);
      float visible = 0.0;
      for (int x=-1; x<=1; x++) for (int y=-1; y<=1; y++) {
        float depth = texture(uShadow, samplePosition.xy + vec2(x, y) / 1024.0).r;
        visible += samplePosition.z - bias <= depth ? 1.0 : 0.0;
      }
      return visible / 9.0;
    }
    void main() {
      vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
      if (!gl_FrontFacing) N = -N;
      if (uIsFloor > 0.5) N = vec3(0.0, 1.0, 0.0);
      vec3 L = normalize(vec3(-4.0, 8.0, 5.0)), V = normalize(uEye - vWorld);
      float shadow = shadowAt(N, L);
      vec3 albedo = pow(clamp(vColor, 0.0, 1.0), vec3(2.2));
      if (uIsFloor > 0.5) {
        float grain = fract(sin(dot(floor(vWorld.xz * 180.0), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 paper = albedo * (0.993 + grain * 0.007) * mix(0.76, 1.0, shadow);
        outColor = vec4(pow(paper, vec3(1.0/2.2)), 1.0);
        return;
      }
      float selected = abs(vMeta.y - uSelectedYear) < 0.1 ? 1.0 : 0.0;
      float monthCoordinate = clamp(vMeta.x, 0.0, 11.0);
      int monthA = int(floor(monthCoordinate)), monthB = min(monthA + 1, 11);
      float focused = mix(uMonthWeights[monthA], uMonthWeights[monthB], fract(monthCoordinate));
      float hovered = abs(vMeta.w - uHover) < 0.1 ? 1.0 : 0.0;
      albedo = mix(pow(vec3(0.88, 0.90, 0.85), vec3(2.2)), albedo, (0.64 + 0.36 * selected) * (0.55 + 0.45 * focused));
      albedo = mix(albedo, pow(vec3(0.72, 0.31, 0.23), vec3(2.2)), hovered * 0.18);
      vec3 H = normalize(V + L);
      float nv = max(dot(N, V), 0.001), nl = max(dot(N, L), 0.0), nh = max(dot(N, H), 0.0);
      float roughness = 0.47, a = roughness * roughness, a2 = a * a;
      float denominator = nh * nh * (a2 - 1.0) + 1.0;
      float D = a2 / max(3.141592654 * denominator * denominator, 0.001);
      float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
      float G = nv / (nv * (1.0-k) + k) * nl / max(nl * (1.0-k) + k, 0.001);
      vec3 F = vec3(0.045) + vec3(0.955) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
      vec3 specular = D * G * F / max(4.0 * nv * max(nl, 0.001), 0.001);
      vec3 diffuse = (vec3(1.0) - F) * albedo / 3.141592654;
      vec3 light = (diffuse + specular) * nl * 2.35 * mix(0.40, 1.0, shadow);
      light += albedo * (0.62 + 0.07 * max(N.y, 0.0));
      light += albedo * pow(1.0 - nv, 3.0) * 0.16;
      light += albedo * hovered * 0.06;
      light = light / (vec3(1.0) + light * 0.25);
      outColor = vec4(pow(max(light, vec3(0.0)), vec3(1.0/2.2)), uOpacity);
    }`;

  function create(elementId, callbacks) {
    callbacks = callbacks || {};
    var element = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    var canvas = document.createElement('canvas'), labels = document.createElement('canvas');
    canvas.className = 'specimen-webgl'; labels.className = 'specimen-labels';
    canvas.setAttribute('aria-label', '可拖拽旋转的流感数据标本，滚轮或双指缩放');
    labels.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab;';
    labels.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    if (element) { if (window.getComputedStyle(element).position === 'static') element.style.position = 'relative'; element.appendChild(canvas); element.appendChild(labels); }
    var gl = null, ctx = labels.getContext('2d'), gpu = null, available = false, disposed = false, active = true;
    var frameId = 0, width = 1, height = 1, dpr = 1, mode = 'corolla', monthFocus = null;
    var records = [], years = [], selectedYear = '', scaleMax = 10, lastPayload = null;
    var startTime = 0, animating = false, strataFrom = 0, strataTo = 0, pausedAt = 0;
    var monthFrom = new Float32Array(12).fill(1), monthTo = new Float32Array(12).fill(1);
    var monthWeights = new Float32Array(12).fill(1), monthStart = 0, monthDuration = MONTH_DURATION;
    var monthAnimating = false, monthPausedAt = null;
    var hovered = null, camera = {yaw: 0.28, pitch: 0.86, distance: 8.6}, fitReferenceDistance = 8.6;
    var viewProjection = null, eye = [0, 0, 10], pointerMap = new Map(), gesture = null, observer = null;
    var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = motionQuery ? motionQuery.matches : false;
    var lightVP = multiply(ortho(5.4), lookAt([-4, 8, 5], [0, 0.3, 0]));

    function blendAt(now) { return animating ? cubic(((active || !pausedAt ? now : pausedAt) - startTime) / DURATION) : 1; }
    function monthNow(now) { return monthPausedAt == null ? now : monthPausedAt; }
    function monthMixAt(now) {
      if (!monthAnimating) return new Float32Array(monthTo);
      var t = clamp((monthNow(now) - monthStart) / monthDuration, 0, 1), blend = t * t * (3 - 2 * t);
      return new Float32Array(monthFrom.map(function (weight, index) { return mix(weight, monthTo[index], blend); }));
    }
    function pauseMonth(now) { if (monthPausedAt == null) monthPausedAt = now; }
    function resumeMonth(now) {
      if (monthPausedAt == null || !active || !available) return;
      monthStart += now - monthPausedAt; monthPausedAt = null;
    }
    function motionChanged(event) {
      reduced = !!event.matches;
      if (reduced && monthAnimating) { monthFrom.set(monthTo); monthWeights.set(monthTo); monthAnimating = false; schedule(); }
    }
    function info(reason) { notify(callbacks.onReady, {available: available, renderer: 'WebGL 2', pointCount: records.length, reason: reason}); }
    function stop() { if (frameId) window.cancelAnimationFrame(frameId); frameId = 0; }
    function schedule() { if (!disposed && available && active && !frameId) frameId = window.requestAnimationFrame(render); }
    function fail(reason) { pauseMonth(window.performance.now()); available = false; stop(); canvas.hidden = true; labels.hidden = true; notify(callbacks.onHover, null); info(reason); }
    function compile(type, source) {
      var shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { var message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message || 'Shader compilation failed'); }
      return shader;
    }
    function program(vertex, fragment) {
      var p = gl.createProgram(), vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var message = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(message || 'Shader linking failed'); }
      return {program: p, locations: {}};
    }
    function uniform(p, name, type, value) {
      if (!(name in p.locations)) p.locations[name] = gl.getUniformLocation(p.program, name);
      var location = p.locations[name]; if (location == null) return;
      if (type === 'matrix') gl.uniformMatrix4fv(location, false, value);
      else if (type === 'vec3') gl.uniform3fv(location, value);
      else if (type === 'array') gl.uniform1fv(location, value);
      else if (type === 'int') gl.uniform1i(location, value);
      else gl.uniform1f(location, value);
    }
    function attribute(location, size, stride, offset, divisor) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(location, divisor || 0);
    }
    function initialize() {
      gl = canvas.getContext('webgl2', {antialias: true, alpha: false, depth: true, premultipliedAlpha: false, powerPreference: 'high-performance'});
      if (!gl) throw new Error('此设备未提供 WebGL 2');
      gpu = {leaf: program(LEAF_VERTEX, MATERIAL_FRAGMENT), ridge: program(RIDGE_VERTEX, MATERIAL_FRAGMENT),
        floor: program(FLOOR_VERTEX, MATERIAL_FRAGMENT), leafDepth: program(LEAF_VERTEX, DEPTH_FRAGMENT), ridgeDepth: program(RIDGE_VERTEX, DEPTH_FRAGMENT)};
      var parameters = [], indices = [], along = 24, around = 12;
      for (var u = 0; u <= along; u++) for (var v = 0; v <= around; v++) parameters.push(u / along, v / around * PI * 2);
      for (var i = 0; i < along; i++) for (var j = 0; j < around; j++) {
        var a = i * (around + 1) + j, b = a + around + 1; indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      gpu.leafVAO = gl.createVertexArray(); gl.bindVertexArray(gpu.leafVAO);
      gpu.parameterBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.parameterBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(parameters), gl.STATIC_DRAW); attribute(0, 2, 2, 0);
      gpu.indexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW); gpu.indexCount = indices.length;
      gpu.instanceBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instanceBuffer);
      attribute(1, 3, 21, 0, 1); attribute(2, 3, 21, 3, 1); attribute(3, 4, 21, 6, 1); attribute(4, 4, 21, 10, 1); attribute(5, 3, 21, 14, 1); attribute(6, 4, 21, 17, 1);
      gpu.ridgeVAO = gl.createVertexArray(); gl.bindVertexArray(gpu.ridgeVAO);
      gpu.ridgeBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.ridgeBuffer);
      attribute(0, 3, 13, 0); attribute(1, 3, 13, 3); attribute(2, 3, 13, 6); attribute(3, 4, 13, 9);
      gpu.floorVAO = gl.createVertexArray(); gl.bindVertexArray(gpu.floorVAO);
      gpu.floorBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.floorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-24, 0.025, -24, -24, 0.025, 24, 24, 0.025, 24, -24, 0.025, -24, 24, 0.025, 24, 24, 0.025, -24]), gl.STATIC_DRAW); attribute(0, 3, 3, 0);
      gpu.shadow = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, gpu.shadow);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gpu.framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, gpu.shadow, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('深度渲染目标不可用');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      available = true; canvas.hidden = false; labels.hidden = false;
    }

    function yearSpacing() { return Math.min(0.64, 3.6 / Math.max(1, years.length - 1)); }
    function layout(record, nextMode, yearCount) {
      var normalized = record.value / scaleMax, zero = record.value === 0;
      if (nextMode === 'strata') return {position: [(record.month - 5.5) * 0.48 - 0.05, normalized * 1.75 + 0.035, (record.yearIndex - (yearCount - 1) / 2) * yearSpacing()], shape: [zero ? 0.055 : 0.10, Math.min(zero ? 0.025 : 0.045, yearSpacing() * 0.20), zero ? 0.018 : 0.075, 0]};
      if (nextMode === 'orbit') {
        var time = (record.yearIndex * 12 + record.month) / Math.max(1, yearCount * 12 - 1), angle = time * PI * 4.2 - PI / 2, radius = 1.20 + time * 1.65;
        return {position: [Math.cos(angle) * radius, normalized * 1.55 + 0.035, Math.sin(angle) * radius], shape: [zero ? 0.055 : 0.16 + normalized * 0.10, zero ? 0.025 : 0.065, zero ? 0.018 : 0.11, angle + PI / 2]};
      }
      var spread = yearCount <= 1 ? 0 : (record.yearIndex - (yearCount - 1) / 2) * Math.min(0.066, 0.38 / (yearCount - 1));
      var angle = record.month / 12 * PI * 2 - PI / 2 + spread;
      var width = Math.max(0.012, Math.min(0.07, (yearCount < 2 ? 0.11 : Math.min(0.066, 0.38 / (yearCount - 1))) * 1.05));
      return {position: [Math.cos(angle), 0.035, Math.sin(angle)], shape: [zero ? 0.055 : normalized * 2.25, zero ? 0.025 : width * (0.75 + normalized * 0.55), zero ? 0.018 : 0.05 + normalized * 0.40, angle]};
    }
    function upload() {
      if (!available || !gpu) return;
      var instances = new Float32Array(records.length * 21);
      records.forEach(function (record, index) {
        record.pickIndex = index;
        instances.set(record.fromPosition.concat(record.toPosition, record.fromShape, record.toShape, record.color, [record.month, record.yearIndex, record.value, index]), index * 21);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.instanceBuffer); gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
      var ridge = [], byKey = Object.create(null); records.forEach(function (record) { byKey[record.key] = record; });
      function vertex(record, x, fraction, side) {
        var z = (record.yearIndex - (years.length - 1) / 2) * yearSpacing() + side * Math.min(0.035, yearSpacing() * 0.24);
        return [x, 0.025 + record.strataFrom * fraction, z, x, 0.025 + record.strataTo * fraction, z].concat(record.color, [record.month, record.yearIndex, record.value, record.pickIndex]);
      }
      function triangle(a, b, c) { ridge.push.apply(ridge, a); ridge.push.apply(ridge, b); ridge.push.apply(ridge, c); }
      function quad(a, b, c, d) { triangle(a, b, c); triangle(a, c, d); }
      years.forEach(function (year) {
        for (var month = 0; month < 11; month++) {
          var left = byKey[year + ':' + month], right = byKey[year + ':' + (month + 1)];
          if (!left || !right) continue; // Missing months break both the ridge and its shadow.
          var xa = (month - 5.5) * 0.48, xb = xa + 0.48;
          for (var side = -1; side <= 1; side += 2) quad(vertex(left, xa, 0, side), vertex(right, xb, 0, side), vertex(right, xb, 1, side), vertex(left, xa, 1, side));
          quad(vertex(left, xa, 1, -1), vertex(right, xb, 1, -1), vertex(right, xb, 1, 1), vertex(left, xa, 1, 1));
        }
      });
      gpu.ridgeCount = ridge.length / 13; gl.bindBuffer(gl.ARRAY_BUFFER, gpu.ridgeBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ridge), gl.DYNAMIC_DRAW);
    }
    function transition(nextRecords, first) {
      var now = window.performance.now(), blend = blendAt(now), old = Object.create(null);
      records.forEach(function (record) {
        old[record.key] = {position: mixArray(record.fromPosition, record.toPosition, blend), shape: mixArray(record.fromShape, record.toShape, blend), strata: mix(record.strataFrom, record.strataTo, blend)};
      });
      strataFrom = mix(strataFrom, strataTo, blend); strataTo = mode === 'strata' ? 1 : 0;
      nextRecords.forEach(function (record, index) {
        var target = layout(record, mode, years.length), prior = old[record.key];
        record.fromPosition = prior ? prior.position : target.position.slice(); record.toPosition = target.position;
        record.fromShape = prior ? prior.shape : target.shape.slice(); record.toShape = target.shape;
        record.strataFrom = prior ? prior.strata : record.value / scaleMax * 1.75; record.strataTo = record.value / scaleMax * 1.75;
      });
      records = nextRecords; startTime = now; animating = !first && !reduced && records.length > 0;
      if (!active) pausedAt = now;
      if (!animating) { strataFrom = strataTo; records.forEach(function (record) { record.fromPosition = record.toPosition.slice(); record.fromShape = record.toShape.slice(); record.strataFrom = record.strataTo; }); }
      upload(); schedule();
    }
    function update(payload) {
      if (disposed) return;
      lastPayload = payload || {}; var rows = Array.isArray(lastPayload.series) ? lastPayload.series : [];
      years = (Array.isArray(lastPayload.years) ? lastPayload.years : rows.map(function (row) { return row.year; })).map(String).filter(function (year, index, all) { return all.indexOf(year) === index; });
      selectedYear = years.indexOf(String(lastPayload.selectedYear)) >= 0 ? String(lastPayload.selectedYear) : years[years.length - 1];
      var next = [], highest = 0;
      years.forEach(function (year, yi) {
        var row = rows.filter(function (candidate) { return String(candidate.year) === year; })[0], values = row && row.values || [];
        for (var month = 0; month < 12; month++) if (valid(values[month])) {
          highest = Math.max(highest, values[month]); next.push({key: year + ':' + month, year: year, yearIndex: yi, month: month, value: values[month], color: rgb(PALETTE[yi % PALETTE.length])});
        }
      });
      scaleMax = niceMax(highest); hovered = null; notify(callbacks.onHover, null); transition(next, records.length === 0);
      if (width >= 16 && height >= 16) fitCamera(false); if (available) info();
    }
    function setMode(nextMode) {
      if (disposed || MODES.indexOf(nextMode) < 0 || nextMode === mode) return;
      mode = nextMode; fitCamera(false); hovered = null; notify(callbacks.onHover, null); transition(records.map(function (record) { return Object.assign({}, record); }), false);
    }
    function fitDistance() {
      // Fit actual world bounds plus text margins through the same perspective
      // used for drawing. The aspect ratio, rather than a phone breakpoint,
      // determines how far a narrow viewport needs to move the camera back.
      var direction = [Math.sin(camera.yaw) * Math.cos(camera.pitch), Math.sin(camera.pitch), Math.cos(camera.yaw) * Math.cos(camera.pitch)];
      var right = normalize(cross([0, 1, 0], direction)), up = cross(direction, right), points = [];
      var padX = width < 480 ? 28 : 35, padY = width < 480 ? 27 : 34;
      var marginX = Math.max(0.18, 1 - padX * 2 / width), marginY = Math.max(0.18, 1 - padY * 2 / height);
      var focal = 1 / Math.tan(42 * PI / 360), required = 8.6;
      if (mode === 'strata') {
        [-3.65, 3.05].forEach(function (x) { [0.025, 2.03].forEach(function (y) {
          [-1, 1].forEach(function (side) { points.push([x, y, side * ((years.length - 1) / 2 * yearSpacing() + 0.55)]); });
        }); });
      } else if (mode === 'corolla' && width >= 480 && records.length) {
        records.forEach(function (record) {
          var shape = layout(record, 'corolla', years.length), position = shape.position, dimensions = shape.shape;
          for (var t = 0; t <= 1; t += 0.25) {
            var profile = Math.sin(PI * t), along = dimensions[0] * t, lateral = dimensions[1] * profile;
            [-1, 1].forEach(function (side) { [0, 1].forEach(function (top) {
              points.push([position[0] + Math.cos(dimensions[3]) * along - Math.sin(dimensions[3]) * lateral * side,
                position[1] + profile * dimensions[2] * top + dimensions[0] * 0.10 * t * t,
                position[2] + Math.sin(dimensions[3]) * along + Math.cos(dimensions[3]) * lateral * side]);
            }); });
          }
        });
      } else if (mode === 'corolla' && width >= 480) {
        // Before the first payload there is nothing that needs a larger fit.
        return 8.6;
      } else {
        for (var i = 0; i < 32; i++) {
          var angle = i / 32 * PI * 2, radius = mode === 'corolla' ? 3.55 : 3.18;
          points.push([Math.cos(angle) * radius, 0.03, Math.sin(angle) * radius]);
          points.push([Math.cos(angle) * (mode === 'corolla' ? 3.3 : 3.18), mode === 'corolla' ? 0.8 : 1.9, Math.sin(angle) * (mode === 'corolla' ? 3.3 : 3.18)]);
        }
      }
      points.forEach(function (position) {
        var relative = [position[0], position[1] - 0.38, position[2]];
        required = Math.max(required, dot(direction, relative) + Math.max(Math.abs(dot(right, relative)) * focal / (width / height * marginX), Math.abs(dot(up, relative)) * focal / marginY));
      });
      return required;
    }
    function fitCamera(resetView) {
      var nextFit = fitDistance();
      camera.distance = resetView ? nextFit : clamp(camera.distance * nextFit / fitReferenceDistance, 5.2, Math.max(20, nextFit * 2));
      if (width < 480) camera.distance = Math.max(nextFit, camera.distance);
      fitReferenceDistance = nextFit;
    }
    function matrices() {
      var cp = Math.cos(camera.pitch), target = [0, 0.38, 0];
      eye = [Math.sin(camera.yaw) * cp * camera.distance, Math.sin(camera.pitch) * camera.distance + target[1], Math.cos(camera.yaw) * cp * camera.distance];
      viewProjection = multiply(perspective(width / height), lookAt(eye, target));
    }
    function use(p, vp, blend, strata, isFloor, opacity) {
      gl.useProgram(p.program); uniform(p, 'uVP', 'matrix', vp); uniform(p, 'uBlend', 'float', blend); uniform(p, 'uStrata', 'float', strata);
      uniform(p, 'uLightVP', 'matrix', lightVP); uniform(p, 'uEye', 'vec3', eye); uniform(p, 'uShadow', 'int', 0);
      uniform(p, 'uIsFloor', 'float', isFloor ? 1 : 0); uniform(p, 'uOpacity', 'float', opacity == null ? 1 : opacity);
      uniform(p, 'uSelectedYear', 'float', years.indexOf(selectedYear)); uniform(p, 'uMonthWeights[0]', 'array', monthWeights); uniform(p, 'uHover', 'float', hovered == null ? -2 : hovered);
    }
    function project(position) {
      if (!viewProjection) return null;
      var m = viewProjection, x = position[0], y = position[1], z = position[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15]; if (w <= 0) return null;
      var nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      var depth = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return {x: (nx + 1) * width / 2, y: (1 - ny) * height / 2, depth: depth, visible: Math.abs(nx) < 1.15 && Math.abs(ny) < 1.15 && depth >= -1 && depth <= 1};
    }
    function drawLabels(blend) {
      if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      var small = width < 480, fontSize = small ? 10 : 12;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#536c5f'; ctx.font = fontSize + 'px "Microsoft YaHei",sans-serif';
      function label(text, position, font, color, pin) {
        var p = project(position); if (!p) return;
        if (pin) { p.x = clamp(p.x, 23, width - 23); p.y = clamp(p.y, 17, height - 17); }
        else if (!p.visible || p.x < 16 || p.x > width - 16 || p.y < 14 || p.y > height - 14) return;
        ctx.font = font || fontSize + 'px "Microsoft YaHei",sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(243,240,231,.90)'; ctx.strokeText(text, p.x, p.y); ctx.fillStyle = color || '#536c5f'; ctx.fillText(text, p.x, p.y);
      }
      function line(positions, color, dashed) {
        ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 0.65; ctx.setLineDash(dashed ? [2, 5] : []); ctx.beginPath();
        var started = false;
        positions.forEach(function (position) { var p = project(position); if (!p || !p.visible) { started = false; return; } if (!started) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); started = true; });
        ctx.stroke(); ctx.restore();
      }
      if (mode === 'corolla') {
        [1.0, 2.125].forEach(function (radius, ringIndex) {
          var ring = []; for (var i = 0; i <= 96; i++) { var angle = i / 96 * PI * 2; ring.push([Math.cos(angle) * radius, 0.028, Math.sin(angle) * radius]); }
          line(ring, 'rgba(65,94,76,' + (ringIndex ? '.13' : '.18') + ')', !!ringIndex);
          var a = -75 * PI / 180;
          label(ringIndex ? Number((scaleMax / 2).toFixed(3)) + '%' : '0', [Math.cos(a) * radius, 0.045, Math.sin(a) * radius], fontSize + 'px Consolas,monospace', '#7a8a78');
        });
        for (var month = 0; month < 12; month++) { var a = month / 12 * PI * 2 - PI / 2; label((month + 1) + '月', [Math.cos(a) * 3.53, 0.03, Math.sin(a) * 3.53], (small ? 11 : 13) + 'px "Microsoft YaHei",sans-serif', null, true); }
        label(selectedYear || '—', [0, 0.07, 0], (small ? 28 : 32) + 'px Georgia,serif', '#253d36');
      } else if (mode === 'strata') {
        var backZ = -(years.length - 1) / 2 * yearSpacing() - 0.30, axisX = -3.28;
        line([[axisX, 0.025, backZ], [axisX, 1.775, backZ]], 'rgba(65,94,76,.34)');
        [0, 0.5, 1].forEach(function (fraction) {
          var level = 0.025 + fraction * 1.75, p = project([axisX, level, backZ]);
          line([[axisX, level, backZ], [2.76, level, backZ]], 'rgba(65,94,76,' + (fraction ? '.14' : '.22') + ')', fraction > 0);
          line([[axisX - 0.06, level, backZ], [axisX + 0.06, level, backZ]], 'rgba(65,94,76,.36)');
          if (p && p.visible && p.x > 27 && p.y > 14 && p.y < height - 14) {
            ctx.save(); ctx.font = fontSize + 'px Consolas,monospace'; ctx.textAlign = 'right'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(243,240,231,.92)'; ctx.fillStyle = '#61796a';
            var text = Number((scaleMax * fraction).toFixed(3)).toString(); ctx.strokeText(text, p.x - 8, p.y); ctx.fillText(text, p.x - 8, p.y); ctx.restore();
          }
        });
        label('ILI%', [axisX, 2.02, backZ], fontSize + 'px Consolas,monospace', '#61796a');
        for (var month = 0; month < 12; month++) label((month + 1) + '月', [(month - 5.5) * 0.48, 0.03, (years.length - 1) / 2 * yearSpacing() + 0.40]);
        years.forEach(function (year, yi) { label(year, [-3.02, 0.03, (yi - (years.length - 1) / 2) * yearSpacing()]); });
      } else {
        records.filter(function (record) { return record.year === selectedYear; }).forEach(function (record) { var p = mixArray(record.fromPosition, record.toPosition, blend); p[1] += 0.25; label((record.month + 1) + '月', p); });
      }
      ctx.textAlign = 'right'; ctx.font = fontSize + 'px Consolas,monospace'; ctx.fillStyle = '#61796a'; ctx.fillText('ILI%  0—' + Number(scaleMax.toFixed(3)), width - 20, 22);
      if (!records.length) { ctx.textAlign = 'center'; ctx.fillText('暂无可用月度记录', width / 2, height / 2); }
    }
    function render(now, captureOnly) {
      frameId = 0; if (!available || disposed || (!active && !captureOnly)) return;
      var blend = blendAt(now), strata = mix(strataFrom, strataTo, blend); monthWeights.set(monthMixAt(now)); matrices();
      gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer); gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.1, 1.0);
      if (records.length) { use(gpu.leafDepth, lightVP, blend, strata, false); gl.bindVertexArray(gpu.leafVAO); gl.drawElementsInstanced(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_SHORT, 0, records.length); }
      if (strata > 0.001 && gpu.ridgeCount) { use(gpu.ridgeDepth, lightVP, blend, strata, false); gl.bindVertexArray(gpu.ridgeVAO); gl.drawArrays(gl.TRIANGLES, 0, gpu.ridgeCount); }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gpu.shadow);
      use(gpu.floor, viewProjection, blend, strata, true); gl.bindVertexArray(gpu.floorVAO); gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (records.length) { use(gpu.leaf, viewProjection, blend, strata, false); gl.bindVertexArray(gpu.leafVAO); gl.drawElementsInstanced(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_SHORT, 0, records.length); }
      if (strata > 0.001 && gpu.ridgeCount) {
        if (strata < 0.999) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
        use(gpu.ridge, viewProjection, blend, strata, false, strata); gl.bindVertexArray(gpu.ridgeVAO); gl.drawArrays(gl.TRIANGLES, 0, gpu.ridgeCount); gl.depthMask(true); gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null); drawLabels(blend);
      if (animating && now - startTime >= DURATION) animating = false;
      if (monthAnimating && monthNow(now) - monthStart >= monthDuration) { monthAnimating = false; monthFrom.set(monthTo); }
      if ((animating || monthAnimating) && !captureOnly) schedule();
    }
    function resize() {
      if (disposed || !element || element.clientWidth < 16 || element.clientHeight < 16) return; width = element.clientWidth; height = element.clientHeight;
      fitCamera(false);
      dpr = Math.min(1.75, window.devicePixelRatio || 1); canvas.width = labels.width = Math.round(width * dpr); canvas.height = labels.height = Math.round(height * dpr); schedule();
    }
    function picked(clientX, clientY) {
      if (!available || !viewProjection) return null;
      var rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top, best = null, bestScore = Infinity, blend = blendAt(window.performance.now());
      records.forEach(function (record, index) {
        var p = mixArray(record.fromPosition, record.toPosition, blend), shape = mixArray(record.fromShape, record.toShape, blend);
        var tip = [p[0] + Math.cos(shape[3]) * shape[0], p[1] + shape[0] * 0.10, p[2] + Math.sin(shape[3]) * shape[0]];
        p[1] += shape[2] * 0.5; var a = project(p), b = project(tip); if (!a || !b || (!a.visible && !b.visible)) return;
        var dx = b.x - a.x, dy = b.y - a.y, t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        var distance = Math.hypot(x - a.x - dx * t, y - a.y - dy * t), threshold = mode === 'corolla' ? 10 : 13;
        var score = distance + Math.max(0, a.depth) * 0.7;
        if (distance < threshold && score < bestScore) { best = index; bestScore = score; }
      });
      return best;
    }
    function hover(index, event) {
      var changed = hovered !== index; hovered = index; canvas.style.cursor = index == null ? 'grab' : 'pointer';
      var record = index == null ? null : records[index];
      if (changed || record) notify(callbacks.onHover, record ? {year: record.year, month: record.month + 1, value: record.value, zero: record.value === 0, x: event ? event.clientX : null, y: event ? event.clientY : null} : null);
      if (changed) schedule();
    }
    function pointerDown(event) {
      if (!available || !active || event.button > 0) return; event.preventDefault();
      pointerMap.set(event.pointerId, {x: event.clientX, y: event.clientY}); if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
      if (!gesture) gesture = {x: event.clientX, y: event.clientY, moved: false, multi: false, pinch: 0};
      if (pointerMap.size > 1) { gesture.multi = true; var pts = Array.from(pointerMap.values()); gesture.pinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y); }
      hover(null); canvas.style.cursor = 'grabbing';
    }
    function pointerMove(event) {
      if (!available || !active) return;
      if (!pointerMap.has(event.pointerId)) { hover(picked(event.clientX, event.clientY), event); return; }
      event.preventDefault(); var prior = pointerMap.get(event.pointerId); pointerMap.set(event.pointerId, {x: event.clientX, y: event.clientY});
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) gesture.moved = true;
      if (pointerMap.size > 1) {
        var pts = Array.from(pointerMap.values()), distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (gesture.pinch > 0 && distance > 0) camera.distance = clamp(camera.distance * gesture.pinch / distance, 5.2, Math.max(20, fitReferenceDistance * 2));
        gesture.pinch = distance;
      } else { camera.yaw -= (event.clientX - prior.x) * 0.008; camera.pitch = clamp(camera.pitch + (event.clientY - prior.y) * 0.006, 0.20, 1.46); }
      schedule();
    }
    function pointerEnd(event) {
      if (!pointerMap.has(event.pointerId)) return;
      var shouldSelect = gesture && !gesture.moved && !gesture.multi && event.type === 'pointerup'; pointerMap.delete(event.pointerId);
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!pointerMap.size) { gesture = null; canvas.style.cursor = 'grab'; }
      if (shouldSelect) { var index = picked(event.clientX, event.clientY); if (index != null) notifySelection(records[index]); }
    }
    function notifySelection(record) { if (typeof callbacks.onSelect === 'function') callbacks.onSelect(record.year, record.month + 1); }
    function wheel(event) { if (!active || !available) return; event.preventDefault(); camera.distance = clamp(camera.distance * Math.exp(clamp(event.deltaY, -300, 300) * 0.0012), 5.2, Math.max(20, fitReferenceDistance * 2)); schedule(); }
    function pointerLeave() { if (!pointerMap.size) hover(null); }
    function contextLost(event) { event.preventDefault(); fail('图形上下文暂时丢失，正在等待恢复。'); }
    function contextRestored() {
      if (disposed) return;
      try { initialize(); resumeMonth(window.performance.now()); upload(); resize(); info(); } catch (_) { fail('图形上下文恢复失败，请使用二维季候图谱。'); }
    }
    function reset() { camera = {yaw: 0.28, pitch: 0.86, distance: 8.6}; fitCamera(true); schedule(); }
    function setMonth(value, options) {
      if (disposed) return;
      var next = value == null ? null : (Number.isInteger(+value) && +value >= 1 && +value <= 12 ? +value : null);
      options = options || {};
      var duration = Number.isFinite(options.duration) ? clamp(options.duration, 0, 2000) : MONTH_DURATION;
      var immediate = reduced || options.immediate || options.animate === false || duration === 0;
      // Repeated frame notifications must not restart an in-flight transition.
      if (next === monthFocus && !immediate) return;
      var now = window.performance.now(); monthFrom.set(monthMixAt(now)); monthFocus = next;
      for (var i = 0; i < 12; i++) monthTo[i] = next == null || i === next - 1 ? 1 : 0;
      monthStart = monthNow(now); monthDuration = duration;
      monthAnimating = !immediate && monthFrom.some(function (value, index) { return Math.abs(value - monthTo[index]) > 0.00001; });
      if (!monthAnimating) { monthFrom.set(monthTo); monthWeights.set(monthTo); }
      schedule();
    }
    function setActive(value) {
      if (disposed || active === !!value) return; active = !!value;
      if (!active) { pausedAt = window.performance.now(); pauseMonth(pausedAt); stop(); hover(null); pointerMap.clear(); gesture = null; }
      else { var now = window.performance.now(); if (pausedAt && animating) startTime += now - pausedAt; pausedAt = 0; resumeMonth(now); schedule(); }
    }
    function capture() {
      if (!available || disposed) return null;
      try {
        stop(); render(window.performance.now(), true); var output = document.createElement('canvas'); output.width = canvas.width; output.height = canvas.height;
        var outputContext = output.getContext('2d'); outputContext.drawImage(canvas, 0, 0); outputContext.drawImage(labels, 0, 0);
        var image = output.toDataURL('image/png'); if (animating || monthAnimating) schedule(); return image;
      } catch (_) { return null; }
    }
    function dispose() {
      if (disposed) return; disposed = true; stop(); if (observer) observer.disconnect();
      if (motionQuery && typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', motionChanged);
      else if (motionQuery && typeof motionQuery.removeListener === 'function') motionQuery.removeListener(motionChanged);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerEnd); canvas.removeEventListener('pointercancel', pointerEnd); canvas.removeEventListener('pointerleave', pointerLeave); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
      if (gl && gpu && !gl.isContextLost()) {
        ['leaf', 'ridge', 'floor', 'leafDepth', 'ridgeDepth'].forEach(function (key) { gl.deleteProgram(gpu[key].program); });
        ['parameterBuffer', 'indexBuffer', 'instanceBuffer', 'ridgeBuffer', 'floorBuffer'].forEach(function (key) { gl.deleteBuffer(gpu[key]); });
        ['leafVAO', 'ridgeVAO', 'floorVAO'].forEach(function (key) { gl.deleteVertexArray(gpu[key]); }); gl.deleteTexture(gpu.shadow); gl.deleteFramebuffer(gpu.framebuffer);
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas); if (labels.parentNode) labels.parentNode.removeChild(labels); records = []; available = false;
    }
    function getState() { return {mode: mode, camera: Object.assign({}, camera), pointCount: records.length, available: available && !disposed,
      animating: (animating || monthAnimating) && active && available, monthAnimating: monthAnimating && active && available,
      monthMix: Array.from(monthMixAt(window.performance.now())), month: monthFocus, scaleMax: scaleMax, renderer: 'WebGL 2', ridgeVertexCount: gpu ? gpu.ridgeCount || 0 : 0}; }
    var controller = {update: update, setMode: setMode, setMonth: setMonth, reset: reset, setActive: setActive, resize: resize, capture: capture, dispose: dispose, getState: getState};
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerEnd); canvas.addEventListener('pointercancel', pointerEnd); canvas.addEventListener('pointerleave', pointerLeave); canvas.addEventListener('wheel', wheel, {passive: false}); canvas.addEventListener('webglcontextlost', contextLost, false); canvas.addEventListener('webglcontextrestored', contextRestored, false);
    if (motionQuery && typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', motionChanged);
    else if (motionQuery && typeof motionQuery.addListener === 'function') motionQuery.addListener(motionChanged);
    try {
      if (!element) throw new Error('标本容器不存在'); initialize(); resize(); info();
      if (window.ResizeObserver) { observer = new window.ResizeObserver(resize); observer.observe(element); }
    } catch (_) { fail('此设备无法运行 WebGL 2，已保留二维图谱。'); }
    return controller;
  }
  window.FluSpecimen = {create: create};
})(window, document);

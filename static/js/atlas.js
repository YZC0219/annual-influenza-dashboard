/* 原创 SVG 季候图谱。花瓣长度采用跨年份统一的 ILI% 标尺，环形位置只表示月份。 */
(function (window, document) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var mounted = Object.create(null);
  var serial = 0;
  var INK = '#253d36', MUTED = '#779084', PAPER = '#f3f0e7', RED = '#b75a48';
  var PALETTE = ['#31594b', '#88a99c', '#c3a49e', '#b99b62', '#b75a48', '#6d8085', '#958a6d', '#8b7581'];
  var CX = 360, CY = 330, BASE = 110, RANGE = 148;
  var MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  function svgNode(tag, attributes, text) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attributes || {}).forEach(function (key) { node.setAttribute(key, String(attributes[key])); });
    if (text != null) node.textContent = String(text);
    return node;
  }

  function htmlNode(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function add(parent, tag, attributes, text) {
    var node = svgNode(tag, attributes, text);
    parent.appendChild(node);
    return node;
  }

  function valueOf(input) {
    return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
  }

  function point(angle, radius) {
    var radians = angle * Math.PI / 180;
    return {x: CX + Math.cos(radians) * radius, y: CY + Math.sin(radians) * radius};
  }

  function round(value) { return +value.toFixed(3); }
  function format(value) { return Number.isInteger(value) ? String(value) : String(+value.toFixed(2)); }

  function yearOffset(index, count) {
    return count <= 1 ? 0 : (index - (count - 1) / 2) * Math.min(3.8, 22 / (count - 1));
  }

  function scaleFor(highest) {
    if (!highest) return {max: 10, step: 2.5};
    var rough = highest / 4;
    var power = Math.pow(10, Math.floor(Math.log10(rough)));
    var base = rough / power;
    var choice = [1, 2, 2.5, 5, 10].filter(function (step) { return step >= base; })[0] || 10;
    var step = choice * power;
    return {max: Math.ceil(highest / step) * step, step: step};
  }

  function petalPath(length, width) {
    var end = BASE + length;
    var head = Math.min(width / 2, length / 2);
    var stem = Math.min(width * 0.32, length / 2);
    return 'M 0 ' + -BASE +
      ' Q ' + -stem + ' ' + -BASE + ' ' + -stem + ' ' + (-BASE - stem) +
      ' L ' + -head + ' ' + (-end + head) +
      ' Q ' + -head + ' ' + -end + ' 0 ' + -end +
      ' Q ' + head + ' ' + -end + ' ' + head + ' ' + (-end + head) +
      ' L ' + stem + ' ' + (-BASE - stem) +
      ' Q ' + stem + ' ' + -BASE + ' 0 ' + -BASE + ' Z';
  }

  function remove(record) {
    if (record && record.root.parentNode) record.root.parentNode.removeChild(record.root);
  }

  function tooltipFor(root) {
    var tip = htmlNode('div', 'atlas-tooltip');
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
    tip.style.position = 'absolute';
    tip.style.pointerEvents = 'none';
    tip.style.whiteSpace = 'pre-line';
    tip.style.zIndex = '4';
    root.appendChild(tip);
    function show(message, event, target) {
      tip.textContent = message;
      tip.hidden = false;
      var bounds = root.getBoundingClientRect();
      var anchor = target.getBoundingClientRect();
      var x = typeof event.clientX === 'number' ? event.clientX - bounds.left : anchor.left - bounds.left + anchor.width / 2;
      var y = typeof event.clientY === 'number' ? event.clientY - bounds.top : anchor.top - bounds.top;
      var width = tip.offsetWidth || 190;
      var height = tip.offsetHeight || 58;
      tip.style.left = Math.max(8, Math.min(x + 14, bounds.width - width - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(y - height - 12, bounds.height - height - 8)) + 'px';
    }
    return {show: show, hide: function () { tip.hidden = true; }};
  }

  function render(elementId, payload) {
    var element = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    if (!element) return null;
    payload = payload || {};
    var key = element.id || 'flu-atlas';
    remove(mounted[key]);
    var root = htmlNode('div', 'atlas-root');
    root.style.position = 'relative';
    element.appendChild(root);
    mounted[key] = {root: root};
    var rows = payload.series || [];
    var yearList = Array.isArray(payload.years) ? payload.years : rows.map(function (row) { return row.year; });
    var years = yearList.map(String).filter(function (year, index, all) { return all.indexOf(year) === index; });
    var series = years.map(function (year) {
      var row = rows.filter(function (candidate) { return String(candidate.year) === year; })[0];
      return {year: year, values: Array.from({length: 12}, function (_, month) { return row && Array.isArray(row.values) ? valueOf(row.values[month]) : null; })};
    });
    var selected = years.indexOf(String(payload.selectedYear)) >= 0 ? String(payload.selectedYear) : years[years.length - 1];
    var selectedIndex = years.indexOf(selected);
    var chosen = series[selectedIndex] || {values: []};
    var highest = series.reduce(function (maximum, row) {
      return row.values.reduce(function (max, value) { return value == null ? max : Math.max(max, value); }, maximum);
    }, 0);
    var scale = scaleFor(highest);
    var peak = null;
    chosen.values.forEach(function (value, month) {
      if (value != null && (!peak || value > peak.value)) peak = {month: month, value: value};
    });
    var topMonths = chosen.values.map(function (value, month) { return {value: value, month: month}; })
      .filter(function (entry) { return entry.value != null && entry.value > 0; })
      .sort(function (a, b) { return b.value - a.value || a.month - b.month; }).slice(0, 3)
      .map(function (entry) { return entry.month; });

    var id = 'seasonal-atlas-' + (++serial);
    var svg = add(root, 'svg', {viewBox: '0 0 720 680', width: '100%', class: 'atlas-svg', role: 'group',
      'aria-labelledby': id + '-title ' + id + '-desc', preserveAspectRatio: 'xMidYMid meet'});
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    add(svg, 'title', {id: id + '-title'}, '流感年度季候图谱');
    add(svg, 'desc', {id: id + '-desc'}, '月份绕环排列，颜色区分年份。所有年份共用线性 ILI% 长度标尺，从标记为零的内环起计，不是构成占比。空心圆表示零，缺测不绘制。可用 Tab 聚焦花瓣，按回车或空格联动年月。');
    var guide = add(svg, 'g', {class: 'atlas-guides', 'aria-hidden': 'true'});

    // 留白与细线组成刻度，所有年度使用同一长度标尺。
    var ringCount = Math.round(scale.max / scale.step);
    for (var step = 0; step <= ringCount; step++) {
      var value = scale.step * step;
      var radius = BASE + RANGE * step / ringCount;
      add(guide, 'circle', {cx: CX, cy: CY, r: radius, fill: 'none', stroke: step === 0 ? '#738c7e' : '#a8b7aa',
        'stroke-width': step === 0 ? 0.85 : 0.65, 'stroke-opacity': step === 0 ? 0.52 : 0.3,
        'stroke-dasharray': step === 0 ? 'none' : '1 5'});
      var tickPoint = point(-75, radius);
      add(guide, 'text', {x: round(tickPoint.x + 5), y: round(tickPoint.y - 2), fill: MUTED,
        'font-family': 'Consolas, monospace', 'font-size': 12, 'paint-order': 'stroke', stroke: PAPER,
        'stroke-width': 4, 'stroke-linejoin': 'round'}, format(value));
    }
    var unitPoint = point(-75, BASE + RANGE + 13);
    add(guide, 'text', {x: round(unitPoint.x + 7), y: round(unitPoint.y - 3), fill: MUTED, 'font-size': 12}, 'ILI%');

    // 外围刻度如纸面量规，不添加虚构观测。
    for (var tick = 0; tick < 72; tick++) {
      var tickAngle = tick * 5 - 90;
      var inner = point(tickAngle, tick % 6 === 0 ? 268 : 271);
      var outer = point(tickAngle, 274);
      add(guide, 'line', {x1: round(inner.x), y1: round(inner.y), x2: round(outer.x), y2: round(outer.y),
        stroke: '#7f998b', 'stroke-width': tick % 6 === 0 ? 1 : 0.7, 'stroke-opacity': tick % 6 === 0 ? 0.65 : 0.25});
    }
    MONTHS.forEach(function (month, monthIndex) {
      var angle = monthIndex * 30 - 90;
      var position = point(angle, 293);
      var dividerStart = point(angle + 15, BASE - 3);
      var dividerEnd = point(angle + 15, 263);
      add(guide, 'line', {x1: round(dividerStart.x), y1: round(dividerStart.y), x2: round(dividerEnd.x), y2: round(dividerEnd.y),
        stroke: '#9eafa3', 'stroke-opacity': 0.13, 'stroke-width': 0.7});
      add(guide, 'text', {x: round(position.x), y: round(position.y), 'text-anchor': 'middle',
        'dominant-baseline': 'middle', fill: INK, 'font-size': 16, 'font-family': 'Songti SC, SimSun, serif', 'letter-spacing': 1}, month);
    });
    [{label: '冬 季', angle: -90}, {label: '春 季', angle: 0}, {label: '夏 季', angle: 90}, {label: '秋 季', angle: 180}].forEach(function (season) {
      var position = point(season.angle, 321);
      add(guide, 'text', {x: round(position.x), y: round(position.y), 'text-anchor': 'middle',
        'dominant-baseline': 'middle', fill: '#8c9a8d', 'font-size': 12, 'letter-spacing': 3}, season.label);
    });

    var tooltip = tooltipFor(root);
    var dataLayer = add(svg, 'g', {class: 'atlas-data'});
    var angularGap = years.length <= 1 ? 3.8 : Math.min(3.8, 22 / (years.length - 1));
    var width = Math.min(7.4, Math.max(0.7, BASE * angularGap * Math.PI / 180 * 0.82));
    series.forEach(function (row, yearIndex) {
      var active = row.year === selected;
      var color = PALETTE[yearIndex % PALETTE.length];
      row.values.forEach(function (value, month) {
        if (value == null) return;
        var angle = month * 30 - 90 + yearOffset(yearIndex, years.length);
        var length = value / scale.max * RANGE;
        var text = row.year + ' 年 · ' + (month + 1) + ' 月\nILI：' + value.toFixed(2) + '%' + (value === 0 ? '（有效零值）' : '');
        var group = add(dataLayer, 'g', {class: 'atlas-point' + (active ? ' atlas-point-selected' : ''),
          transform: 'translate(' + CX + ' ' + CY + ') rotate(' + round(angle + 90) + ')',
          tabindex: 0, role: 'button', 'aria-label': text.replace('\n', '，') + '，选择该年月',
          'data-year': row.year, 'data-month': month + 1, 'data-value': value, 'data-scale-max': scale.max});
        group.style.cursor = 'pointer';
        add(group, 'title', {}, text);
        if (value === 0) {
          add(group, 'circle', {cx: 0, cy: -BASE, r: 3.2, fill: PAPER, stroke: color,
            'stroke-width': active ? 1.6 : 1.1, opacity: active ? 1 : 0.55, class: 'atlas-zero'});
          add(group, 'circle', {cx: 0, cy: -BASE, r: 8, fill: 'transparent', class: 'atlas-hit'});
        } else {
          add(group, 'path', {d: petalPath(length, width), fill: color, opacity: active ? 0.98 : 0.53,
            stroke: active ? INK : color, 'stroke-opacity': active ? 0.35 : 0.15, 'stroke-width': active ? 0.6 : 0.25,
            class: 'atlas-petal'});
          add(group, 'path', {d: 'M 0 ' + (-BASE - Math.min(length / 2, 5)) + ' L 0 ' + (-BASE - length + Math.min(length / 2, 5)),
            fill: 'none', stroke: 'transparent', 'stroke-width': Math.min(14, Math.max(width, angularGap * 2)),
            'stroke-linecap': 'round', class: 'atlas-hit'});
        }
        function choose() { tooltip.hide(); if (typeof payload.onSelect === 'function') payload.onSelect(row.year, month + 1); }
        group.addEventListener('click', choose);
        group.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); choose(); }
        });
        group.addEventListener('pointerenter', function (event) { tooltip.show(text, event, group); });
        group.addEventListener('pointermove', function (event) { tooltip.show(text, event, group); });
        group.addEventListener('pointerleave', tooltip.hide);
        group.addEventListener('focus', function (event) { tooltip.show(text, event, group); });
        group.addEventListener('blur', tooltip.hide);

        if (active && topMonths.indexOf(month) >= 0) {
          var endpoint = point(angle, BASE + length + 6);
          add(guide, 'circle', {cx: round(endpoint.x), cy: round(endpoint.y), r: 1.7, fill: RED});
        }
      });
    });

    var center = add(svg, 'g', {class: 'atlas-center', 'aria-hidden': 'true'});
    add(center, 'circle', {cx: CX, cy: CY, r: 86, fill: PAPER, 'fill-opacity': 0.85});
    add(center, 'text', {x: CX, y: CY - 46, 'text-anchor': 'middle', fill: MUTED, 'font-size': 12, 'letter-spacing': 3}, '年度季候档案');
    add(center, 'text', {x: CX, y: CY + 9, 'text-anchor': 'middle', fill: INK,
      'font-family': 'Georgia, Times New Roman, serif', 'font-size': 65, 'font-weight': 400, 'letter-spacing': -2}, selected || '—');
    add(center, 'text', {x: CX, y: CY + 39, 'text-anchor': 'middle', fill: INK,
      'font-family': 'Songti SC, SimSun, serif', 'font-size': 16, 'letter-spacing': 5}, '季候观察');
    var scope = String(payload.scope || '全国 / 全部年龄');
    add(center, 'text', {x: CX, y: CY + 65, 'text-anchor': 'middle', fill: MUTED, 'font-size': 12}, scope.length > 21 ? scope.slice(0, 20) + '…' : scope);

    // 仅为所选年度的真实最高月添加注记；并列时按最早月份。
    if (peak && peak.value > 0) {
      var peakAngle = peak.month * 30 - 90 + yearOffset(selectedIndex, years.length);
      var peakPoint = point(peakAngle, BASE + peak.value / scale.max * RANGE + 7);
      var elbow = point(peakAngle, 275);
      var right = elbow.x >= CX;
      var endX = right ? Math.min(662, elbow.x + 47) : Math.max(58, elbow.x - 47);
      var annotation = add(svg, 'g', {class: 'atlas-peak', 'aria-hidden': 'true'});
      add(annotation, 'path', {d: 'M ' + round(peakPoint.x) + ' ' + round(peakPoint.y) + ' L ' + round(elbow.x) + ' ' + round(elbow.y) + ' L ' + round(endX) + ' ' + round(elbow.y),
        fill: 'none', stroke: RED, 'stroke-width': 0.8, 'stroke-opacity': 0.7});
      add(annotation, 'text', {x: round(endX), y: round(elbow.y - 9), fill: RED, 'font-size': 12,
        'text-anchor': right ? 'end' : 'start', 'paint-order': 'stroke', stroke: PAPER, 'stroke-width': 5, 'stroke-linejoin': 'round'}, '最高月 · ' + (peak.month + 1) + '月');
      add(annotation, 'text', {x: round(endX), y: round(elbow.y + 17), fill: INK, 'font-size': 14,
        'font-family': 'Consolas, monospace', 'text-anchor': right ? 'end' : 'start',
        'paint-order': 'stroke', stroke: PAPER, 'stroke-width': 5, 'stroke-linejoin': 'round'}, peak.value.toFixed(2) + '%');
    }

    var legend = htmlNode('div', 'atlas-legend');
    legend.setAttribute('aria-label', '按年份选择');
    series.forEach(function (row, index) {
      var button = htmlNode('button', 'atlas-year' + (row.year === selected ? ' is-selected' : ''));
      button.type = 'button';
      button.setAttribute('aria-pressed', row.year === selected ? 'true' : 'false');
      button.setAttribute('aria-label', '选择 ' + row.year + ' 年');
      var swatch = htmlNode('span', 'atlas-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.backgroundColor = PALETTE[index % PALETTE.length];
      button.appendChild(swatch);
      button.appendChild(htmlNode('span', '', row.year));
      button.addEventListener('click', function () { if (typeof payload.onSelect === 'function') payload.onSelect(row.year, null); });
      legend.appendChild(button);
    });
    root.appendChild(legend);
    var note = htmlNode('p', 'atlas-reading', '统一刻度 0—' + format(scale.max) + '% · 花瓣长度从零值内环起计 · 空心圆为 0 · 缺测不绘制');
    root.appendChild(note);
    root.appendChild(htmlNode('p', 'atlas-source', '据当前数据集月度 ILI% 绘制；朱砂端点标记所选年最高的三个非零月份。年份颜色仅作区分，环形不表示构成占比。'));
    if (!series.length || !series.some(function (row) { return row.values.some(function (value) { return value != null; }); })) {
      root.appendChild(htmlNode('p', 'atlas-empty', '当前数据没有可用月度记录，缺测位置已保留。'));
    }
    return svg;
  }

  function clear() {
    Object.keys(mounted).forEach(function (key) { remove(mounted[key]); delete mounted[key]; });
  }

  window.FluAtlas = {render: render, clear: clear};
})(window, document);

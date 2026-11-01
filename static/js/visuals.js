/* 图表层只负责呈现；计算与数据来源由 charts.js 统一管理。全部资源来自本地。 */
(function (window) {
  'use strict';

  var instances = Object.create(null);
  var colors = {
    mint: '#476c56', amber: '#b75a48', text: '#596f5e', bright: '#3d5b42',
    line: '#c9d2be', muted: '#9db09a', surface: '#f3f0e7'
  };
  var camera = {
    alpha: 30, beta: 25, distance: 155, minDistance: 105, maxDistance: 270,
    rotateSensitivity: 1, zoomSensitivity: 1, panSensitivity: 0,
    autoRotate: false, animation: false, animationDurationUpdate: 0
  };
  var webglAvailable;
  var motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reducedMotion = !!(motionQuery && motionQuery.matches);

  function motionSettings() {
    return {animation: !reducedMotion, animationDurationUpdate: reducedMotion ? 0 : 800};
  }

  function applyMotion(option) {
    Object.assign(option, motionSettings());
    (option.series || []).forEach(function (series) { Object.assign(series, motionSettings()); });
    if (option.grid3D) {
      // ECharts GL keeps earlier OrbitControl animators alive after immediate updates.
      // Keep programmatic camera changes static; manual rotation and zoom remain available.
      option.grid3D.viewControl = Object.assign({}, option.grid3D.viewControl, {animation: false, animationDurationUpdate: 0});
    }
    return option;
  }

  function updateMotion(event) {
    reducedMotion = !!event.matches;
    Object.keys(instances).forEach(function (key) {
      var record = instances[key];
      if (record.chart.isDisposed()) return;
      var option = {series: (record.chart.getOption().series || []).map(function (series) { return {id: series.id}; })};
      if (record.name === 'matrix' && !record.fallback) option.grid3D = {};
      record.chart.setOption(applyMotion(option));
    });
  }
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', updateMotion);
    else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(updateMotion);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
    });
  }

  function number(value) {
    if (value == null || value === '') return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function percent(value) {
    var parsed = number(value);
    return parsed == null ? '暂无数据' : parsed.toFixed(2) + '%';
  }

  function maxValue(values) {
    return values.reduce(function (max, value) {
      var parsed = number(value);
      return parsed == null ? max : Math.max(max, parsed);
    }, 0);
  }

  function base() {
    return {
      animation: true, animationDuration: 0, animationDurationUpdate: 800,
      animationEasingUpdate: 'cubicOut', backgroundColor: 'transparent',
      textStyle: {fontFamily: 'Microsoft YaHei, sans-serif', color: colors.text, fontSize: 12},
      aria: {enabled: true},
      grid: {left: 14, right: 24, top: 38, bottom: 16, containLabel: true},
      tooltip: {
        trigger: 'axis', confine: true, backgroundColor: '#fcfaf2',
        borderColor: '#b3c0a8', borderWidth: 1, padding: [10, 13],
        textStyle: {fontSize: 12, color: colors.bright},
        extraCssText: 'box-shadow:0 5px 18px rgba(40,60,35,.08);border-radius:0;',
        axisPointer: {type: 'line', lineStyle: {color: '#668c7c', type: 'dashed'}}
      }
    };
  }

  function categoryAxis(data) {
    return {
      type: 'category', data: data || [], boundaryGap: false,
      axisLine: {lineStyle: {color: colors.line}}, axisTick: {show: false},
      axisLabel: {color: colors.text, fontSize: 12, margin: 13, hideOverlap: true},
      splitLine: {show: false}
    };
  }

  function valueAxis(name) {
    return {
      type: 'value', name: name || 'ILI（%）', nameTextStyle: {color: colors.text, fontSize: 12, padding: [0, 0, 8, 0]},
      min: 0, splitNumber: 4, axisLine: {show: false}, axisTick: {show: false},
      axisLabel: {color: colors.text, fontSize: 12},
      splitLine: {lineStyle: {color: 'rgba(94,120,83,.15)', type: 'dashed'}}
    };
  }

  function lineSeries(id, name, data, color, dashed) {
    return {
      id: id, name: name, type: 'line', data: data.map(number),
      smooth: 0.28, connectNulls: false, showSymbol: false, symbol: 'circle', symbolSize: 6,
      lineStyle: {width: dashed ? 2 : 3, color: color, type: dashed ? 'dashed' : 'solid'},
      itemStyle: {color: color, borderColor: colors.surface, borderWidth: 2},
      emphasis: {focus: 'series', scale: true},
      animationDurationUpdate: 800
    };
  }

  function axisTooltip(params) {
    var points = Array.isArray(params) ? params : [params];
    if (!points.length) return '';
    return '<b>' + escapeHtml(points[0].axisValueLabel || points[0].name) + '</b>' + points.map(function (point) {
      if (number(point.value) == null) return '';
      return '<div style="margin-top:7px">' + point.marker + escapeHtml(point.seriesName) +
        '<span style="margin-left:22px;float:right;font-family:Consolas,monospace">' + percent(point.value) + '</span></div>';
    }).join('');
  }

  function trend(payload) {
    var option = base();
    option.grid.top = 40;
    option.xAxis = categoryAxis(payload.months);
    option.yAxis = valueAxis();
    option.tooltip.formatter = axisTooltip;
    option.legend = {
      top: 0, right: 12, itemWidth: 20, itemHeight: 8, icon: 'roundRect',
      textStyle: {color: colors.text, fontSize: 12}, selectedMode: false
    };
    var current = lineSeries('selected-year', String(payload.year) + ' 年', payload.current || [], colors.mint, false);
    current.areaStyle = {
      color: {type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{offset: 0, color: 'rgba(89,125,88,.13)'}, {offset: 1, color: 'rgba(89,125,88,0)'}]}
    };
    if (number(payload.threshold) != null) {
      current.markLine = {
        silent: true, symbol: 'none',
        lineStyle: {type: 'dashed', color: 'rgba(183,90,72,.5)', width: 1},
        label: {show: true, position: 'insideEndTop', color: '#aa7d51', fontSize: 12,
          formatter: '演示观察线 ' + payload.threshold + '%'},
        data: [{yAxis: Number(payload.threshold)}]
      };
    } else {
      current.markLine = {data: []};
    }
    option.series = [current];
    if (Array.isArray(payload.previous)) {
      option.series.unshift(lineSeries('previous-year', String(payload.previousYear || '上一') + ' 年', payload.previous, '#a4b59a', true));
    }
    return option;
  }

  function axis3D(name, data) {
    return {
      type: data ? 'category' : 'value', name: name, data: data,
      nameGap: 18, nameTextStyle: {color: colors.text, fontSize: 12},
      axisLabel: {color: colors.text, fontSize: 12, margin: 8, interval: 0},
      axisLine: {lineStyle: {color: '#adbaa1', width: 1}}, axisTick: {show: false},
      splitLine: {show: true, lineStyle: {color: 'rgba(94,120,83,.15)', width: 1}},
      splitArea: {show: false}
    };
  }

  // Leave room for axis labels on portrait screens; reset uses the same framing.
  function fittedMatrixCamera(element) {
    var width = element ? element.clientWidth : 800;
    var distance = width < 480 ? 210 : width < 640 ? 180 : camera.distance;
    var ratio = distance / camera.distance;
    return Object.assign({}, camera, {
      distance: distance, minDistance: camera.minDistance * ratio, maxDistance: camera.maxDistance * ratio
    });
  }

  function refitMatrix(record) {
    if (record.name !== 'matrix' || record.fallback) return;
    var fitted = fittedMatrixCamera(record.element);
    if (record.fitDistance && record.fitDistance !== fitted.distance) {
      var grid = record.chart.getOption().grid3D;
      var current = grid && grid[0] && grid[0].viewControl;
      var ratio = current && number(current.distance) != null ? current.distance / record.fitDistance : 1;
      var distance = Math.max(fitted.minDistance, Math.min(fitted.maxDistance, fitted.distance * ratio));
      // Settle layout changes immediately; an interpolated distance would compound on rapid resizes.
      // Patch distance only so user rotation and zoom relative to available space survive.
      record.chart.setOption({grid3D: {viewControl: {
        animation: false, animationDurationUpdate: 0,
        distance: distance, minDistance: fitted.minDistance, maxDistance: fitted.maxDistance
      }}, xAxis3D: {name: record.element.clientWidth < 480 ? '' : '地区'},
        yAxis3D: {name: record.element.clientWidth < 480 ? '' : '年度'},
        zAxis3D: {name: record.element.clientWidth < 480 ? 'ILI%' : 'ILI（%）'}});
    }
    record.fitDistance = fitted.distance;
  }

  function matrix(payload, initial, element) {
    var option = base();
    option.tooltip.trigger = 'item';
    option.tooltip.formatter = function (point) {
      var value = point.value || [];
      return '<b>' + escapeHtml((payload.regions || [])[value[0]]) + '</b> · ' +
        escapeHtml((payload.years || [])[value[1]]) + ' 年<br>ILI：' + percent(value[2]);
    };
    option.xAxis3D = axis3D('地区', payload.regions || []);
    option.yAxis3D = axis3D('年度', payload.years || []);
    option.yAxis3D.nameGap = 42;
    option.zAxis3D = axis3D('ILI（%）');
    if (element && element.clientWidth < 480) {
      option.xAxis3D.name = ''; option.yAxis3D.name = ''; option.zAxis3D.name = 'ILI%';
    }
    option.zAxis3D.min = 0;
    option.grid3D = {
      boxWidth: 120, boxDepth: 65, boxHeight: 40,
      left: 0, right: 0, top: -10, bottom: 0,
      environment: '#e9eadf',
      axisPointer: {show: false},
      light: {main: {intensity: 1.15, shadow: false, alpha: 35, beta: 20}, ambient: {intensity: 0.65}},
      postEffect: {enable: false}, temporalSuperSampling: {enable: false}
    };
    if (initial) option.grid3D.viewControl = fittedMatrixCamera(element);
    var highest = maxValue((payload.data || []).map(function (item) { return item.value[2]; })) || 1;
    option.series = [{
      id: 'region-matrix', name: '年度地区 ILI', type: 'bar3D', shading: 'lambert',
      barSize: [8, 7], minHeight: 0.4, bevelSize: 0.08, bevelSmoothness: 2,
      label: {show: false},
      itemStyle: {opacity: 0.98},
      emphasis: {label: {show: false}, itemStyle: {color: '#d7c0a8'}},
      data: (payload.data || []).map(function (item) {
        var rate = number(item.value[2]);
        var intensity = Math.max(0, Math.min(1, (rate || 0) / highest));
        return {
          value: [item.value[0], item.value[1], rate],
          itemStyle: {color: item.selected ? colors.amber : (intensity > 0.68 ? '#688b68' : intensity > 0.38 ? '#8ba388' : '#b0bba0')}
        };
      })
    }];
    return option;
  }

  function heatmap(payload, isMatrixFallback) {
    var option = base();
    var x = isMatrixFallback ? (payload.regions || []) : (payload.months || []);
    var y = payload.years || [];
    var data = isMatrixFallback ? (payload.data || []).map(function (item) { return item.value; }) : (payload.data || []);
    option.grid = {left: 12, right: 12, top: 10, bottom: isMatrixFallback ? 86 : 68, containLabel: true};
    option.xAxis = categoryAxis(x);
    option.xAxis.boundaryGap = true;
    option.xAxis.axisLabel.interval = 0;
    option.yAxis = categoryAxis(y);
    option.yAxis.boundaryGap = true;
    option.yAxis.axisLabel.margin = 12;
    option.tooltip.trigger = 'item';
    option.tooltip.formatter = function (point) {
      var value = point.value || [];
      return '<b>' + escapeHtml(y[value[1]]) + ' 年 · ' + escapeHtml(x[value[0]]) + '</b><br>ILI：' + percent(value[2]);
    };
    option.visualMap = {
      type: 'piecewise', orient: 'horizontal', left: 'center', bottom: isMatrixFallback ? 32 : 10,
      itemWidth: 11, itemHeight: 11, itemGap: 14, selectedMode: false,
      textStyle: {color: colors.text, fontSize: 12},
      pieces: [
        {min: 0, max: 2, label: '≤ 2%', color: '#dfe6d4'},
        {gt: 2, max: 4, label: '2–4%', color: '#c0d1b5'},
        {gt: 4, max: 6, label: '4–6%', color: '#8daa84'},
        {gt: 6, label: '> 6%', color: '#b7866c'}
      ]
    };
    option.series = [{
      id: isMatrixFallback ? 'region-fallback' : 'season-heatmap', type: 'heatmap',
      data: data.filter(function (point) { return number(point[2]) != null; }),
      itemStyle: {borderColor: '#f3f0e7', borderWidth: 3, borderRadius: 1},
      label: {show: x.length <= 12, color: '#35513b', fontSize: 12,
        formatter: function (point) { return number(point.value[2]).toFixed(1); }},
      emphasis: {itemStyle: {borderColor: colors.mint, borderWidth: 2}, label: {color: colors.bright}}
    }];
    return option;
  }

  function horizontalBars(payload, isAge) {
    var option = base();
    var names = payload.names || [];
    var values = (payload.values || []).map(number);
    option.grid = {left: 12, right: 55, top: 12, bottom: 15, containLabel: true};
    option.xAxis = valueAxis('');
    option.xAxis.name = '';
    option.xAxis.max = Math.max(1, Math.ceil(maxValue(values) * 1.16));
    option.xAxis.axisLabel.formatter = '{value}%';
    option.yAxis = categoryAxis(names);
    option.yAxis.inverse = true;
    option.yAxis.boundaryGap = true;
    option.yAxis.axisLine.show = false;
    option.yAxis.axisLabel.color = colors.bright;
    option.yAxis.axisLabel.fontSize = 12;
    option.tooltip.axisPointer = {type: 'shadow', shadowStyle: {color: 'rgba(90,126,75,.04)'}};
    option.tooltip.formatter = function (points) {
      var point = (Array.isArray(points) ? points : [points])[0];
      if (!point) return '';
      return '<b>' + escapeHtml(point.name) + '</b><br>ILI' + (isAge ? ' 估算值' : '') + '：' + percent(point.value) +
        (isAge ? '<br><span style="color:#9aafa8">按年龄系数估算，非分年龄实测</span>' : '');
    };
    option.series = [{
      id: isAge ? 'age-bars' : 'rank-bars', type: 'bar', name: isAge ? 'ILI 估算值' : 'ILI',
      barMaxWidth: 16, barCategoryGap: '45%', showBackground: true,
      backgroundStyle: {color: 'rgba(154,175,168,.055)', borderRadius: [0, 3, 3, 0]},
      label: {show: true, position: 'right', distance: 10, color: colors.bright, fontSize: 12, fontFamily: 'Consolas, monospace',
        formatter: function (point) { return number(point.value) == null ? '—' : number(point.value).toFixed(2) + '%'; }},
      itemStyle: {borderRadius: [0, 3, 3, 0]},
      emphasis: {itemStyle: {color: '#c4aa82'}},
      data: values.map(function (value, index) {
        return {value: value, itemStyle: {color: names[index] === payload.selected ? colors.amber : colors.mint}};
      })
    }];
    return option;
  }

  function forecast(payload) {
    var option = base();
    var history = (payload.history || []).slice(-36);
    var firstDate = history.length ? String(history[0].date) : '';
    var validation = (payload.validationPoints || []).filter(function (point) { return !firstDate || String(point.date) >= firstDate; });
    var future = payload.forecast || [];
    var dateSet = Object.create(null), actual = Object.create(null), predicted = Object.create(null), projected = Object.create(null);
    history.forEach(function (point) { dateSet[point.date] = true; actual[point.date] = number(point.value); });
    validation.forEach(function (point) {
      dateSet[point.date] = true; predicted[point.date] = number(point.predicted);
      if (!Object.prototype.hasOwnProperty.call(actual, point.date)) actual[point.date] = number(point.actual);
    });
    future.forEach(function (point) { dateSet[point.date] = true; projected[point.date] = number(point.value); });
    var dates = Object.keys(dateSet).sort();
    function aligned(map) { return dates.map(function (date) { return Object.prototype.hasOwnProperty.call(map, date) ? map[date] : null; }); }
    option.grid = {left: 14, right: 26, top: 58, bottom: 16, containLabel: true};
    option.xAxis = categoryAxis(dates);
    option.xAxis.axisLabel.formatter = function (value) {
      var date = String(value);
      return date.length >= 7 ? date.slice(2, 7).replace('-', '/') : date;
    };
    option.yAxis = valueAxis();
    option.tooltip.formatter = axisTooltip;
    option.legend = {top: 0, left: 0, itemWidth: 20, itemHeight: 8, itemGap: 20,
      textStyle: {color: colors.text, fontSize: 12}, selectedMode: false};
    var historicalLine = lineSeries('forecast-history', '历史序列', aligned(actual), colors.mint, false);
    historicalLine.areaStyle = {color: 'rgba(89,125,88,.07)'};
    var validationLine = lineSeries('forecast-validation', '留出集预测', aligned(predicted), '#a9b99d', true);
    validationLine.showSymbol = true;
    validationLine.symbolSize = 4;
    var futureLine = lineSeries('forecast-projection', '未来外推', aligned(projected), colors.amber, true);
    futureLine.showSymbol = true;
    futureLine.symbolSize = 5;
    var boundaries = [];
    if (validation.length) boundaries.push({xAxis: String(validation[0].date), name: '留出验证', label: {position: 'insideEndTop', formatter: '留出验证', color: '#a9b99d'}});
    if (future.length) boundaries.push({xAxis: String(future[0].date), name: '未来外推', label: {position: 'insideEndTop', formatter: '未来外推', color: colors.amber}});
    historicalLine.markLine = {silent: true, symbol: 'none', lineStyle: {color: '#a8b69b', type: 'dashed', width: 1},
      label: {fontSize: 12, distance: 7}, data: boundaries};
    if (future.length && dates.length) {
      futureLine.markArea = {
        silent: true, itemStyle: {color: 'rgba(183,90,72,.05)'}, label: {show: false},
        data: [[{xAxis: String(future[0].date)}, {xAxis: dates[dates.length - 1]}]]
      };
    }
    option.series = [historicalLine, validationLine, futureLine];
    return option;
  }

  function hasWebGL() {
    if (webglAvailable != null) return webglAvailable;
    var canvas = document.createElement('canvas');
    try {
      var context = canvas.getContext('webgl', {failIfMajorPerformanceCaveat: false}) || canvas.getContext('experimental-webgl');
      webglAvailable = !!context;
      if (context) {
        var release = context.getExtension('WEBGL_lose_context');
        if (release) release.loseContext();
      }
    } catch (error) { webglAvailable = false; }
    return webglAvailable;
  }

  function fallbackNote(record, payload, reason) {
    var message = reason || '当前设备不支持 WebGL，已切换为二维地区矩阵。';
    var note = document.createElement('div');
    note.className = 'flu-chart-fallback';
    note.setAttribute('role', 'status');
    note.textContent = message;
    note.style.cssText = 'position:absolute;left:12px;right:12px;bottom:2px;text-align:center;color:#caa365;font-size:12px;line-height:20px;pointer-events:none;';
    record.element.style.position = 'relative';
    record.element.appendChild(note);
    record.note = note;
    if (typeof payload.onFallback === 'function') payload.onFallback(message);
  }

  function bindInteraction(record, payload) {
    record.chart.off('click');
    if (typeof payload.onSelect !== 'function') return;
    record.chart.on('click', function (point) {
      if (point.componentType !== 'series') return;
      if (record.name === 'matrix') {
        if (point.value && point.value.length) payload.onSelect((payload.regions || [])[point.value[0]]);
      } else if (record.name === 'season') {
        if (point.value && point.value.length) payload.onSelect((payload.years || [])[point.value[1]], point.value[0] + 1);
      } else if (record.name === 'age' || record.name === 'rank') {
        payload.onSelect(point.name);
      }
    });
  }

  function render(name, elementId, payload) {
    var element = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    if (!element || !window.echarts || !element.clientWidth || !element.clientHeight) return null;
    if (['trend', 'matrix', 'season', 'age', 'rank', 'forecast'].indexOf(name) < 0) return null;
    payload = payload || {};
    var key = element.id || String(elementId);
    var record = instances[key];
    if (record && (record.element !== element || record.name !== name || record.chart.isDisposed())) {
      if (!record.chart.isDisposed()) record.chart.dispose();
      if (record.note && record.note.parentNode) record.note.parentNode.removeChild(record.note);
      delete instances[key];
      record = null;
    }
    var initial = !record;
    if (!record) {
      var existing = window.echarts.getInstanceByDom(element);
      if (existing) existing.dispose();
      record = {name: name, element: element, chart: window.echarts.init(element, null, {renderer: 'canvas'}),
        fallback: name === 'matrix' && !hasWebGL()};
      instances[key] = record;
    }
    var option;
    if (name === 'trend') option = trend(payload);
    else if (name === 'matrix') option = record.fallback ? heatmap(payload, true) : matrix(payload, initial, element);
    else if (name === 'season') option = heatmap(payload, false);
    else if (name === 'age' || name === 'rank') option = horizontalBars(payload, name === 'age');
    else option = forecast(payload);
    try {
      record.chart.setOption(applyMotion(option), {replaceMerge: ['series'], lazyUpdate: false});
    } catch (error) {
      if (name !== 'matrix') throw error;
      record.chart.dispose();
      record.chart = window.echarts.init(element, null, {renderer: 'canvas'});
      record.fallback = true;
      record.chart.setOption(applyMotion(heatmap(payload, true)), {replaceMerge: ['series'], lazyUpdate: false});
    }
    refitMatrix(record);
    if (record.fallback && !record.note) fallbackNote(record, payload);
    bindInteraction(record, payload);
    return record.chart;
  }

  function resize() {
    Object.keys(instances).forEach(function (key) {
      var record = instances[key];
      if (!record.chart.isDisposed() && record.element.clientWidth && record.element.clientHeight) {
        record.chart.resize();
        refitMatrix(record);
      }
    });
  }

  function disposeAll() {
    Object.keys(instances).forEach(function (key) {
      var record = instances[key];
      if (!record.chart.isDisposed()) record.chart.dispose();
      if (record.note && record.note.parentNode) record.note.parentNode.removeChild(record.note);
      delete instances[key];
    });
  }

  function reset3D() {
    Object.keys(instances).forEach(function (key) {
      var record = instances[key];
      if (record.name === 'matrix' && !record.fallback && !record.chart.isDisposed()) {
        var fitted = fittedMatrixCamera(record.element);
        record.chart.setOption({grid3D: {viewControl: fitted}});
        record.fitDistance = fitted.distance;
      }
    });
  }

  window.FluVisuals = {render: render, resize: resize, disposeAll: disposeAll, reset3D: reset3D};
})(window);

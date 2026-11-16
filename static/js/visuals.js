/* 图表层只负责呈现；计算与数据来源由 charts.js 统一管理。全部资源来自本地。 */
(function (window) {
  'use strict';

  // 以容器 id 为键登记已创建的图表实例，重绘时复用而不是销毁重建，
  // 否则筛选一次就要重跑入场动画，看起来像整页刷新。
  var instances = Object.create(null);
  // 全局色板：整套图表只认这几个颜色，新增图表要从这里取色，别再写死十六进制。
  var colors = {
    mint: '#476c56', amber: '#b75a48', text: '#596f5e', bright: '#3d5b42',
    line: '#c9d2be', muted: '#9db09a', surface: '#f3f0e7'
  };
  // 3D 矩阵的初始视角；“重置视角”按钮也是把这份配置原样设回去。
  var camera = {
    alpha: 30, beta: 25, distance: 155, minDistance: 105, maxDistance: 270,
    rotateSensitivity: 1, zoomSensitivity: 1, panSensitivity: 0,
    autoRotate: false, animation: false, animationDurationUpdate: 0
  };
  // 三态缓存：undefined=还没检测过 / true / false。WebGL 检测要建 canvas，
  // 每次渲染都测一遍纯属浪费，而结果在整个会话内不会变。
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

  // 所有拼进 tooltip HTML 的外部文本都要过这一道：地区名、数据源名来自数据集文件，
  // 直接用等于把可执行标签塞进 innerHTML。
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
    });
  }

  // 统一把输入转成数字或 null。“缺测”必须保持 null：ECharts 遇到 null 会断开线条，
  // 遇到 0 会画成真实零点——流感 ILI% 的“没采样”和“真为 0”是两回事。
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

  // 所有图共用的底板：字体、留白、tooltip 外观、无障碍。
  // 各图只在返回值上覆写自己那几项，保证整页视觉一致。
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

  // 类目轴：hideOverlap 让月份/地区名过长时自动隔几个显示一个，而不是挤成一片。
  function categoryAxis(data) {
    return {
      type: 'category', data: data || [], boundaryGap: false,
      axisLine: {lineStyle: {color: colors.line}}, axisTick: {show: false},
      axisLabel: {color: colors.text, fontSize: 12, margin: 13, hideOverlap: true},
      splitLine: {show: false}
    };
  }

  // 数值轴：min 固定 0。ILI% 没有负值，自动缩放会把 3%~4% 的小幅波动放大成“剧烈起伏”。
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

  // 通用轴 tooltip：把缺测点整行跳过，避免出现“甲年: 暂无数据”这种占用行高却没信息的条目。
  function axisTooltip(params) {
    var points = Array.isArray(params) ? params : [params];
    if (!points.length) return '';
    return '<b>' + escapeHtml(points[0].axisValueLabel || points[0].name) + '</b>' + points.map(function (point) {
      if (number(point.value) == null) return '';
      return '<div style="margin-top:7px">' + point.marker + escapeHtml(point.seriesName) +
        '<span style="margin-left:22px;float:right;font-family:Consolas,monospace">' + percent(point.value) + '</span></div>';
    }).join('');
  }

  // 月度趋势：当年实线面积 + 上一年虚线对照 + 可选的演示观察线。
  // 上一年用 unshift 放进 series 首位之外的追加位——图例顺序固定为“当年、上一年”。
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

  // 3D 坐标系单轴配置；传 data 就是类目轴，不传就是数值轴，靠这一个函数区分。
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

  // 地区 × 年度 3D 柱阵。initial 只在首次创建实例时为真：
  // 视角一旦由用户转过，重绘就不该把他拽回默认角度。
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
      id: 'region-matrix', name: '年度地区 ILI', type: 'scatter3D',
      symbol: 'circle', symbolSize: 14,
      label: {show: false},
      itemStyle: {opacity: 0.96},
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

  // 热力图一图两用：正常是“月度 × 年度”季节热力图；
  // 设备不支持 WebGL 时，isMatrixFallback 为真，同一张图改画“地区 × 年度”，
  // 让 3D 矩阵面板退化后仍能读到数据，而不是出现一块空白。
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
      dimension: 2, itemSymbol: isMatrixFallback ? 'rect' : 'circle',
      itemWidth: 11, itemHeight: 11, itemGap: 14, selectedMode: false,
      textStyle: {color: colors.text, fontSize: 12},
      pieces: [
        {min: 0, max: 2, label: '≤ 2%', color: '#dfe6d4'},
        {gt: 2, max: 4, label: '2–4%', color: '#c0d1b5'},
        {gt: 4, max: 6, label: '4–6%', color: '#8daa84'},
        {gt: 6, label: '> 6%', color: '#b7866c'}
      ]
    };
    var points = data.filter(function (point) { return number(point[2]) != null; });
    option.series = [isMatrixFallback ? {
      id: 'region-fallback', type: 'heatmap', data: points,
      itemStyle: {borderColor: '#f3f0e7', borderWidth: 3, borderRadius: 1},
      label: {show: x.length <= 12, color: '#35513b', fontSize: 12,
        formatter: function (point) { return number(point.value[2]).toFixed(1); }},
      emphasis: {itemStyle: {borderColor: colors.mint, borderWidth: 2}, label: {color: colors.bright}}
    } : {
      id: 'season-heatmap', type: 'scatter', symbol: 'circle', symbolSize: 34,
      data: points,
      itemStyle: {borderColor: '#f3f0e7', borderWidth: 2},
      label: {show: x.length <= 12, color: '#35513b', fontSize: 11,
        formatter: function (point) { return number(point.value[2]).toFixed(1); }},
      emphasis: {itemStyle: {borderColor: colors.mint, borderWidth: 2}, label: {color: colors.bright}}
    }];
    return option;
  }

  // 横向条形图，省份排行与年龄组共用。isAge 只影响文案：
  // 年龄组的值是按系数估算的，必须在 tooltip 里说清楚，不能和实测并列。
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
      barMaxWidth: 12, barCategoryGap: '48%', showBackground: true,
      backgroundStyle: {color: 'rgba(154,175,168,.08)', borderRadius: 12},
      label: {show: true, position: 'right', distance: 10, color: colors.bright, fontSize: 12, fontFamily: 'Consolas, monospace',
        formatter: function (point) { return number(point.value) == null ? '—' : number(point.value).toFixed(2) + '%'; }},
      itemStyle: {borderRadius: 12},
      emphasis: {itemStyle: {color: '#c4aa82'}},
      data: values.map(function (value, index) {
        return {value: value, itemStyle: {color: names[index] === payload.selected ? colors.amber : colors.mint}};
      })
    }];
    return option;
  }

  // 病原学构成：甲型/乙型（或 A 亚型）的百分比堆叠面积图。
  // 调用方已按当前年度筛好 12 个月，这里只负责画——不做筛选，避免同一逻辑散落两处。
  function pathogen(payload) {
    var option = base();
    var labels = payload.labels || [];
    var series = payload.series || [];
    option.grid = {left: 14, right: 24, top: 46, bottom: 16, containLabel: true};
    option.xAxis = categoryAxis(labels);
    option.xAxis.boundaryGap = true;
    option.xAxis.axisLabel.formatter = function (value) {
      var text = String(value);
      return text.length >= 7 ? text.slice(2).replace('-', '/') : text;
    };
    // 堆叠图必须锁死 0–100，否则 ECharts 会按各月最大合计缩放，堆叠高度并不可比
    option.yAxis = valueAxis('构成比（%）');
    option.yAxis.max = 100;
    option.yAxis.axisLabel.formatter = '{value}%';
    // legend.data 必须显式给出：不写的话，下面叠加的“插值月”散点也会自动进图例，
    // 多出一个点不亮的空图例项
    option.legend = {
      top: 0, right: 12, itemWidth: 20, itemHeight: 8, icon: 'roundRect',
      textStyle: {color: colors.text, fontSize: 12}, selectedMode: false,
      data: series.map(function (item) { return item.name; })
    };
    var palette = [colors.mint, colors.amber, '#b9a06b', '#7f9b86'];
    // modes 与 labels 逐月对齐，标记该月构成比是周报原文、由株数推算还是缺月插值
    var modes = payload.modes || [];
    var interpolated = modes.some(function (mode) { return mode === 'interpolated'; });
    // tooltip 里带上当月阳性样本数：构成比是比值，样本量太少时数字看着正常但不可信，
    // 所以 200 份以下额外提示一句
    option.tooltip.formatter = function (params) {
      var points = Array.isArray(params) ? params : [params];
      if (!points.length) return '';
      var index = points[0].dataIndex;
      var count = (payload.samples || [])[index];
      return '<b>' + escapeHtml(points[0].axisValueLabel || points[0].name) + '</b>' +
        points.map(function (point) {
          return '<div style="margin-top:7px">' + point.marker + escapeHtml(point.seriesName) +
            '<span style="margin-left:22px;float:right;font-family:Consolas,monospace">' +
            percent(point.value) + '</span></div>';
        }).join('') +
        (number(count) == null || number(count) === 0 ? '' :
          '<div style="margin-top:7px;color:#9aa58b">阳性样本 ' + escapeHtml(count) + ' 份' +
          (count < 200 ? ' · 样本量小，波动较大' : '') + '</div>');
    };
    // 百分比堆叠：stack 相同 + 固定 0–100，每月的面积才会按相同比例铺满，可以跨月比较
    option.series = series.map(function (item, index) {
      var color = item.color || palette[index % palette.length];
      var values = (item.values || []).map(number);
      var result = {
        id: 'pathogen-' + index, name: item.name, type: 'line', stack: 'composition',
        data: values, smooth: 0.28, connectNulls: false,
        showSymbol: false, symbol: 'circle', symbolSize: 6,
        lineStyle: {width: 2, color: color},
        itemStyle: {color: color, borderColor: colors.surface, borderWidth: 2},
        areaStyle: {color: color, opacity: 0.16},
        emphasis: {focus: 'series'},
        animationDurationUpdate: 800
      };
      return result;
    });
    if (interpolated && series.length) {
      // 插值月单独叠加一层空心点，与实测区分；不改变原有线条与面积样式
      // 只有第一组（甲型）标点：两组的插值月是同一批，标两次会重影
      var filled = (series[0].values || []).map(number);
      var marks = [];
      filled.forEach(function (value, i) {
        if (modes[i] === 'interpolated' && value != null) marks.push([i, value]);
      });
      if (marks.length) {
        // 这一层不写 stack：写了两条 series 会让插值点被堆到乙型之上，位置全错。
        // 也不能用扁平数组，那样会被当成类目值；必须转成 {value: [月序, 数值]}
        var marksOption = {
          id: 'pathogen-interpolated', name: '插值月', type: 'scatter',
          data: marks, symbol: 'circle', symbolSize: 7, z: 5,
          itemStyle: {color: colors.surface, borderColor: colors.text, borderWidth: 1},
          tooltip: {show: false}, silent: true
        };
        marksOption.data = marks.map(function (point) { return {value: point}; });
        option.series.push(marksOption);
      }
    }
    return option;
  }

  // 预测图把三条时间轴对齐到同一套 x 轴类目上：
  // 历史实测、留出集预测、未来外推的日期集合各不相同，必须先并集排序，
  // 再逐条按日期取值（缺的补 null），否则三条线会错位一个月。
  function forecast(payload) {
    var option = base();
    // 只展示最近 36 个月：更早的历史对判断预测走势没有帮助，还会把转折点压扁
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

  // 探测 WebGL2/WebGL：只有真正拿到 context 才算支持，
  // 拿到后立刻 loseContext，别白占一个显卡上下文（浏览器同时允许的数量很少）。
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

  // 在面板底部挂一条降级说明，用户才知道眼前这张二维图不是原始设计。
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

  // 点击下钻：先 off 再 on，否则每次重绘都会多挂一个监听，点一次触发 N 次。
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

  // 南丁格尔玫瑰图：参照 Apache ECharts pie-roseType。花瓣面积编码当月 ILI%。
  function rose(payload) {
    var option = base();
    var months = payload.months || [];
    var values = (payload.values || []).map(number);
    var peak = maxValue(values) || 1;
    option.tooltip.trigger = 'item';
    option.legend = {show: false};
    delete option.grid;
    option.series = [{
      id: 'rose-months', type: 'pie', roseType: 'area',
      radius: ['16%', '74%'], center: ['50%', '52%'],
      itemStyle: {borderRadius: 3, borderColor: colors.surface, borderWidth: 2},
      label: {color: colors.text, fontSize: 11, formatter: '{b}'},
      data: months.map(function (month, index) {
        var value = values[index];
        var ratio = value == null ? 0 : value / peak;
        return {
          name: month,
          value: value == null ? 0 : value,
          itemStyle: {color: ratio > 0.72 ? colors.amber : (ratio > 0.4 ? '#7f9b86' : colors.mint)}
        };
      })
    }];
    option.tooltip.formatter = function (point) {
      return '<b>' + escapeHtml(point.name) + '</b><br>ILI：' + percent(point.value);
    };
    return option;
  }

  // 雷达：参照 ECharts radar。十二条月份轴叠五年轮廓，所选年用朱砂强调。
  function radar(payload) {
    var option = base();
    var max = payload.max || 10;
    option.tooltip.trigger = 'item';
    option.legend = {
      bottom: 0, itemWidth: 10, itemHeight: 8, textStyle: {color: colors.text, fontSize: 11}
    };
    delete option.grid;
    option.radar = {
      indicator: (payload.months || []).map(function (month) { return {name: month, max: max}; }),
      center: ['50%', '46%'], radius: '62%',
      axisName: {color: colors.text, fontSize: 11},
      splitLine: {lineStyle: {color: 'rgba(94,120,83,.22)'}},
      splitArea: {areaStyle: {color: ['rgba(243,240,231,.15)', 'rgba(71,108,86,.05)']}},
      axisLine: {lineStyle: {color: colors.line}}
    };
    var palette = ['#b7c4ae', '#8aa88a', '#5d8668', '#476c56', colors.amber];
    option.series = [{
      id: 'year-radar', type: 'radar',
      data: (payload.series || []).map(function (item, index) {
        var selected = item.name === payload.selected;
        var color = selected ? colors.amber : palette[index % palette.length];
        return {
          name: item.name, value: item.value,
          symbol: 'none',
          lineStyle: {width: selected ? 2.4 : 1.2, color: color},
          areaStyle: {color: color, opacity: selected ? 0.18 : 0.05},
          itemStyle: {color: color}
        };
      })
    }];
    return option;
  }

  // 主题河流：参照 ECharts themeRiver。河流宽度为甲型/乙型构成比。
  function river(payload) {
    var option = base();
    var names = payload.names || [];
    option.tooltip.trigger = 'axis';
    option.legend = {
      data: names, top: 0, right: 8, textStyle: {color: colors.text, fontSize: 12}
    };
    delete option.grid;
    option.singleAxis = {
      type: 'time', top: 48, bottom: 36, left: 16, right: 16,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: colors.line}},
      axisLabel: {color: colors.text, fontSize: 11, hideOverlap: true},
      splitLine: {show: false}
    };
    var palette = [colors.mint, colors.amber, '#b9a06b', '#7f9b86'];
    option.series = [{
      id: 'pathogen-river', type: 'themeRiver',
      data: payload.data || [],
      label: {show: false},
      color: names.map(function (_, index) { return palette[index % palette.length]; }),
      emphasis: {focus: 'self'}
    }];
    option.tooltip.formatter = function (params) {
      var points = Array.isArray(params) ? params : [params];
      if (!points.length) return '';
      return '<b>' + escapeHtml(points[0].name || '') + '</b>' + points.map(function (point) {
        var value = Array.isArray(point.value) ? point.value[1] : point.value;
        return '<div style="margin-top:7px">' + point.marker + escapeHtml(point.seriesName || (point.value && point.value[2]) || '') +
          '<span style="margin-left:22px;float:right;font-family:Consolas,monospace">' + percent(value) + '</span></div>';
      }).join('');
    };
    return option;
  }

  // 旭日图：参照 ECharts sunburst。内环年度，外环月份。
  function sunburst(payload) {
    var option = base();
    option.tooltip.trigger = 'item';
    delete option.grid;
    option.series = [{
      id: 'year-month-sun', type: 'sunburst',
      radius: ['8%', '92%'], center: ['50%', '50%'],
      sort: null,
      label: {rotate: 'radial', color: colors.bright, fontSize: 10, minAngle: 8},
      itemStyle: {borderColor: colors.surface, borderWidth: 2},
      data: payload.data || []
    }];
    option.tooltip.formatter = function (point) {
      return '<b>' + escapeHtml(point.name) + '</b><br>ILI：' + percent(point.value);
    };
    return option;
  }

  // 极坐标柱：参照 ECharts bar-polar。六个月外推围成一圈。
  function polar(payload) {
    var option = base();
    option.tooltip.trigger = 'item';
    delete option.grid;
    option.angleAxis = {
      type: 'category', data: payload.labels || [],
      axisLine: {lineStyle: {color: colors.line}}, axisTick: {show: false},
      axisLabel: {color: colors.text, fontSize: 11}
    };
    option.radiusAxis = {
      min: 0, axisLine: {show: false}, axisTick: {show: false},
      axisLabel: {color: colors.text, fontSize: 10},
      splitLine: {lineStyle: {color: 'rgba(94,120,83,.18)'}}
    };
    option.polar = {radius: ['18%', '72%']};
    option.series = [{
      id: 'outlook-polar', type: 'bar', coordinateSystem: 'polar',
      data: (payload.values || []).map(number),
      roundCap: true,
      itemStyle: {color: colors.amber},
      emphasis: {itemStyle: {color: colors.mint}}
    }];
    option.tooltip.formatter = function (point) {
      return '<b>' + escapeHtml(point.name) + '</b><br>外推 ILI：' + percent(point.value);
    };
    return option;
  }

  // 统一渲染入口。三层职责：校验容器可用、复用或替换实例、按名字分发到具体图表。
  function render(name, elementId, payload) {
    var element = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    // 容器还没布局（宽高为 0，比如所在页面还没切过来）时直接放弃，
    // ECharts 在 0 尺寸下初始化会得到一张永远画不出的图
    if (!element || !window.echarts || !element.clientWidth || !element.clientHeight) return null;
    // 白名单：名字拼错或调用方传了未知类型时静默返回，不给整页抛错
    if (['trend', 'matrix', 'season', 'age', 'rank', 'forecast', 'pathogen', 'rose', 'radar', 'river', 'sunburst', 'polar'].indexOf(name) < 0) return null;
    payload = payload || {};
    var key = element.id || String(elementId);
    var record = instances[key];
    // 三种情况下旧实例不能复用：换了容器元素、换了图表类型、或实例已被销毁。
    // 复用同一实例配 setOption 才能保留用户已经转过的 3D 视角。
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
    else if (name === 'pathogen') option = pathogen(payload);
    else if (name === 'rose') option = rose(payload);
    else if (name === 'radar') option = radar(payload);
    else if (name === 'river') option = river(payload);
    else if (name === 'sunburst') option = sunburst(payload);
    else if (name === 'polar') option = polar(payload);
    else option = forecast(payload);
    try {
      // replaceMerge: ['series'] 是主图与降级图共用一个实例的前提：
      // series 数量变了（比如 3D 柱阵换成热力图）必须整体替换，不能按 id 合并。
      record.chart.setOption(applyMotion(option), {replaceMerge: ['series'], lazyUpdate: false});
    } catch (error) {
      // 3D 渲染在少数显卡/驱动上会初始化成功但画的时候抛错，这里接住并转成二维热力图。
      // 非矩阵图不兜底：其它图的错误应该暴露出来，而不是被一张空图掩盖。
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

  // 窗口尺寸变化时只重排已有实例；隐藏页面里的图宽高为 0，跳过免得算出错误尺寸
  function resize() {
    Object.keys(instances).forEach(function (key) {
      var record = instances[key];
      if (!record.chart.isDisposed() && record.element.clientWidth && record.element.clientHeight) {
        record.chart.resize();
        refitMatrix(record);
      }
    });
  }

  // 彻底销毁全部实例（切换数据集、重建 dome 时用），连同降级提示节点一起清理
  function disposeAll() {
    Object.keys(instances).forEach(function (key) {
      var record = instances[key];
      if (!record.chart.isDisposed()) record.chart.dispose();
      if (record.note && record.note.parentNode) record.note.parentNode.removeChild(record.note);
      delete instances[key];
    });
  }

  // “重置视角”按钮：只对没有降级的 3D 矩阵生效，二维热力图没有视角可复位
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

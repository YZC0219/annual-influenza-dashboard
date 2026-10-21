/* 本地时序统计探索。所有时间跨度使用真实年月；不作医学判定或预测。 */
(function (scope) {
  'use strict';

  var MAX_TREND_POINTS = 360;
  var ROBUST_Z_SCALE = 0.6744897501960817;
  var BASE_NOTE = '统计探索，不是医学判定或预测。lag12 为有效同月配对的 Pearson 相关系数（−1—1），不是准确率；Theil–Sen 趋势单位为百分点/月。异常采用其他年份同月的留一中位数/MAD，|robustZ|>3.5；样本少于3或MAD为0时不报异常。相近年份为各年标准化后12个月的形态RMSE，不代表预测。';

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function yearNumber(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') ||
        !/^[0-9]{4}$/.test(String(value))) return null;
    var year = Number(value);
    return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function normalize(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.series) || !input.series.length) {
      throw new Error('series 必须是包含年度与12个月数值的非空数组。');
    }
    // Prevent repeated messages/rows from multiplying statistical weight. Merge
    // only complementary or identical months; conflicting measurements are errors.
    var byYear = Object.create(null);
    var duplicateYears = 0;
    input.series.forEach(function (row, rowIndex) {
      if (!row || typeof row !== 'object') throw new Error('第 ' + (rowIndex + 1) + ' 个年度格式无效。');
      var year = yearNumber(row.year);
      if (year == null) throw new Error('年度必须是1900—2100的四位整数。');
      if (!Array.isArray(row.values) || row.values.length !== 12) {
        throw new Error(year + ' 年必须提供固定12个月；缺测使用 null。');
      }
      var values = Array.from({length: 12}, function (_, month) {
        var value = row.values[month];
        if (value === null) return null;
        if (!finite(value) || value < 0 || value > 100) {
          throw new Error(year + ' 年 ' + (month + 1) + ' 月必须是0—100有限数字或 null。');
        }
        return value;
      });
      if (!byYear[year]) {
        byYear[year] = {year: year, values: values};
      } else {
        duplicateYears++;
        values.forEach(function (value, month) {
          var existing = byYear[year].values[month];
          if (value != null && existing != null && value !== existing) {
            throw new Error(year + ' 年 ' + (month + 1) + ' 月存在冲突的重复记录。');
          }
          if (existing == null && value != null) byYear[year].values[month] = value;
        });
      }
    });
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var selectedYear = input.selectedYear == null ? years[years.length - 1] : yearNumber(input.selectedYear);
    if (selectedYear == null || !byYear[selectedYear]) throw new Error('selectedYear 必须属于输入年度。');
    var points = [];
    years.forEach(function (year) {
      byYear[year].values.forEach(function (value, month) {
        if (value != null) points.push({index: year * 12 + month, year: year, month: month + 1, value: value});
      });
    });
    return {years: years, byYear: byYear, points: points, selectedYear: selectedYear, duplicateYears: duplicateYears};
  }

  function lag12(points) {
    var indexed = Object.create(null), pairs = [];
    points.forEach(function (point) { indexed[point.index] = point.value; });
    points.forEach(function (point) {
      if (Object.prototype.hasOwnProperty.call(indexed, point.index - 12)) {
        pairs.push([indexed[point.index - 12], point.value]);
      }
    });
    if (pairs.length < 12) return {value: null, pairs: pairs.length};
    var constantX = pairs.every(function (pair) { return pair[0] === pairs[0][0]; });
    var constantY = pairs.every(function (pair) { return pair[1] === pairs[0][1]; });
    if (constantX || constantY) return {value: null, pairs: pairs.length};
    var meanX = 0, meanY = 0;
    pairs.forEach(function (pair) { meanX += pair[0]; meanY += pair[1]; });
    meanX /= pairs.length; meanY /= pairs.length;
    var maxX = 0, maxY = 0;
    pairs.forEach(function (pair) {
      maxX = Math.max(maxX, Math.abs(pair[0] - meanX));
      maxY = Math.max(maxY, Math.abs(pair[1] - meanY));
    });
    var covariance = 0, squareX = 0, squareY = 0;
    pairs.forEach(function (pair) {
      // Scaling deviations prevents underflow for valid very small values.
      var x = (pair[0] - meanX) / maxX, y = (pair[1] - meanY) / maxY;
      covariance += x * y; squareX += x * x; squareY += y * y;
    });
    var denominator = Math.sqrt(squareX * squareY);
    return {value: denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null, pairs: pairs.length};
  }

  function robustTrend(points) {
    var sampled = points.length > MAX_TREND_POINTS;
    var chosen = sampled ? Array.from({length: MAX_TREND_POINTS}, function (_, index) {
      return points[Math.floor(index * (points.length - 1) / (MAX_TREND_POINTS - 1))];
    }) : points;
    var slopes = [];
    for (var first = 0; first < chosen.length; first++) {
      for (var second = first + 1; second < chosen.length; second++) {
        slopes.push((chosen[second].value - chosen[first].value) / (chosen[second].index - chosen[first].index));
      }
    }
    return {slopePerMonth: median(slopes), method: 'Theil–Sen', sampled: sampled};
  }

  function sameMonthAnomalies(data) {
    var result = [], sparse = 0, zeroMad = 0;
    data.byYear[data.selectedYear].values.forEach(function (value, month) {
      if (value == null) return;
      var others = data.years.filter(function (year) { return year !== data.selectedYear; })
        .map(function (year) { return data.byYear[year].values[month]; })
        .filter(function (other) { return other != null; });
      if (others.length < 3) { sparse++; return; }
      var baseline = median(others);
      var mad = median(others.map(function (other) { return Math.abs(other - baseline); }));
      if (mad === 0) { zeroMad++; return; }
      var score = ROBUST_Z_SCALE * (value - baseline) / mad;
      // Keep the structured response finite even with subnormal, nonzero MAD.
      if (!Number.isFinite(score)) score = value < baseline ? -Number.MAX_VALUE : Number.MAX_VALUE;
      if (Math.abs(score) > 3.5) {
        result.push({year: data.selectedYear, month: month + 1, value: value, baseline: baseline, score: score});
      }
    });
    return {points: result, sparse: sparse, zeroMad: zeroMad};
  }

  function standardized(values) {
    if (values.every(function (value) { return value === values[0]; })) {
      return values.map(function () { return 0; });
    }
    var mean = values.reduce(function (sum, value) { return sum + value; }, 0) / 12;
    var maxDeviation = values.reduce(function (maximum, value) { return Math.max(maximum, Math.abs(value - mean)); }, 0);
    var variance = values.reduce(function (sum, value) { return sum + Math.pow((value - mean) / maxDeviation, 2); }, 0) / 12;
    if (variance === 0) return values.map(function () { return 0; });
    var deviation = Math.sqrt(variance);
    return values.map(function (value) { return ((value - mean) / maxDeviation) / deviation; });
  }

  function nearest(data) {
    var complete = data.years.filter(function (year) {
      return data.byYear[year].values.every(function (value) { return value != null; });
    });
    if (complete.length < 2 || complete.indexOf(data.selectedYear) < 0) return null;
    var selected = standardized(data.byYear[data.selectedYear].values), best = null;
    complete.forEach(function (year) {
      if (year === data.selectedYear) return;
      var candidate = standardized(data.byYear[year].values);
      var distance = Math.sqrt(candidate.reduce(function (sum, value, month) {
        return sum + Math.pow(value - selected[month], 2);
      }, 0) / 12);
      if (best == null || distance < best.distance) best = {year: year, distance: distance};
    });
    return best;
  }

  function analyze(input) {
    var data = normalize(input);
    var expected = (data.years[data.years.length - 1] - data.years[0] + 1) * 12;
    var anomaly = sameMonthAnomalies(data);
    var trend = robustTrend(data.points);
    var note = BASE_NOTE;
    if (trend.sampled) note += ' 趋势计算已按时间顺序等间隔抽取360个有效观测点。';
    if (anomaly.sparse || anomaly.zeroMad) note += ' 所选年中，' + anomaly.sparse + ' 个有效月份同月对照不足3条，' + anomaly.zeroMad + ' 个月份MAD为0，均未执行异常判定。';
    if (data.duplicateYears) note += ' 已合并去重 ' + data.duplicateYears + ' 条重复年度记录。';
    return {id: input.id == null ? null : input.id, available: true, lag12: lag12(data.points), trend: trend,
      anomalies: anomaly.points, nearestYear: nearest(data),
      coverage: {observed: data.points.length, expected: expected, missing: expected - data.points.length}, note: note};
  }

  scope.onmessage = function (event) {
    var input = event && event.data;
    try {
      scope.postMessage(analyze(input));
    } catch (error) {
      scope.postMessage({id: input && input.id != null ? input.id : null, available: false,
        error: error && error.message ? error.message : '无法分析当前输入，请检查年度与月度数据。'});
    }
  };
})(typeof self !== 'undefined' ? self : globalThis);

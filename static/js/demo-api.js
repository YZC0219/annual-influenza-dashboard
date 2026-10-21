/* Read-only Pages transport. Flask continues to use its own live endpoints. */
(function () {
  'use strict';
  var files = {'/api/influenza':'influenza.json','/api/datasets':'datasets.json','/api/forecast':'forecasts.json'};
  window.FluDemoAPI = {
    getJSON: function (path, data) {
      var deferred = $.Deferred(), xhr;
      if (!files[path]) {
        deferred.reject({responseJSON:{error:'在线演示不支持此操作，请运行 Flask 完整版。'}}, 'error');
      } else {
        xhr = $.getJSON('demo/' + files[path]).done(function (result) {
          if (path === '/api/forecast') {
            result = result[JSON.stringify([data.region || '全国', data.group || '全部年龄'])];
            if (!result) { deferred.reject({responseJSON:{error:'演示数据中没有该筛选组合。'}}, 'error'); return; }
          }
          deferred.resolve(result);
        }).fail(function (request, status, error) { deferred.reject(request, status, error); });
      }
      return deferred.promise({abort:function () { if (xhr) xhr.abort(); }});
    }
  };
  $(function () {
    $('#importForm :input').prop('disabled', true);
    $('#importForm').on('submit.demo', function (event) { event.preventDefault(); event.stopImmediatePropagation(); });
    $('#fileName').text('在线演示 · 教学数据快照');
    $('#importStatus').text('在线版可探索、筛选和导出教学数据。导入 CSV 请下载源码并运行 Flask 完整版；在线版不会上传文件。');
    $('.import-help').text('GitHub Pages 只读演示');
  });
}());

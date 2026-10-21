/* 应用状态与分析计算；图形渲染由 visuals.js 管理。 */
(function () {
  'use strict';
  var raw = null, page = 'overview', recordPage = 1, loadVersion = 0;
  var pendingPreview = null, pendingFile = null, forecastCache = {}, forecastRequest = null, previewVersion = 0;
  var MONTHS = Array.from({length:12}, function (_, i) { return (i + 1) + '月'; });
  var PAGES = {
    overview: ['季候图谱', '流感的季节', '季节循环，流感起伏。将观测记录，展开为一幅时间的图谱。', '01'],
    analysis: ['时间与人群', '时间留下的纹理', '沿着月份、人群与年份，寻找每一次起伏的线索。', '02'],
    forecast: ['趋势推演', '向时间的另一侧', '以历史验证假设，再谨慎描摹随后六个月的可能。', '03'],
    data: ['数据档案', '观测，始于记录', '保存每条记录的来源，让每一个判断有迹可循。', '04']
  };
  function getJSON(path,data) { return window.FluDemoAPI?FluDemoAPI.getJSON(path,data):$.getJSON(path,data); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
  function valid(v) { return typeof v === 'number' && Number.isFinite(v); }
  function fmt(v, digits) { return valid(v) ? v.toLocaleString('en-US', {minimumFractionDigits:digits == null ? 2 : digits,maximumFractionDigits:digits == null ? 2 : digits}) : '—'; }
  function years() { return Object.keys(raw.yearly).sort(); }
  function currentYear() { return $('#year').val(); }
  function regionFactor(year) { return (raw.regionByYear[year] || {})[$('#region').val()] || 1; }
  function groupFactor() { return raw.groups[$('#group').val()] || 1; }
  function scale(v, year) { return valid(v) ? +(v * regionFactor(year) * groupFactor()).toFixed(4) : null; }
  function trendFor(year) { return raw.yearly[year].trend.map(function (v) { return scale(v, year); }); }
  function mean(values) { var items=values.filter(valid); return items.length ? items.reduce(function(a,b){return a+b;},0)/items.length : null; }
  function summary(values) { var observed=values.map(function(v,i){return {value:v,month:i+1};}).filter(function(v){return valid(v.value);}); var peak=observed.reduce(function(a,b){return !a||b.value>a.value?b:a;},null);return {count:observed.length,peak:peak,mean:mean(values),above:observed.filter(function(v){return v.value>=5;}).length}; }
  function setError(message) { $('#error').prop('hidden',!message).find('span').text(message || ''); }
  function errorMessage(xhr) { var body=xhr.responseJSON || {}; return (body.error || '请求失败，请检查本地服务。')+(body.details && body.details.length ? ' '+body.details.join('；') : ''); }
  function options(id, values, preferred) { var select=$('#'+id).empty();values.forEach(function(v){select.append($('<option>').val(v).text(v));});select.val(values.indexOf(preferred)>=0?preferred:values[0]); }
  function setRegionOptions() { var previous=$('#region').val();options('region',Object.keys(raw.regionByYear[currentYear()] || {}).sort(function(a,b){return a==='全国'?-1:b==='全国'?1:a.localeCompare(b,'zh-CN');}),previous); }
  function fillFilters() {
    var preferences=window.FluExperience?FluExperience.consumeFilters($('#dataset').val()):{};options('year',years().slice().reverse(),preferences.year||$('#year').val());setRegionOptions();if(preferences.region&&$('#region option').toArray().some(function(o){return o.value===preferences.region;}))$('#region').val(preferences.region);
    var order=['全部年龄','0–4岁','5–14岁','15–59岁','60岁及以上'];
    options('group',Object.keys(raw.groups).sort(function(a,b){return order.indexOf(a)-order.indexOf(b);}),preferences.group||$('#group').val());
  }
  function estimated() { return $('#region').val()!=='全国'||$('#group').val()!=='全部年龄'; }
  function updateStatus() { if(!raw)return;var span=years();$('#status').text(span[0]+'—'+span[span.length-1]+' / '+raw.records.length+' 条月度记录 · '+currentYear()+' · '+$('#region').val()+' · '+$('#group').val()+(estimated()?' / 系数估算':'')+(page==='forecast'?' / 预测使用全历史，年度筛选不截断训练数据':page==='data'?' / 明细展示整个数据集的原始记录':'')); }
  function spark(values) {
    var numbers=values.filter(valid),max=Math.max.apply(null,numbers.concat([1])),min=Math.min.apply(null,numbers.concat([0]));
    var path='',connected=false;values.forEach(function(v,i){if(!valid(v)){connected=false;return;}path+=(connected?'L':'M')+(i*65/11).toFixed(1)+' '+(32-(v-min)/(max-min||1)*29).toFixed(1)+' ';connected=true;});
    return '<svg class="sparkline" viewBox="0 0 65 34" aria-hidden="true"><path d="'+path+'"/></svg>';
  }
  function kpi(title,code,value,unit,change,detail,chart,warning) { return '<article class="kpi-card"><div class="kpi-top">'+esc(title)+'<span class="kpi-code">'+code+'</span></div><div class="kpi-value">'+esc(value)+'<span class="kpi-unit">'+esc(unit)+'</span></div><div class="kpi-change'+(warning?' amber':'')+'">'+esc(change)+'</div><div class="kpi-detail">'+esc(detail)+'</div>'+(chart||'')+'</article>'; }
  function overview() {
    var year=currentYear(),item=raw.yearly[year],previous=raw.yearly[String(+year-1)],values=trendFor(year),stats=summary(values),rate=scale(item.rate,year),delta=previous ? rate-scale(previous.rate,String(+year-1)) : null;
    $('#heroRate').html(fmt(rate)+'<small>%</small>');$('#heroRateLabel').text(raw.meta.kind==='imported'?'月均 ILI 比例':'年度 ILI 比例');$('#heroScope').text(year+' / '+$('#region').val()+' / '+$('#group').val()+(estimated()?' · 估算':''));$('#atlasPeriod').text(years()[0]+' — '+years().slice(-1)[0]);
    if(window.FluExperience)FluExperience.update({meta:raw.meta,years:years(),series:years().map(function(y){return {year:y,values:trendFor(y)};}),selectedYear:year,scope:$('#region').val()+' / '+$('#group').val(),onSelect:function(y,month){if(!raw)return;$('#year').val(String(y));setRegionOptions();renderPage();if(month)$('#status').text($('#status').text()+' · 图谱选中 '+month+' 月');}});
    var deltaText=valid(delta)?(delta>=0?'↑ +':'↓ ')+fmt(delta)+' 个百分点 / 同比':'暂无上一年对照';
    $('#kpis').html(kpi(raw.meta.kind==='imported'?'月均 ILI 比例':'年度 ILI 比例','ILI / 01',fmt(rate),'%',deltaText,estimated()?'当前地区 × 年龄系数估算':raw.meta.kind==='imported'?'可用月份算术平均，非加权年率':'全国 · 全部年龄 / 年度汇总',spark(values),valid(delta)&&delta>0)+kpi('实验室阳性率','LAB / 02',fmt(item.pos),'%',valid(item.pos)?'独立指标 · 不等于 ILI%':'数据源未提供','全国 · 全部年龄 / 不应用筛选系数')+kpi('年度流感样病例','CASES / 03',fmt(item.cases,0),'万人次',valid(item.cases)?'年度汇总记录':'数据源未提供','全国 · 全部年龄 / 不应用筛选系数')+kpi('月度活动峰值','PEAK / 04',stats.peak?fmt(stats.peak.value):'—','%',stats.peak?year+' 年 '+stats.peak.month+' 月':'暂无月度记录','当前筛选 / '+stats.count+' 个月份可用',null,true));
    $('#trendScope').text($('#region').val()+' / '+$('#group').val()+(estimated()?' · 估算':''));
    FluVisuals.render('trend','trendChart',{months:MONTHS,current:values,previous:previous?trendFor(String(+year-1)):null,year:year,previousYear:String(+year-1),threshold:raw.meta.kind==='demo'?5:null});
    var notes=[['高峰月份',stats.peak?'<strong>'+stats.peak.month+' 月</strong>达到 '+fmt(stats.peak.value)+'%，是当前年度可用记录的最高点。':'暂无可用月度数据。'],['年度对照',valid(delta)?'相较上一年度，ILI 比例'+(delta>=0?'上升':'下降')+' <strong>'+fmt(Math.abs(delta))+' 个百分点</strong>。':'当前数据没有相邻年度，暂不计算同比。'],[raw.meta.kind==='demo'?'观察线以上':'数据完整度',raw.meta.kind==='demo'?'全年有 <strong>'+stats.above+' 个月</strong>达到 5% 演示观察线；不等同医学预警。':'已有 <strong>'+stats.count+'/12 个月</strong>记录；缺测月份保留为空。']];
    $('#insights').html(notes.map(function(n,i){return '<div class="insight"><span class="insight-number">0'+(i+1)+'</span><div><h3>'+n[0]+'</h3><p>'+n[1]+'</p></div></div>';}).join(''));
    var regionNames=Object.keys(raw.regionByYear[year] || {}),allYears=years(),matrix=[];
    allYears.forEach(function(y,yi){regionNames.forEach(function(r,ri){var f=raw.regionByYear[y]&&raw.regionByYear[y][r],annual=raw.yearly[y].rate;if(valid(f)&&valid(annual))matrix.push({value:[ri,yi,+(annual*f*groupFactor()).toFixed(4)],selected:r===$('#region').val()});});});
    FluVisuals.render('matrix','matrixChart',{years:allYears,regions:regionNames,data:matrix,onSelect:selectRegion,onFallback:function(){$('#matrixHelp').text('当前环境使用二维矩阵 · 点击格子筛选');}});
    var rank=regionNames.map(function(r){return {name:r,value:item.rate*raw.regionByYear[year][r]*groupFactor()};}).sort(function(a,b){return b.value-a.value;});
    FluVisuals.render('rank','rankChart',{names:rank.map(function(r){return r.name;}),values:rank.map(function(r){return r.value;}),selected:$('#region').val(),onSelect:selectRegion});
  }
  function selectRegion(region) { if(!raw)return;if($('#region option').toArray().some(function(o){return o.value===region;})){$('#region').val(region);renderPage();} }
  function analysis() {
    var heat=[];years().forEach(function(y,yi){trendFor(y).forEach(function(v,mi){if(valid(v))heat.push([mi,yi,v]);});});
    FluVisuals.render('season','seasonChart',{years:years(),months:MONTHS,data:heat,onSelect:function(year,month){if(!raw)return;$('#year').val(String(year));setRegionOptions();renderPage();$('#heatmapNote').text('已选 '+year+' 年 '+month+' 月 · 空白格表示缺测，不以零填充。');}});
    var groupNames=$('#group option').toArray().map(function(o){return o.value;}),item=raw.yearly[currentYear()];
    FluVisuals.render('age','ageChart',{names:groupNames,values:groupNames.map(function(g){return item.rate*regionFactor(currentYear())*raw.groups[g];}),selected:$('#group').val(),onSelect:function(g){$('#group').val(g);renderPage();}});
    $('#annualTable').html(years().slice().reverse().map(function(y){var s=summary(trendFor(y));return '<tr class="'+(y===currentYear()?'current-row':'')+'"><td>'+y+'</td><td>'+fmt(s.mean)+'%</td><td>'+(s.peak?s.peak.month+' 月':'—')+'</td><td>'+s.count+'/12</td></tr>';}).join(''));
  }
  function forecastKey() { return $('#dataset').val()+'|'+$('#region').val()+'|'+$('#group').val(); }
  function showForecast(result) {
    $('#forecastUnavailable').prop('hidden',result.available).text(result.reason||'');$('#forecastContent').prop('hidden',!result.available);if(!result.available)return;
    var names={seasonal_naive:'季节朴素基线',seasonal_drift:'趋势修正季节基线'},v=result.validation,latest=result.forecast[result.forecast.length-1].date,now=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date()).replace('/','-');
    var past=latest<now;
    $('#forecastMetrics').html('<article class="forecast-metric"><span>留出集平均绝对误差</span><strong>'+fmt(v.mae,3)+' <small>百分点</small></strong><small>'+v.months+' 个月独立验证 · 非准确率</small></article><article class="forecast-metric"><span>季节朴素对照 MAE</span><strong>'+fmt(v.baselineMae,3)+' <small>百分点</small></strong><small>用于对照，低误差更好</small></article><article class="forecast-metric"><span>历史截面 / 最后观测月</span><strong>'+esc(result.trainingEnd)+'</strong><small>'+esc(result.forecast[0].date)+'—'+esc(latest)+(past?' · 历史演示窗口':' · 六个月外推')+'</small></article>');
    $('#forecastMethod').text(names[result.method] || result.method);$('#forecastNote').text(result.note+' 该模型不提供置信区间；留出集用于选模，误差并非额外测试集表现。'+(past?' 当前预测月份已过去，属于历史截面演示。':''));
    FluVisuals.render('forecast','forecastChart',{history:result.history,validationPoints:result.validationPoints,forecast:result.forecast,method:names[result.method] || result.method});
  }
  function forecast() {
    var key=forecastKey();if(forecastCache[key]){showForecast(forecastCache[key]);return;}
    $('#forecastContent').prop('hidden',true);$('#forecastUnavailable').prop('hidden',false).text('正在执行历史留出验证…');
    if(forecastRequest)forecastRequest.abort();
    forecastRequest=getJSON('/api/forecast',{dataset:$('#dataset').val(),region:$('#region').val(),group:$('#group').val()}).done(function(result){forecastCache[key]=result;if(raw&&key===forecastKey()&&page==='forecast')showForecast(result);}).fail(function(xhr,status){if(status!=='abort'&&key===forecastKey())$('#forecastUnavailable').text(errorMessage(xhr));});
  }
  function recordMatches() { var query=$('#recordSearch').val().trim();return raw.records.slice().reverse().filter(function(row){return !query||(row.year+'-'+String(row.month).padStart(2,'0')+' '+row.rate).indexOf(query)>=0;}); }
  function records() {
    var rows=recordMatches(),pages=Math.max(1,Math.ceil(rows.length/12));recordPage=Math.max(1,Math.min(recordPage,pages));
    $('#recordsTable').html(rows.slice((recordPage-1)*12,recordPage*12).map(function(row,i){return '<tr><td class="unit">OBS-'+String((recordPage-1)*12+i+1).padStart(3,'0')+'</td><td>'+esc(row.year)+'</td><td>'+esc(row.month)+' 月</td><td>'+fmt(row.rate)+'%</td><td><span class="table-tag'+(raw.meta.kind==='demo'?' warning':'')+'">'+(raw.meta.kind==='demo'?'模拟记录':'用户导入')+'</span></td></tr>';}).join('')||'<tr><td colspan="5">没有匹配的记录</td></tr>');
    $('#recordCount').text('共 '+rows.length+' 条原始月度记录 · 不应用地区 / 年龄系数');$('#pageCount').text(recordPage+' / '+pages);$('#prevPage').prop('disabled',recordPage<=1);$('#nextPage').prop('disabled',recordPage>=pages);
  }
  function dataPage() {
    var q=raw.quality,m=raw.meta,updated=m.updatedAt?new Date(m.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未提供';
    $('#sourceType').text(m.kind==='demo'?'教学演示':'用户导入 · 来源自述');
    $('#sourceDetails').html([['数据名称',m.name],['来源说明',m.source],['统计口径',m.derived||'按原始记录呈现'],[m.kind==='demo'?'脚本时间':'导入时间',updated+' / 北京时间']].map(function(pair){return '<dt>'+pair[0]+'</dt><dd>'+esc(pair[1])+'</dd>';}).join(''));
    $('#qualitySummary').html([[q.rows,'有效月记录'],[q.missingMonths.length,'缺失月份'],[q.duplicates,'重复年月']].map(function(p){return '<div><strong>'+p[0]+'</strong><span>'+p[1]+'</span></div>';}).join(''));
    $('#qualityIssues').html((q.issues.length?q.issues:['未发现缺月或重复记录。数值有效不代表数据来源已核实。']).map(function(i){return '<li>'+esc(i)+'</li>';}).join(''));records();
  }
  function renderPage() {
    if(!raw)return;updateStatus();if(page==='overview')overview();else if(page==='analysis')analysis();else if(page==='forecast')forecast();else dataPage();if(window.FluExperience)FluExperience.syncFilters($('#dataset').val(),$('#year').val());requestAnimationFrame(function(){FluVisuals.resize();});
  }
  function navigate() {
    page=location.hash.slice(1);if(!PAGES[page])page='overview';
    $('.page-view').prop('hidden',true);$('#page-'+page).prop('hidden',false);$('[data-page]').removeClass('active').removeAttr('aria-current');$('[data-page="'+page+'"]').addClass('active').attr('aria-current','page');
    if(window.FluExperience)FluExperience.setActive(page==='overview');document.body.dataset.page=page;$('#atlasSection').prop('hidden',page!=='overview');
    var info=PAGES[page];$('#pageLabel').text(info[0]);$('#pageTitle').text(info[1]).append($('<span>').text('。'));$('#pageDescription').text(info[2]);$('#pageNumber').text(info[3]);if(page==='overview')$('#pageTitle').html('流感的<br>季节<span>。</span>');renderPage();
  }
  function dataUnavailable(message) {
    raw=null;FluVisuals.disposeAll();if(window.FluExperience)FluExperience.clear();else if(window.FluAtlas)FluAtlas.clear();$('.chart').empty();$('#heroRate').text('—');$('#kpis,#insights,#annualTable,#recordsTable,#sourceDetails,#qualitySummary,#qualityIssues').empty();$('#forecastContent').prop('hidden',true);$('#forecastUnavailable').prop('hidden',false).text('请先加载可用的数据集。');setError(message);$('#status').text('数据尚未就绪，可到数据档案导入 CSV。');
  }
  function loadData() {
    var version=++loadVersion;if(forecastRequest)forecastRequest.abort();raw=null;if(window.FluExperience)FluExperience.clear();else if(window.FluAtlas)FluAtlas.clear();$('#heroRate').text('—');setError('');$('#status').text('正在读取与检查数据…');$('#exportReport,#exportCsv').prop('disabled',true);$('#year,#region,#group').prop('disabled',true);
    // 原接口保持不变，新增 dataset 参数支持独立的用户数据集。
    getJSON('/api/influenza',{dataset:$('#dataset').val() || 'database'}).done(function(data){if(version!==loadVersion)return;if(!data||!data.yearly||!Object.keys(data.yearly).length){dataUnavailable('当前数据集没有可用年度，请到数据档案导入月度记录。');return;}raw=data;forecastCache={};fillFilters();$('#year,#region,#group,#exportReport,#exportCsv').prop('disabled',false);$('#datasetKind').text(raw.meta.kind==='demo'?'教学模拟数据':'用户导入数据').toggleClass('imported',raw.meta.kind!=='demo');$('#dataDisclaimer').text(raw.meta.kind==='demo'?'教学模拟数据 · 不代表真实疫情':'用户导入 · 来源未经平台独立核实');recordPage=1;FluVisuals.disposeAll();renderPage();}).fail(function(xhr){if(version!==loadVersion)return;dataUnavailable(errorMessage(xhr));});
  }
  function loadDatasets(preferred) { return getJSON('/api/datasets').done(function(data){var value=preferred||$('#dataset').val();$('#dataset').empty();data.datasets.forEach(function(meta){$('#dataset').append($('<option>').val(meta.id).text(meta.name));});$('#dataset').val(value||'database');}).fail(function(xhr){setError(errorMessage(xhr));}); }
  function invalidatePreview() { previewVersion++; pendingPreview=null;$('#importPreview').prop('hidden',true); }
  function csvDownload(filename, content) { var url=URL.createObjectURL(new Blob(['\ufeff'+content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000); }
  function printReport() {
    if(!raw)return;var year=currentYear(),s=summary(trendFor(year)),item=raw.yearly[year],result=forecastCache[forecastKey()];
    var html='<h1>流感观测站 · 分析报告</h1><p>数据集：'+esc(raw.meta.name)+'</p><p>来源：'+esc(raw.meta.source)+'</p><p>筛选：'+esc(year)+' / '+esc($('#region').val())+' / '+esc($('#group').val())+'</p><p>统计口径：'+esc(raw.meta.derived)+'</p><h2>当前截面</h2><p>ILI：'+fmt(scale(item.rate,year))+'%；月度峰值：'+(s.peak?s.peak.month+' 月 / '+fmt(s.peak.value)+'%':'未提供')+'；完整度：'+s.count+'/12。</p><p>全国全部年龄年度阳性率：'+fmt(item.pos)+'%；全国年度病例：'+fmt(item.cases,0)+' 万人次。</p><h2>月度记录（当前筛选）</h2><table><thead><tr><th>月份</th><th>ILI%</th></tr></thead><tbody>'+trendFor(year).map(function(v,i){return '<tr><td>'+(i+1)+' 月</td><td>'+fmt(v)+'</td></tr>';}).join('')+'</tbody></table>';
    if(result&&result.available)html+='<h2>历史截面预测</h2><p>最后观测月 '+esc(result.trainingEnd)+'；留出集 MAE '+fmt(result.validation.mae,3)+' 个百分点。</p><p>'+result.forecast.map(function(p){return esc(p.date)+'：'+fmt(p.value)+'%';}).join('；')+'</p>';
    html+='<p class="report-note">'+(raw.meta.kind==='demo'?'教学模拟数据，不代表真实疫情。':'用户自述来源，未经独立核实。')+'地区与年龄指标为系数估算；预测为统计基线演示，不用于医学决策。5% 观察线仅用于演示。</p>';
    $('#printReport').html(html);window.print();
  }
  $(function(){
    $('#today').text(new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}));navigate();loadDatasets().always(function(){var requested=window.FluExperience?FluExperience.initialDataset():null;if(requested&&$('#dataset option').toArray().some(function(o){return o.value===requested;}))$('#dataset').val(requested);loadData();});
    $(window).on('hashchange',navigate).on('resize',function(){FluVisuals.resize();});
    $('#dataset').on('change',loadData);$('#retryLoad').on('click',loadData);
    $('#year').on('change',function(){if(raw){var chosen=this.value,commit=function(){$('#year').val(chosen);setRegionOptions();renderPage();};if(window.FluExperience)FluExperience.changeYear(chosen,commit);else commit();}});$('#region,#group').on('change',renderPage);
    $('#resetFilters').on('click',function(){if(!raw)return;$('#year').val(years().slice(-1)[0]);setRegionOptions();$('#region').val('全国');$('#group').val('全部年龄');renderPage();});
    $('#resetView').on('click',function(){FluVisuals.reset3D();});$('#recordSearch').on('input',function(){recordPage=1;if(raw)records();});$('#prevPage').on('click',function(){recordPage--;records();});$('#nextPage').on('click',function(){recordPage++;records();});
    $('#downloadTemplate').on('click',function(){csvDownload('流感月度数据模板.csv','year,month,rate\r\n2025,1,3.2\r\n2025,2,4.1\r\n');});$('#exportCsv').on('click',function(){if(raw)csvDownload('流感原始月度记录.csv','year,month,rate\r\n'+recordMatches().map(function(r){return [r.year,r.month,r.rate].join(',');}).join('\r\n'));});$('#exportReport').on('click',printReport);
    $('#importFile').on('change',function(){pendingFile=this.files[0]||null;invalidatePreview();$('#fileName').text(pendingFile?pendingFile.name:'点击选择 CSV 数据文件');$('#importStatus').text('');});$('#importName,#importSource').on('input',invalidatePreview);
    $('#importForm').on('submit',function(event){event.preventDefault();invalidatePreview();if(!pendingFile)return;var version=previewVersion,form=new FormData(this);$('#previewImport').prop('disabled',true);$('#importStatus').text('正在校验字段、数值与时间完整度…');$.ajax({url:'/api/import/preview',type:'POST',data:form,processData:false,contentType:false}).done(function(result){if(version!==previewVersion)return;pendingPreview=result.token;$('#previewSummary').text('有效记录 '+result.quality.rows+' 条 · 缺月 '+result.quality.missingMonths.length+' 个 · 重复 '+result.quality.duplicates+' 条。下方最多展示前 12 条；缺月数据仍可保存；序列内部缺月或不足 36 个月时不预测。');$('#previewTable').html(result.preview.map(function(r){return '<tr><td>'+r.year+'</td><td>'+r.month+' 月</td><td>'+fmt(r.rate)+'%</td></tr>';}).join(''));$('#importPreview').prop('hidden',false);$('#importStatus').text('校验完成。请核对下方预览，然后确认保存。');}).fail(function(xhr){$('#importStatus').text(errorMessage(xhr));}).always(function(){$('#previewImport').prop('disabled',false);});});
    $('#commitImport').on('click',function(){if(!pendingPreview)return;$('#commitImport').prop('disabled',true);$.ajax({url:'/api/import/commit',method:'POST',contentType:'application/json',data:JSON.stringify({token:pendingPreview})}).done(function(result){invalidatePreview();$('#importStatus').text('已保存为独立数据集，正在切换。');loadDatasets(result.datasetId).done(loadData);}).fail(function(xhr){$('#importStatus').text(errorMessage(xhr));}).always(function(){$('#commitImport').prop('disabled',false);});});
  });
})();

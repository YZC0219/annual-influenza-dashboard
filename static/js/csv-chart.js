/* Imported-data home view. Statistics describe uploaded values, not medical conclusions. */
(function(root){
 'use strict';
 function number(value){var text=String(value==null?'':value).trim().replace(/,/g,'').replace(/%$/,'');return text===''?null:Number.isFinite(Number(text))?Number(text):null;}
 function defaults(model){
  var names=model.headers.map(function(h){return h.trim().toLowerCase();}),year=names.indexOf('year'),month=names.indexOf('month');
  var metrics=model.numeric.map(function(yes,i){return yes?i:-1;}).filter(function(i){return i>=0;});
  var preferred=names.findIndex(function(h){return /^(rate|value|数量|数值|金额|比例|病例数)$/.test(h);});
  var metric=metrics.includes(preferred)?preferred:metrics.filter(function(i){return i!==year&&i!==month;}).slice(-1)[0];
  if(metric==null)metric=metrics.length?metrics[metrics.length-1]:-1;
  return {yearIndex:year,monthIndex:month,metric:metric,metrics:metrics,category:year>=0&&month>=0?'period':String(Math.max(0,model.numeric.indexOf(false)))};
 }
 function build(model,options){
  var d=defaults(model),metric=Number(options.metric),entries=[],missing=0,rows=0,groups=new Map(),query=(options.query||'').trim().toLowerCase();
  if(metric<0||!d.metrics.includes(metric))return {entries:[],missing:0,rows:0,mean:null,min:null,max:null};
  model.rows.forEach(function(row,index){
   if(options.year&&row[d.yearIndex]!==options.year)return;
   if(query&&!row.some(function(v){return v.toLowerCase().includes(query);}))return;
   rows++;var value=number(row[metric]);if(value===null){missing++;return;}
   var label=options.category==='period'?row[d.yearIndex]+'-'+String(row[d.monthIndex]).padStart(2,'0'):row[Number(options.category)];label=label||'未命名';
   if(options.aggregation==='mean'||options.aggregation==='sum'){
    var group=groups.get(label);if(!group){group={label:label,value:0,count:0,index:index};groups.set(label,group);}group.value+=value;group.count++;
   }else entries.push({label:label,value:value,count:1,index:index});
  });
  if(options.aggregation==='sum'||options.aggregation==='mean')entries=Array.from(groups.values()).map(function(group){if(options.aggregation==='mean')group.value/=group.count;return group;});
  if(options.order==='desc')entries.sort(function(a,b){return b.value-a.value||a.index-b.index;});
  else if(options.order==='asc')entries.sort(function(a,b){return a.value-b.value||a.index-b.index;});
  var sum=0,min=null,max=null;entries.forEach(function(e){sum+=e.value;if(!min||e.value<min.value)min=e;if(!max||e.value>max.value)max=e;});
  return {entries:entries,missing:missing,rows:rows,mean:entries.length?sum/entries.length:null,min:min,max:max};
 }
 function describe(result,metric,aggregation){
  var format=function(v){return v.toLocaleString('zh-CN',{maximumFractionDigits:3});};
  if(!result.entries.length)return [['暂无有效数值','当前文件或筛选结果没有可绘制的数值，请选择数值列或调整筛选。']];
  var above=result.entries.filter(function(e){return e.value>result.mean;}).length,below=result.entries.filter(function(e){return e.value<result.mean;}).length;
  var notes=[['最高值',result.max.label+' 的'+metric+'为 '+format(result.max.value)+'，在当前 '+result.entries.length+' 个展示项中最高。']];
  if(result.entries.length===1)notes.push(['比较范围','当前仅有 1 个有效展示项，暂不进行多项分布比较。']);
  else if(result.min.value===result.max.value)notes.push(['数值一致','当前 '+result.entries.length+' 个展示项数值一致，均为 '+format(result.max.value)+'，没有高低差异。']);
  else notes.push(['分布范围','最低值为 '+format(result.min.value)+'（'+result.min.label+'），最高值为 '+format(result.max.value)+'；极差为 '+format(result.max.value-result.min.value)+'。']);
  notes.push(['平均水平','算术平均值为 '+format(result.mean)+'；'+above+' 项高于平均值，'+below+' 项低于平均值。'+(aggregation==='mean'?'这里是各组均值的简单平均，不是按记录数加权的总体均值。':'按当前展示项直接计算，未作加权。')]);
  if(result.missing)notes.push(['缺失记录',result.rows+' 条命中记录中有 '+result.missing+' 条所选指标为空或无效，已从图表和统计中排除，未按零值填充。']);
  return notes;
 }
 var api={defaults:defaults,build:build,describe:describe};if(typeof module==='object'&&module.exports)module.exports=api;if(!root.document)return;
 root.FluCSVChart=api;
 var document=root.document,model=null,title='',chart=null,active=false,latest=null,resizeObserver=null;
 var byId=function(id){return document.getElementById(id);},fmt=function(v){return v==null?'—':v.toLocaleString('zh-CN',{maximumFractionDigits:3});};
 function option(select,value,label){var e=document.createElement('option');e.value=value;e.textContent=label;select.appendChild(e);}
 function save(name,url){var a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();}
 function sync(){
  var home=(!location.hash||location.hash==='#overview')&&active;
  document.body.classList.toggle('has-csv-home',home);byId('csvHome').hidden=!home;
  var badge=byId('datasetKind');if(home){if(!badge.dataset.original)badge.dataset.original=badge.textContent;badge.textContent='CSV 导入 · 当前页面';}
  else if(badge.dataset.original){badge.textContent=badge.dataset.original;delete badge.dataset.original;}
  if(home&&chart)requestAnimationFrame(function(){chart.resize();});
 }
 function options(){return {category:byId('csvCategory').value,metric:byId('csvMetric').value,aggregation:byId('csvAggregation').value,order:byId('csvOrder').value,year:byId('csvYearFilter').value,query:byId('csvChartSearch').value};}
 function render(){
  if(!model)return;var config=options(),result=build(model,config);latest=result;
  var rawMetric=model.headers[Number(config.metric)],metric=rawMetric==='rate'&&defaults(model).category==='period'?'月度比例（rate）':rawMetric||'未选择数值列',aggregation={records:'逐条记录',mean:'分组算术平均',sum:'分组求和'}[config.aggregation];
  byId('csvHomeTitle').textContent=title;byId('csvPlotTitle').textContent=metric+' · '+aggregation;
  byId('csvStatCount').textContent=String(result.entries.length);byId('csvStatMean').textContent=fmt(result.mean);byId('csvStatMax').textContent=result.max?fmt(result.max.value):'—';
  byId('csvStatScope').textContent='筛选命中 '+result.rows+' 条原始记录'+(result.missing?' · '+result.missing+' 条空值未绘制':'');
  byId('csvMaxLabel').textContent=result.max?result.max.label:'暂无记录';
  byId('csvChartDownload').disabled=!result.entries.length;
  var notes=describe(result,metric,config.aggregation);
  var container=byId('csvNarrative');container.replaceChildren();notes.forEach(function(note,index){var article=document.createElement('article'),label=document.createElement('span'),h=document.createElement('h3'),p=document.createElement('p');label.textContent='0'+(index+1);h.textContent=note[0];p.textContent=note[1];article.append(label,h,p);container.appendChild(article);});
  byId('csvChartNote').textContent=aggregation+' · '+(result.entries.length>12?'图中每次显示约 12 项，可拖动右侧滑块或在图内滚动查看全部 '+result.entries.length+' 项。':'共 '+result.entries.length+' 个展示项。')+' 搜索与筛选同时作用于图表和文字解读。';
  if(!root.echarts)return;
  if(!chart)chart=root.echarts.init(byId('csvBarChart'),null,{renderer:'canvas'});
  var reduced=root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  chart.setOption({animation:!reduced,animationDuration:500,animationDurationUpdate:reduced?0:350,backgroundColor:'#f3f0e7',aria:{enabled:true},
   title:{text:title,subtext:metric+' · '+aggregation+' · '+result.entries.length+' 项',left:18,top:10,textStyle:{fontSize:18,fontWeight:'normal',color:'#253d36'},subtextStyle:{color:'#596f5e',fontSize:11}},
   grid:{left:12,right:result.entries.length>12?74:62,top:83,bottom:30,containLabel:true},
   tooltip:{trigger:'axis',confine:true,renderMode:'richText',axisPointer:{type:'shadow'},valueFormatter:function(v){return fmt(v);}},
   xAxis:{type:'value',axisLabel:{color:'#596f5e',fontSize:11},splitLine:{lineStyle:{color:'#d0d4c8',type:'dashed'}},axisLine:{show:false},axisTick:{show:false}},
   yAxis:{type:'category',inverse:true,data:result.entries.map(function(e){return e.label;}),axisTick:{show:false},axisLine:{show:false},axisLabel:{color:'#253d36',fontSize:12,width:byId('csvBarChart').clientWidth<500?82:160,overflow:'truncate'}},
   dataZoom:result.entries.length>12?[{type:'slider',yAxisIndex:0,filterMode:'filter',orient:'vertical',right:10,top:83,bottom:32,width:14,startValue:0,endValue:11,showDetail:false,borderColor:'#d0d4c8',fillerColor:'#92aa9844',dataBackground:{lineStyle:{color:'#92aa98'},areaStyle:{color:'#d0d4c8'}},selectedDataBackground:{lineStyle:{color:'#476c56'},areaStyle:{color:'#92aa98'}},handleStyle:{color:'#476c56',borderColor:'#476c56'}},{type:'inside',yAxisIndex:0,filterMode:'filter',startValue:0,endValue:11,zoomOnMouseWheel:false,moveOnMouseWheel:true,preventDefaultMouseMove:true}]:[],
   series:[{type:'bar',name:metric,barMaxWidth:28,showBackground:true,backgroundStyle:{color:'#e4e9dc66'},label:{show:true,position:'right',fontFamily:'Consolas,monospace',fontSize:11,color:'#253d36',formatter:function(p){return fmt(p.value);}},itemStyle:{borderRadius:[0,3,3,0]},data:result.entries.map(function(e){return {value:e.value,itemStyle:{color:result.max&&e.index===result.max.index?'#b35d49':'#476c56'}};})}]
  },true);
 }
 function publish(){if(!model)return;active=true;location.hash='overview';sync();requestAnimationFrame(function(){render();byId('csvHome').scrollIntoView({block:'start',behavior:'instant'});byId('csvHomeTitle').focus({preventScroll:true});});}
 document.addEventListener('flu:csv-loaded',function(event){
  model=event.detail.model;title=event.detail.title;var d=defaults(model);
  byId('csvCategory').replaceChildren();if(d.yearIndex>=0&&d.monthIndex>=0)option(byId('csvCategory'),'period','年月组合');model.headers.forEach(function(name,i){option(byId('csvCategory'),String(i),name);});byId('csvCategory').value=d.category;
  byId('csvMetric').replaceChildren();d.metrics.forEach(function(i){option(byId('csvMetric'),String(i),model.headers[i]);});if(d.metric<0)option(byId('csvMetric'),'-1','没有数值列');byId('csvMetric').value=String(d.metric);
  byId('csvYearFilter').replaceChildren();option(byId('csvYearFilter'),'','全部年份');if(d.yearIndex>=0)Array.from(new Set(model.rows.map(function(row){return row[d.yearIndex];}))).sort().forEach(function(year){option(byId('csvYearFilter'),year,year);});byId('csvYearLabel').hidden=d.yearIndex<0;
  byId('csvAggregation').value='records';byId('csvOrder').value='source';byId('csvChartSearch').value='';publish();
 });
 document.addEventListener('flu:csv-cleared',function(){model=null;active=false;if(chart){chart.dispose();chart=null;}sync();});
 ['csvCategory','csvMetric','csvAggregation','csvOrder','csvYearFilter'].forEach(function(id){byId(id).addEventListener('change',render);});byId('csvChartSearch').addEventListener('input',render);
 byId('csvBackAtlas').addEventListener('click',function(){active=false;sync();byId('pageTitle').scrollIntoView({block:'start'});});
 byId('csvPublish').addEventListener('click',publish);
 byId('csvViewTable').addEventListener('click',function(){location.hash='data';sync();requestAnimationFrame(function(){byId('csvResult').scrollIntoView({block:'start'});byId('csvSearch').focus({preventScroll:true});});});
 byId('csvChartDownload').addEventListener('click',function(){if(!chart||!latest||!latest.entries.length)return;save(title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'-条形图.png',chart.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#f3f0e7'}));});
 root.addEventListener('hashchange',sync);root.addEventListener('resize',function(){if(chart)chart.resize();});
 if(root.ResizeObserver){resizeObserver=new ResizeObserver(function(){if(chart)chart.resize();});resizeObserver.observe(byId('csvBarChart'));}
 var motion=root.matchMedia('(prefers-reduced-motion: reduce)');if(motion.addEventListener)motion.addEventListener('change',function(){if(model&&active)render();});
})(typeof window==='object'?window:globalThis);

/* 三维场景、时间轴、后台统计、快捷导航与可分享状态。 */
(function (window, document) {
  'use strict';
  var byId = function (id) { return document.getElementById(id); };
  var query = new URLSearchParams(window.location.search);
  var initial = {dataset:query.get('dataset'),year:query.get('year'),region:query.get('region'),group:query.get('group')};
  var consumed = false, controller = null, last = null, worker = null, workerFailed = false, requestId = 0;
  var mode = ['corolla','strata','orbit','paper'].indexOf(query.get('scene')) >= 0 ? query.get('scene') : 'corolla';
  var month = Math.round(Math.max(0, Math.min(12, Number(query.get('month')) || 0)));
  var active = true, inView = true, available = null, playing = false, playTimer = null, toastTimer = null, visibilityObserver = null;
  var expanded = false, expandedOpener = null, commandIndex = 0, visibleCommands = [], lastCommands = [];
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)'), reduced = motionQuery.matches;
  var timelineReady = false, readingAnimations = [];
  var dissolveAnimations = [], dissolveTargets = [], pendingChange = null, dissolveVersion = 0, applyingChange = false;
  var palette = ['#31594b','#88a99c','#c3a49e','#b99b62','#b75a48','#6d8085','#958a6d','#8b7581'];
  var descriptions = {
    corolla:'角度是月份，花瓣长度是 ILI%，颜色区分年度。拖拽旋转，点击选择。',
    strata:'横向是月份，纵深是年度，高度是 ILI%。圆点为月度记录；平滑轮廓仅作视觉连接，缺测断开。',
    orbit:'每个节点是一条月度记录，位置沿年月顺序展开，高度随 ILI% 变化。',
    paper:'角度是月份，花瓣长度是 ILI%，颜色区分年度。共享刻度，缺测不绘制。'
  };
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function canRender() { return !!last&&active&&inView&&mode!=='paper'&&!document.hidden; }
  function syncSound() { if(window.FluSoundPanel)window.FluSoundPanel.setFrame({month:month,mode:mode,hasData:!!last&&last.series.some(function(row){return row.values.some(finite);})}); }
  function cancelReadingAnimations() { readingAnimations.forEach(function(animation){animation.cancel();});readingAnimations=[]; }
  function animateReading() {
    cancelReadingAnimations();if(reduced)return;
    ['sceneInspector','sceneMonthLabel'].forEach(function(id){var e=byId(id);if(e&&typeof e.animate==='function')readingAnimations.push(e.animate([{opacity:.6,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'}));});
  }
  function moveTimeline(value,previous,options) {
    options=options||{};if(timelineReady&&value===previous&&!options.immediate)return;
    var e=byId('timelineScrubber'),direct=reduced||!timelineReady||!!options.immediate||!!options.direct;
    e.classList.toggle('is-direct',direct);e.classList.toggle('is-wrapping',!direct&&previous===12&&value===1);
    e.style.setProperty('--timeline-position',(value/12*100)+'%');e.style.setProperty('--timeline-fraction',String(value/12));e.dataset.month=String(value);timelineReady=true;
  }
  function paintPlayback() {
    byId('timeControl').classList.toggle('is-playing',playing);byId('scenePlay').setAttribute('aria-pressed',String(playing));byId('scenePlay').setAttribute('aria-label',playing?'暂停月份时间轴':'播放月份时间轴');
  }
  function settleTimeline() { cancelReadingAnimations();moveTimeline(month,month,{immediate:true}); }
  function finishDissolve(commitPending) {
    var task=pendingChange;pendingChange=null;dissolveVersion++;
    dissolveAnimations.forEach(function(animation){animation.cancel();});dissolveAnimations=[];
    dissolveTargets.forEach(function(e){e.style.opacity='';e.style.transform='';});dissolveTargets=[];
    byId('atlasSection').removeAttribute('aria-busy');
    if(commitPending&&task){applyingChange=true;try{task();}finally{applyingChange=false;}}
  }
  function dissolveChange(commit,kind) {
    if(applyingChange){commit();return;}
    if(reduced||!active||!inView||!last){finishDissolve(false);commit();return;}
    var ids=[mode==='paper'?'atlasChart':'specimenMount','sceneInspector','sceneMonthLabel'];
    if(kind==='year')ids=ids.concat(['heroRate','heroScope','signalSummary']);
    var targets=ids.map(byId).concat(dissolveTargets).filter(function(e,i,all){return e&&all.indexOf(e)===i&&!e.hidden&&e.getBoundingClientRect().height>0;});
    if(!targets.length||targets.some(function(e){return typeof e.animate!=='function';})){finishDissolve(false);commit();return;}
    var starts=targets.map(function(e){var style=typeof window.getComputedStyle==='function'?window.getComputedStyle(e):null;return {opacity:style?Number(style.opacity):1,transform:style?style.transform:'none'};});
    finishDissolve(false);cancelReadingAnimations();pendingChange=commit;dissolveTargets=targets;
    var version=++dissolveVersion,outDuration=kind==='year'?280:220,inDuration=kind==='year'?720:640;
    byId('atlasSection').setAttribute('aria-busy','true');
    dissolveAnimations=targets.map(function(e,i){return e.animate([{opacity:starts[i].opacity,transform:starts[i].transform},{opacity:0,transform:starts[i].transform}],{duration:outDuration,easing:'ease-out',fill:'forwards'});});
    dissolveAnimations[0].onfinish=function(){
      if(version!==dissolveVersion)return;
      targets.forEach(function(e){e.style.opacity='0';});
      dissolveAnimations.forEach(function(animation){animation.cancel();});dissolveAnimations=[];
      var task=pendingChange;pendingChange=null;applyingChange=true;
      try{if(task)task();}finally{applyingChange=false;}
      if(version!==dissolveVersion)return;
      dissolveAnimations=targets.map(function(e){return e.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:inDuration,delay:40,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});});
      dissolveAnimations[0].onfinish=function(){if(version===dissolveVersion)finishDissolve(false);};
    };
  }
  function changeYear(year,commit) {
    if(last&&(String(last.selectedYear)!==String(year)||pendingChange))dissolveChange(commit,'year');else commit();
  }
  function requestMonth(value) { dissolveChange(function(){setMonth(value,{immediate:true,glide:true});},'month'); }
  function text(id, value) { var e=byId(id);if(e)e.textContent=value; }
  function notify(message) { var e=byId('experienceToast');e.textContent=message;e.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(function(){e.hidden=true;},3500); }
  function select(year, chosenMonth) {
    if(!last||typeof last.onSelect!=='function')return;
    var callback=last.onSelect,commit=function(){callback(String(year),chosenMonth);if(chosenMonth)setMonth(chosenMonth,{immediate:true});};
    if(String(last.selectedYear)!==String(year)||pendingChange)changeYear(year,commit);else if(chosenMonth&&chosenMonth!==month)dissolveChange(commit,'month');else commit();
  }
  function defaultPoint() {
    if(!last)return null;var row=last.series.find(function(s){return String(s.year)===String(last.selectedYear);});if(!row)return null;
    if(month)return {year:row.year,month:month,value:row.values[month-1],context:'月份切片'};
    var peak=null;row.values.forEach(function(v,i){if(finite(v)&&(!peak||v>peak.value))peak={year:row.year,month:i+1,value:v,context:'年度峰月'};});return peak;
  }
  function inspect(point) {
    point=point||defaultPoint();if(!point){text('pointValue','—');text('pointDate','暂无观测');text('pointCompare','缺测位置不会作为零值');return;}
    text('pointContext',point.context||'光标观测');
    var number=byId('pointValue');number.textContent=finite(point.value)?point.value.toFixed(2):'—';var unit=document.createElement('small');unit.textContent='%';number.appendChild(unit);
    text('pointDate',point.year+' 年 · '+point.month+' 月');
    var previous=last&&last.series.find(function(row){return +row.year===+point.year-1;});var previousValue=previous&&previous.values[point.month-1];
    text('pointCompare',finite(point.value)&&finite(previousValue)?'较上年同月 '+(point.value-previousValue>=0?'+':'')+(point.value-previousValue).toFixed(2)+' 个百分点':finite(point.value)?'当前筛选的月度 ILI%':'该月份缺测，未补零');
  }
  function writeURL(dataset,year) {
    var url=new URL(window.location.href);url.searchParams.set('dataset',dataset||'database');url.searchParams.set('year',year);
    var region=byId('region'),group=byId('group');if(region)url.searchParams.set('region',region.value);if(group)url.searchParams.set('group',group.value);
    url.searchParams.set('scene',mode);if(month)url.searchParams.set('month',String(month));else url.searchParams.delete('month');window.history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  function syncURL() { if(last)writeURL(last.meta&&last.meta.id,last.selectedYear); }
  function initRenderer() {
    if(controller)return;
    if(!window.FluSpecimen){available=false;mode='paper';text('sceneEngine','三维引擎未就绪 · 可用平面图谱');return;}
    controller=window.FluSpecimen.create('specimenMount',{
      onSelect:function(year,m){select(year,m);},onHover:inspect,
      onReady:function(info){var wasAvailable=available;available=!!info.available;text('sceneEngine',available?'三维 · 本地绘制':(info.reason||'当前环境使用平面图谱'));byId('sceneEngine').title=available?info.renderer+' · '+info.pointCount+' 条观测 · 按需绘制':(info.reason||'三维不可用');byId('specimenMount').dataset.renderer=available?'webgl2':'unavailable';if(!available){finishDissolve(true);mode='paper';applyMode();}else if(wasAvailable===false&&controller&&last){controller.update(last);}document.querySelectorAll('[data-scene]').forEach(function(b){b.disabled=!available;});}
    });
  }
  function renderPaper() { if(last&&window.FluAtlas)FluAtlas.render('atlasChart',last); }
  function applyMode() {
    var paper=mode==='paper';byId('specimenMount').hidden=paper;byId('atlasChart').hidden=!paper;
    byId('sceneInspector').hidden=paper;byId('sceneMonth').disabled=paper;byId('timelineScrubber').classList.toggle('is-disabled',paper);byId('scenePlay').disabled=paper||reduced;byId('sceneReset').disabled=paper;
    byId('scenePaper').setAttribute('aria-pressed',String(paper));byId('scenePaper').textContent=paper?'平面 · 已选择':'平面图谱';
    document.querySelectorAll('[data-scene]').forEach(function(b){b.classList.toggle('is-active',b.dataset.scene===mode);b.setAttribute('aria-pressed',String(b.dataset.scene===mode));});
    text('sceneSemantics',descriptions[mode]);
    if(paper){stopPlay();renderPaper();if(controller)controller.setActive(false);}else if(controller){controller.setMode(mode);controller.setMonth(month||null);controller.setActive(canRender());controller.resize();}
    syncURL();syncSound();
  }
  function setMode(next) {
    if(['corolla','strata','orbit','paper'].indexOf(next)<0)return;
    if(next!=='paper'&&available===false){notify('当前环境无法启用三维，平面图谱仍可使用。');return;}
    finishDissolve(true);mode=next;applyMode();
  }
  function setMonth(value,options) {
    options=options||{};var previous=month;month=Math.round(Math.max(0,Math.min(12,Number(value)||0)));if(options.immediate||reduced)cancelReadingAnimations();byId('sceneMonth').value=month;text('sceneMonthLabel',month?month+' 月':'全年');moveTimeline(month,previous,options.glide?{}:options);
    byId('sceneMonth').setAttribute('aria-valuetext',month?month+'月':'全年');if(controller)controller.setMonth(month||null,{duration:options.direct?180:650,immediate:!!options.immediate||reduced});inspect();if(previous!==month&&!options.immediate&&!reduced)animateReading();syncURL();syncSound();
  }
  function stopPlay() { playing=false;clearInterval(playTimer);playTimer=null;paintPlayback(); }
  function togglePlay() {
    if(playing){stopPlay();return;}if(mode==='paper'||reduced||!last)return;
    playing=true;paintPlayback();
    if(!month)requestMonth(1);playTimer=setInterval(function(){requestMonth(month>=12?1:month+1);},1800);
  }
  function yearsLegend() {
    var target=byId('sceneYears'),signature=last.years.join('|');
    if(target.dataset.years!==signature){target.replaceChildren();target.dataset.years=signature;last.years.forEach(function(year,index){var b=document.createElement('button');b.type='button';b.dataset.year=String(year);b.setAttribute('aria-label','观察 '+year+' 年');var swatch=document.createElement('i');swatch.style.backgroundColor=palette[index%palette.length];b.appendChild(swatch);b.appendChild(document.createTextNode(year));b.addEventListener('click',function(){select(year,null);});target.appendChild(b);});}
    Array.from(target.children).forEach(function(b){var chosen=b.dataset.year===String(last.selectedYear);b.classList.toggle('is-selected',chosen);b.setAttribute('aria-pressed',String(chosen));});
  }
  function analyze() {
    if(!last||workerFailed)return;requestId++;text('signalCorrelation','—');text('signalTrend','—');text('signalNeighbor','—');text('signalNote','正在以独立线程检验时间结构…');
    if(!worker){try{worker=new Worker(window.FluDemoAPI?'static/js/signal-worker.js':'/static/js/signal-worker.js');worker.onmessage=function(event){var result=event.data;if(result.id!==requestId||!last)return;if(!result.available){text('signalNote',result.error||'当前序列暂不能计算。');return;}
      text('signalCorrelation',finite(result.lag12.value)?'r '+result.lag12.value.toFixed(2):'样本不足');
      text('signalTrend',finite(result.trend.slopePerMonth)?(result.trend.slopePerMonth>=0?'+':'')+result.trend.slopePerMonth.toFixed(3):'—');
      text('signalNeighbor',result.nearestYear?result.nearestYear.year+' 年':'暂无对照');
      text('signalNote','趋势单位：百分点/月 · '+result.coverage.observed+' 个观测 · '+result.anomalies.length+' 个统计偏离月；非医学预警。');
      byId('signalCorrelation').title='真实年月对齐的12月滞后 Pearson 相关，使用 '+result.lag12.pairs+' 对观测，非准确率。';byId('signalTrend').title='Theil–Sen 成对斜率中位数'+(result.trend.sampled?'（已等距抽样）':'');byId('signalNeighbor').title=result.nearestYear?'完整年度 z 标准化形态距离 '+result.nearestYear.distance.toFixed(3)+'，越小越相似':'需要至少两个完整年度';
    };worker.onerror=function(){workerFailed=true;text('signalCorrelation','—');text('signalTrend','—');text('signalNeighbor','—');text('signalNote','后台统计暂不可用，图谱及精确读数仍可使用。');if(worker){worker.terminate();worker=null;}};}catch(error){workerFailed=true;text('signalNote','当前浏览器不支持后台统计。');return;}}
    worker.postMessage({id:requestId,series:last.series,selectedYear:last.selectedYear});
  }
  function update(payload) {
    last=payload;byId('specimenMount').style.visibility='';initRenderer();if(controller&&available!==false){controller.update(payload);controller.setMonth(month||null);}yearsLegend();applyMode();setMonth(month,{immediate:true});inspect();analyze();
  }
  function clear() { finishDissolve(false);last=null;requestId++;stopPlay();settleTimeline();if(window.FluAtlas)FluAtlas.clear();if(controller)controller.setActive(false);byId('specimenMount').style.visibility='hidden';byId('sceneYears').replaceChildren();delete byId('sceneYears').dataset.years;text('pointValue','—');text('pointDate','等待数据');text('pointCompare','');text('signalCorrelation','—');text('signalTrend','—');text('signalNeighbor','—');text('signalNote','等待观测数据…');syncSound(); }
  function setActive(value) { if(!value)finishDissolve(true);active=!!value;byId('specimenMount').style.visibility=last?'':'hidden';if(!active){stopPlay();settleTimeline();if(expanded)toggleExpanded(false,false);}if(controller)controller.setActive(canRender());if(window.FluSoundPanel)window.FluSoundPanel.setPageActive(active); }
  function toggleExpanded(force,restoreFocus) {
    var next=typeof force==='boolean'?force:!expanded;if(next===expanded)return;
    if(next)expandedOpener=document.activeElement;
    expanded=next;byId('atlasSection').classList.toggle('is-expanded',expanded);document.body.classList.toggle('scene-is-expanded',expanded);
    byId('sceneExpand').setAttribute('aria-label',expanded?'退出沉浸查看':'放大图谱');byId('sceneExpand').textContent=expanded?'×':'⤢';if(controller)requestAnimationFrame(function(){controller.resize();});
    if(!expanded){var opener=expandedOpener;expandedOpener=null;if(restoreFocus!==false&&opener&&opener.isConnected&&!opener.disabled&&opener.getBoundingClientRect().height>0&&typeof opener.focus==='function')opener.focus();}
  }
  function download(filename,url) { var a=document.createElement('a');a.download=filename;a.href=url;document.body.appendChild(a);a.click();a.remove(); }
  function framedImage(data, snapshot) {
    return new Promise(function(resolve,reject){var image=new Image();image.onload=function(){
      try{var canvas=document.createElement('canvas'),padding=40;canvas.width=image.width+padding*2;canvas.height=image.height+154;var ctx=canvas.getContext('2d');ctx.fillStyle='#f3f0e7';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#253d36';ctx.font='24px SimSun,serif';ctx.fillText('流感观测站 · '+snapshot.name,padding,39);ctx.font='12px "Microsoft YaHei",sans-serif';ctx.fillStyle='#74846f';ctx.fillText(snapshot.scope+' · '+snapshot.year+' 年 · '+snapshot.month,padding,63);ctx.drawImage(image,padding,85);ctx.strokeStyle='#cdd3c3';ctx.beginPath();ctx.moveTo(padding,canvas.height-47);ctx.lineTo(canvas.width-padding,canvas.height-47);ctx.stroke();ctx.font='11px "Microsoft YaHei",sans-serif';ctx.fillText(snapshot.source,padding,canvas.height-25);resolve(canvas.toDataURL('image/png'));}catch(error){reject(error);}
    };image.onerror=reject;image.src=data;});
  }
  function exportImage() {
    if(!last)return;
    if(mode==='paper'){var svg=byId('atlasChart').querySelector('svg');if(!svg)return;var clone=svg.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');var blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob);download('流感季候图谱-'+last.selectedYear+'.svg',url);setTimeout(function(){URL.revokeObjectURL(url);},1000);return;}
    if(!controller)return;var snapshot={year:last.selectedYear,scope:last.scope||'',month:month?month+' 月切片':'全年观测',name:{corolla:'季候花冠',strata:'年度山脊',orbit:'观测星轨'}[mode],source:last.meta&&last.meta.kind==='demo'?'教学模拟数据 · 不代表真实疫情 · ILI% 为流感样病例比例':'用户导入记录 · '+(last.meta&&last.meta.name||'月度数据')};try{var url=controller.capture();Promise.resolve(url).then(function(data){if(!data||typeof data!=='string')throw new Error('empty capture');return framedImage(data,snapshot);}).then(function(data){download('流感数据雕塑-'+snapshot.year+'.png',data);notify('已保存当前视角与数据说明。');}).catch(function(){notify('当前画面暂不能保存，可切换平面图谱导出 SVG。');});}catch(error){notify('当前画面暂不能保存，可切换平面图谱导出 SVG。');}
  }
  function commands() {
    var list=[{label:'季候图谱',detail:'返回交互观测场景',run:function(){window.location.hash='overview';}},{label:'时间与人群',detail:'热力谱与年龄组分析',run:function(){window.location.hash='analysis';}},{label:'趋势推演',detail:'历史回测与六个月外推',run:function(){window.location.hash='forecast';}},{label:'数据档案',detail:'来源、质量与导入',run:function(){window.location.hash='data';}}];
    [['corolla','季候花冠'],['strata','年度山脊'],['orbit','观测星轨'],['paper','平面图谱']].forEach(function(item){list.push({label:item[1],detail:'切换观测形态',run:function(){window.location.hash='overview';setMode(item[0]);}});});
    if(last)last.years.forEach(function(year){list.push({label:year+' 年',detail:'观察该年度',run:function(){window.location.hash='overview';select(year,null);}});});return list;
  }
  function drawCommands() {
    var term=byId('commandSearch').value.trim().toLowerCase();visibleCommands=lastCommands.filter(function(c){return(c.label+' '+c.detail).toLowerCase().indexOf(term)>=0;});commandIndex=0;
    var container=byId('commandResults');container.replaceChildren();visibleCommands.forEach(function(c,index){var b=document.createElement('button');b.type='button';var title=document.createElement('span'),detail=document.createElement('small');title.textContent=c.label;detail.textContent=c.detail;b.append(title,detail);b.classList.toggle('is-current',index===0);b.addEventListener('click',function(){byId('commandDialog').close();c.run();});container.appendChild(b);});if(!visibleCommands.length)text('commandResults','没有匹配的功能或年份。');
  }
  function openCommands() { if(byId('commandDialog').open)return;lastCommands=commands();byId('commandSearch').value='';drawCommands();byId('commandDialog').showModal();byId('commandSearch').focus(); }
  document.querySelectorAll('[data-scene]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.scene);});});
  byId('scenePaper').addEventListener('click',function(){setMode('paper');});byId('sceneMonth').addEventListener('input',function(){var chosen=this.value;finishDissolve(true);stopPlay();setMonth(chosen,{direct:true});});byId('scenePlay').addEventListener('click',togglePlay);
  byId('sceneReset').addEventListener('click',function(){if(controller)controller.reset();});byId('sceneExpand').addEventListener('click',function(){toggleExpanded();});byId('sceneExport').addEventListener('click',exportImage);
  if(byId('mobileExplore'))byId('mobileExplore').addEventListener('click',function(){toggleExpanded(true);byId('sceneExpand').focus();});
  byId('commandOpen').addEventListener('click',openCommands);byId('commandClose').addEventListener('click',function(){byId('commandDialog').close();});byId('commandSearch').addEventListener('input',drawCommands);
  byId('commandDialog').addEventListener('click',function(event){if(event.target===this){var rect=this.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)this.close();}});
  byId('commandSearch').addEventListener('keydown',function(event){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();commandIndex=Math.max(0,Math.min(visibleCommands.length-1,commandIndex+(event.key==='ArrowDown'?1:-1)));Array.from(byId('commandResults').children).forEach(function(b,i){b.classList.toggle('is-current',i===commandIndex);if(i===commandIndex)b.scrollIntoView({block:'nearest'});});}else if(event.key==='Enter'&&visibleCommands[commandIndex]){event.preventDefault();byId('commandDialog').close();visibleCommands[commandIndex].run();}});
  document.addEventListener('keydown',function(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openCommands();}if(byId('commandDialog').open)return;if(event.key==='Escape'&&expanded){event.preventDefault();toggleExpanded(false);}if(event.key==='Tab'&&expanded){var elements=Array.from(byId('atlasSection').querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')).filter(function(e){return e.getBoundingClientRect().height>0;});if(elements.length&&event.shiftKey&&document.activeElement===elements[0]){event.preventDefault();elements[elements.length-1].focus();}else if(elements.length&&!event.shiftKey&&document.activeElement===elements[elements.length-1]){event.preventDefault();elements[0].focus();}}});
  document.addEventListener('visibilitychange',function(){if(document.hidden){finishDissolve(true);stopPlay();settleTimeline();}if(controller)controller.setActive(canRender());});
  function motionChanged(event){reduced=event.matches;if(reduced){finishDissolve(true);stopPlay();cancelReadingAnimations();setMonth(month,{immediate:true});}byId('scenePlay').disabled=mode==='paper'||reduced;}
  if(typeof motionQuery.addEventListener==='function')motionQuery.addEventListener('change',motionChanged);
  if(window.IntersectionObserver){visibilityObserver=new IntersectionObserver(function(entries){inView=entries[0].isIntersecting;if(!inView){finishDissolve(true);stopPlay();settleTimeline();}if(controller)controller.setActive(canRender());},{rootMargin:'80px'});visibilityObserver.observe(byId('sceneViewport'));}
  window.addEventListener('beforeunload',function(){finishDissolve(false);stopPlay();cancelReadingAnimations();if(typeof motionQuery.removeEventListener==='function')motionQuery.removeEventListener('change',motionChanged);if(visibilityObserver)visibilityObserver.disconnect();if(worker)worker.terminate();if(controller)controller.dispose();});
  window.FluExperience={update:update,clear:clear,setActive:setActive,setMode:setMode,setMonth:setMonth,changeYear:changeYear,syncFilters:writeURL,
    initialDataset:function(){return initial.dataset;},consumeFilters:function(dataset){if(consumed)return{};consumed=true;return initial.dataset&&initial.dataset!==dataset?{}:initial;},
    getState:function(){return {mode:mode,month:month,playing:playing,active:active,available:available,points:last?last.series.reduce(function(n,s){return n+s.values.filter(finite).length;},0):0,renderer:controller?controller.getState():null};}};
})(window,document);

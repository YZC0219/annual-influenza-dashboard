/* Optional listening controls. Sound starts only from the main button. */
(function (window, document) {
  'use strict';
  var byId=function(id){return document.getElementById(id);};
  var toggle=byId('soundToggle'),volume=byId('soundVolume'),mute=byId('soundMute');
  if(!toggle||!volume||!mute)return;
  var controller=null,frame={month:0,mode:'corolla',hasData:false},previousVolume=0.24;
  var state={enabled:false,playing:false,volume:0.24,status:'off'},disposed=false;
  function clamp(value){value=Number(value);return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0.24;}
  function draw(info){
    state=info;
    var amount=clamp(info.volume),silent=amount===0;
    if(amount>0)previousVolume=amount;
    var status=info.status||'off',labels={off:'点击开启',starting:'正在开启…',playing:silent?'静音中':'正在播放',paused:'已暂停',unavailable:'环境音暂不可用'};
    byId('soundscape').dataset.state=status;
    toggle.setAttribute('aria-pressed',String(!!info.enabled));
    toggle.setAttribute('aria-label',info.enabled?'关闭季候环境音':'开启季候环境音');
    var statusText=labels[status]||'点击重试';
    if(byId('soundStatus').textContent!==statusText)byId('soundStatus').textContent=statusText;
    toggle.title=info.reason||'无歌词的轻柔环境音，随月份与形态变化';
    toggle.disabled=status==='unavailable';volume.disabled=status==='unavailable';mute.disabled=status==='unavailable';
    volume.value=Math.round(amount*100);volume.setAttribute('aria-valuetext',silent?'静音':Math.round(amount*100)+'%');
    byId('soundVolumeValue').textContent=Math.round(amount*100)+'%';
    mute.setAttribute('aria-pressed',String(silent));mute.setAttribute('aria-label',silent?'取消环境音静音':'静音环境音');mute.title=silent?'取消静音':'静音';
  }
  function drawSeason(){
    var month=frame.month,season=!month?'四时':month===12||month<=2?'冬藏':month<=5?'春生':month<=8?'夏长':'秋敛';
    byId('soundSeason').textContent=season+' · '+(month?month+' 月声景':'柔和环境音');
  }
  try{
    if(!window.FluSound)throw new Error('当前浏览器无法开启环境音');
    controller=window.FluSound.create({onState:draw});controller.setVolume(0.24);controller.setFrame(frame);
  }catch(error){draw({enabled:false,playing:false,volume:0.24,status:'unavailable',reason:error.message});}
  toggle.addEventListener('click',function(){
    if(!controller||disposed)return;
    try{Promise.resolve(controller.toggle()).catch(function(){draw(Object.assign({},controller.getState(),{enabled:false,playing:false,status:'off',reason:'请再次点击开启环境音'}));});}
    catch(error){draw(Object.assign({},state,{enabled:false,playing:false,status:'off',reason:'请再次点击开启环境音'}));}
  });
  volume.addEventListener('input',function(){if(controller&&!disposed)controller.setVolume(clamp(Number(this.value)/100));});
  mute.addEventListener('click',function(){if(controller&&!disposed)controller.setVolume(state.volume===0?previousVolume:0);});
  function setFrame(next){
    frame={month:Math.round(Math.max(0,Math.min(12,Number(next.month)||0))),mode:next.mode||'corolla',hasData:!!next.hasData};
    drawSeason();if(controller&&!disposed)controller.setFrame(frame);
  }
  function setPageActive(active){if(controller&&!disposed)controller.setPageActive(!!active);}
  function dispose(){if(disposed)return;disposed=true;if(controller)controller.dispose();}
  window.FluSoundPanel={setFrame:setFrame,setPageActive:setPageActive,dispose:dispose};
})(window,document);

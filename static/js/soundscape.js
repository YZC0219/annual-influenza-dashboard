/* Original local ambient score, synthesized only after an explicit user toggle.
 * Months choose musical notes; no sound parameter represents ILI or medical risk.
 */
(function (window, document) {
  'use strict';
  var CHORDS = [[50, 53, 57, 64], [46, 53, 57, 62], [48, 53, 57, 67], [48, 55, 62, 67]];
  var MONTH_NOTES = [62, 65, 67, 69, 72, 74, 72, 69, 67, 65, 62, 69];
  var MELODY = [69, 74, 72, 65, 67, 69, 62, 67];
  var MODE_FILTER = {corolla: 1250, strata: 950, orbit: 1450, paper: 1100};
  var MASTER_LIMIT = 0.28, FADE_OUT = 0.50, FADE_IN = 0.90;
  function frequency(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

  function create(options) {
    options = options || {};
    var context = null, graph = null, enabled = false, playing = false, volume = 0.24;
    var status = 'off', reason = '', disposed = false, pageActive = true, pagePresent = true;
    var visible = document.visibilityState !== 'hidden' && document.hidden !== true;
    var frame = {month: 0, mode: 'corolla', hasData: false};
    var timer = null, pauseTimer = null, pauseResolve = null, worker = null;
    var revision = 0, settledRevision = -1, explicitRevision = -1, lastEmission = '';
    var nodes = new Set(), continuous = new Set(), notes = new Set();
    var nextChord = 0, nextNote = 0, chordIndex = 0, melodyIndex = 0;
    var pendingMonth = null, lastMonthTone = -Infinity;

    function getState() {
      var result = {enabled: enabled, playing: playing, volume: volume, status: status};
      if (reason) result.reason = reason;
      return result;
    }
    function emit() {
      var state = getState(), serialized = JSON.stringify(state);
      if (serialized === lastEmission) return; lastEmission = serialized;
      if (typeof options.onState === 'function') { try { options.onState(state); } catch (_) {} }
    }
    function eligible() { return enabled && pageActive && pagePresent && visible && !disposed; }
    function own(node) { nodes.add(node); return node; }
    function connect(node, target) { node.connect(target); return node; }
    function hold(parameter, now) {
      if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
      else { var current = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(current, now); }
    }
    function fade(parameter, value, duration) {
      var now = context.currentTime; hold(parameter, now);
      if (!duration) parameter.setValueAtTime(value, now);
      else parameter.linearRampToValueAtTime(value, now + duration);
    }
    function oscillator(type, value) {
      var source = own(context.createOscillator()); source.type = type; source.frequency.value = value;
      continuous.add(source); return source;
    }
    function gain(value) { var node = own(context.createGain()); node.gain.value = value; return node; }
    function panner(value) {
      if (typeof context.createStereoPanner !== 'function') return gain(1);
      var node = own(context.createStereoPanner()); node.pan.value = value; return node;
    }
    function buildGraph() {
      var mix = gain(1), master = gain(0), limiter = own(context.createDynamicsCompressor());
      limiter.threshold.value = -22; limiter.knee.value = 16; limiter.ratio.value = 8;
      limiter.attack.value = 0.015; limiter.release.value = 0.50;
      connect(mix, master); connect(master, limiter); connect(limiter, context.destination);
      var padFilter = own(context.createBiquadFilter()); padFilter.type = 'lowpass'; padFilter.frequency.value = MODE_FILTER[frame.mode]; padFilter.Q.value = 0.4;
      var padBus = gain(0.65), noteBus = gain(0.65); connect(padFilter, padBus); connect(padBus, mix); connect(noteBus, mix);
      // A quiet, band-limited echo creates space without external reverb assets.
      var send = gain(0.18), delay = own(context.createDelay(1)), feedback = gain(0.18), wet = gain(0.32);
      var echoFilter = own(context.createBiquadFilter()); echoFilter.type = 'lowpass'; echoFilter.frequency.value = 1500; echoFilter.Q.value = 0.3;
      delay.delayTime.value = 0.43; connect(padBus, send); connect(noteBus, send); connect(send, delay);
      connect(delay, echoFilter); connect(echoFilter, feedback); connect(feedback, delay); connect(echoFilter, wet); connect(wet, mix);
      var voices = [], wave = null;
      if (typeof context.createPeriodicWave === 'function') wave = context.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.24, 0.09, 0.035, 0.015]));
      for (var i = 0; i < 4; i++) {
        var voice = gain(0.07), pan = panner((i - 1.5) * 0.28), partial = gain(0.35);
        var a = oscillator('triangle', frequency(CHORDS[0][i])), b = oscillator('sine', frequency(CHORDS[0][i]));
        if (wave && typeof a.setPeriodicWave === 'function') a.setPeriodicWave(wave);
        a.detune.value = -3; b.detune.value = 3; connect(a, voice); connect(b, partial); connect(partial, voice); connect(voice, pan); connect(pan, padFilter);
        var drift = oscillator('sine', 0.052 + i * 0.009), driftAmount = gain(1.4);
        connect(drift, driftAmount); connect(driftAmount, a.detune); connect(driftAmount, b.detune);
        voices.push([a, b]); a.start(); b.start(); drift.start();
      }
      // Filtered air has no pulse and sits far below the tonal voices.
      var buffer = context.createBuffer(2, Math.ceil(context.sampleRate * 3), context.sampleRate);
      for (var channel = 0; channel < 2; channel++) {
        var samples = buffer.getChannelData(channel); for (var sample = 0; sample < samples.length; sample++) samples[sample] = Math.random() * 2 - 1;
      }
      var air = own(context.createBufferSource()); air.buffer = buffer; air.loop = true; continuous.add(air);
      var high = own(context.createBiquadFilter()), low = own(context.createBiquadFilter()), airGain = gain(0.0038);
      high.type = 'highpass'; high.frequency.value = 120; high.Q.value = 0.25;
      low.type = 'lowpass'; low.frequency.value = 620; low.Q.value = 0.4;
      connect(air, high); connect(high, low); connect(low, airGain); connect(airGain, mix);
      var breeze = oscillator('sine', 0.045), breezeAmount = gain(0.001); connect(breeze, breezeAmount); connect(breezeAmount, airGain.gain); breeze.start(); air.start();
      graph = {master: master, padFilter: padFilter, noteBus: noteBus, voices: voices};
    }
    function contextChanged() {
      if (disposed || !context) return;
      if (context.state === 'closed') {
        enabled = false; stopSound(0); status = 'off'; reason = '音频连接已关闭，请点击播放重试。'; emit();
      } else if (playing && context.state !== 'running') {
        enabled = false; stopSound(0); status = 'off'; reason = '浏览器暂停了声音，请点击播放继续。'; emit();
      }
    }
    function releaseGraph() {
      continuous.forEach(function (source) { try { source.stop(); } catch (_) {} }); continuous.clear();
      notes.forEach(function (note) { note.sources.forEach(function (source) { try { source.stop(); } catch (_) {} }); }); notes.clear();
      nodes.forEach(function (node) { try { node.disconnect(); } catch (_) {} }); nodes.clear(); graph = null;
    }
    function ensureContext() {
      if (context && context.state !== 'closed' && graph) return true;
      releaseGraph();
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) { enabled = false; status = 'unavailable'; reason = '此浏览器不支持主题声音。'; emit(); return false; }
      try {
        // This function is called only by toggle(), never by a page/frame event.
        context = new AudioContext(); buildGraph();
        if (typeof context.addEventListener === 'function') context.addEventListener('statechange', contextChanged);
        return true;
      } catch (_) {
        releaseGraph(); if (context && typeof context.close === 'function') { try { Promise.resolve(context.close()).catch(function () {}); } catch (_) {} }
        context = null; enabled = false; status = 'unavailable'; reason = '音频设备暂不可用。'; emit(); return false;
      }
    }
    function stopNotes(duration) {
      if (!context) return;
      notes.forEach(function (note) {
        try { fade(note.envelope.gain, 0, duration); } catch (_) {}
        note.sources.forEach(function (source) { try { source.stop(context.currentTime + duration + 0.02); } catch (_) {} });
      });
      pendingMonth = null;
    }
    function playNote(midi, when, musicalMonth) {
      if (!playing || !eligible() || !frame.hasData || !graph || notes.size >= 8) return;
      var envelope = gain(0), tone = own(context.createOscillator()), harmonic = own(context.createOscillator());
      var partial = gain(0.23), pan = panner(musicalMonth ? Math.sin(musicalMonth / 12 * Math.PI * 2) * 0.32 : ((melodyIndex % 3) - 1) * 0.24);
      tone.type = 'sine'; harmonic.type = 'sine'; tone.frequency.value = frequency(midi); harmonic.frequency.value = frequency(midi) * 2.008;
      connect(tone, envelope); connect(harmonic, partial); connect(partial, envelope); connect(envelope, pan); connect(pan, graph.noteBus);
      envelope.gain.setValueAtTime(0, when); envelope.gain.linearRampToValueAtTime(musicalMonth ? 0.10 : 0.075, when + 0.045);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + 2.6); envelope.gain.linearRampToValueAtTime(0, when + 2.9);
      var note = {sources: [tone, harmonic], envelope: envelope}, remaining = 2;
      notes.add(note);
      function ended() {
        if (--remaining > 0) return; notes.delete(note);
        [tone, harmonic, partial, envelope, pan].forEach(function (node) { try { node.disconnect(); } catch (_) {} nodes.delete(node); });
      }
      tone.onended = ended; harmonic.onended = ended;
      tone.start(when); harmonic.start(when); tone.stop(when + 3); harmonic.stop(when + 3);
    }
    function chord(index, when) {
      if (!graph) return;
      graph.voices.forEach(function (pair, voice) { pair.forEach(function (source) {
        hold(source.frequency, when); source.frequency.linearRampToValueAtTime(frequency(CHORDS[index % CHORDS.length][voice]), when + 3.8);
      }); });
    }
    function clearTimer() { if (timer != null) window.clearTimeout(timer); timer = null; }
    function schedule() {
      clearTimer(); if (!playing || !eligible() || !context || context.state !== 'running') return;
      var now = context.currentTime, horizon = now + 0.55;
      if (nextChord <= horizon) { chordIndex = (chordIndex + 1) % CHORDS.length; chord(chordIndex, Math.max(now + 0.03, nextChord)); nextChord = Math.max(now, nextChord) + 16; }
      if (pendingMonth != null && now - lastMonthTone >= 0.35) {
        playNote(MONTH_NOTES[pendingMonth - 1], now + 0.04, pendingMonth); pendingMonth = null; lastMonthTone = now;
      }
      if (nextNote <= horizon) {
        if (frame.hasData) { playNote(MELODY[melodyIndex % MELODY.length], Math.max(now + 0.04, nextNote), 0); melodyIndex++; }
        nextNote = Math.max(now, nextNote) + 5.2 + (melodyIndex % 3) * 0.4;
      }
      timer = window.setTimeout(schedule, 180);
    }
    function startSound() {
      if (playing || !eligible() || !graph || context.state !== 'running') return;
      playing = true; reason = ''; status = 'playing';
      var now = context.currentTime; nextChord = now + 16; nextNote = now + 2.6;
      chord(chordIndex, now); fade(graph.master.gain, volume * MASTER_LIMIT, FADE_IN); schedule(); emit();
    }
    function stopSound(duration) {
      playing = false; clearTimer(); pendingMonth = null; stopNotes(duration);
      if (graph && context && context.state !== 'closed') {
        try { fade(graph.master.gain, 0, duration); } catch (_) {}
        graph.voices.forEach(function (pair) { pair.forEach(function (source) { try { hold(source.frequency, context.currentTime); } catch (_) {} }); });
      }
    }
    function wakePause() {
      if (pauseTimer != null) window.clearTimeout(pauseTimer); pauseTimer = null;
      if (pauseResolve) { var done = pauseResolve; pauseResolve = null; done(); }
    }
    function waitForFade() {
      return new Promise(function (resolve) {
        pauseResolve = resolve; pauseTimer = window.setTimeout(function () { pauseTimer = null; pauseResolve = null; resolve(); }, (FADE_OUT + 0.06) * 1000);
      });
    }
    async function drain() {
      try {
        while (!disposed) {
          var turn = revision;
          if (eligible() && context && graph) {
            if (!playing) { status = 'starting'; reason = ''; emit(); }
            try { if (context.state !== 'running') await context.resume(); }
            catch (error) {
              if (disposed) break;
              if (turn !== revision) continue;
              enabled = false; stopSound(0); status = 'off';
              reason = error && error.name === 'NotAllowedError' ? (turn === explicitRevision ? '浏览器尚未允许声音，请再次点击播放。' : '浏览器阻止自动恢复，请点击播放。') : '声音未能恢复，请点击播放重试。';
              emit(); settledRevision = turn; break;
            }
            if (disposed) break; if (turn !== revision) continue;
            if (context.state === 'running') startSound();
            else { enabled = false; stopSound(0); status = 'off'; reason = '声音仍被浏览器暂停，请点击播放。'; emit(); }
          } else {
            stopSound(FADE_OUT); status = enabled ? 'paused' : (status === 'unavailable' ? 'unavailable' : 'off');
            if (status !== 'unavailable') reason = ''; emit();
            if (context && context.state === 'running') {
              await waitForFade(); if (disposed) break; if (turn !== revision) continue;
              try { await context.suspend(); } catch (_) {}
              if (disposed) break; if (turn !== revision) continue;
            }
          }
          settledRevision = turn; if (turn === revision) break;
        }
      } catch (_) {
        if (!disposed) { enabled = false; stopSound(0); status = 'off'; reason = '主题声音暂不可用，请点击播放重试。'; emit(); }
        settledRevision = revision;
      }
    }
    function pump() {
      if (disposed) return Promise.resolve(getState());
      if (!worker) worker = drain().finally(function () { worker = null; });
      return worker.then(function () { return !disposed && settledRevision !== revision ? pump() : getState(); });
    }
    function reconcile(explicit) {
      revision++; if (explicit) explicitRevision = revision; wakePause(); return pump();
    }
    function toggle() {
      if (disposed) return Promise.resolve(getState());
      enabled = !enabled; reason = '';
      if (enabled && !ensureContext()) return Promise.resolve(getState());
      return reconcile(true);
    }
    function setVolume(value) {
      if (disposed || !Number.isFinite(Number(value))) return;
      volume = clamp(Number(value), 0, 1);
      if (graph && context && context.state !== 'closed') {
        // A literal zero cancels any queued fade-in and sets digital silence now.
        try { fade(graph.master.gain, playing ? volume * MASTER_LIMIT : 0, volume === 0 ? 0 : 0.20); } catch (_) {}
      }
      emit();
    }
    function setFrame(next) {
      if (disposed || !next) return; var priorMonth = frame.month, priorData = frame.hasData, priorMode = frame.mode;
      if (Object.prototype.hasOwnProperty.call(next, 'month')) frame.month = Number.isInteger(+next.month) && +next.month >= 0 && +next.month <= 12 ? +next.month : 0;
      if (Object.prototype.hasOwnProperty.call(next, 'hasData')) frame.hasData = next.hasData === true;
      if (Object.prototype.hasOwnProperty.call(MODE_FILTER, next.mode)) frame.mode = next.mode;
      if (priorData && !frame.hasData) stopNotes(0.16);
      if (playing && frame.hasData && frame.month > 0 && frame.month !== priorMonth) pendingMonth = frame.month;
      if (graph && priorMode !== frame.mode && context.state !== 'closed') {
        try { fade(graph.padFilter.frequency, MODE_FILTER[frame.mode], 1.2); } catch (_) {}
      }
    }
    function setPageActive(value) {
      if (disposed || pageActive === !!value) return; pageActive = !!value; reconcile(false);
    }
    function visibilityChanged() {
      if (disposed) return; var next = document.visibilityState !== 'hidden' && document.hidden !== true;
      if (visible === next) return; visible = next; reconcile(false);
    }
    function pageHidden(event) {
      if (disposed) return;
      if (event && event.persisted) { pagePresent = false; reconcile(false); }
      else dispose();
    }
    function pageShown() {
      if (disposed) return; pagePresent = true; visible = document.visibilityState !== 'hidden' && document.hidden !== true; reconcile(false);
    }
    function dispose() {
      if (disposed) return; disposed = true; revision++; enabled = false; playing = false; status = 'off'; reason = '';
      clearTimer(); wakePause(); releaseGraph();
      document.removeEventListener('visibilitychange', visibilityChanged); window.removeEventListener('pagehide', pageHidden); window.removeEventListener('pageshow', pageShown);
      if (context) {
        if (typeof context.removeEventListener === 'function') context.removeEventListener('statechange', contextChanged);
        if (context.state !== 'closed') { try { Promise.resolve(context.close()).catch(function () {}); } catch (_) {} }
      }
      emit();
    }
    document.addEventListener('visibilitychange', visibilityChanged); window.addEventListener('pagehide', pageHidden); window.addEventListener('pageshow', pageShown);
    emit();
    return {toggle: toggle, setVolume: setVolume, setFrame: setFrame, setPageActive: setPageActive, getState: getState, dispose: dispose};
  }
  window.FluSound = {create: create};
})(window, document);

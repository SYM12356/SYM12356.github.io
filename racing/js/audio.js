/* ============================================================
 * audio.js — WebAudio 简易音效：引擎轰鸣 + 缩圈警报 + 淘汰爆炸
 * ============================================================ */

const Sound = (() => {
  let ctx = null;
  let master = null;
  let engineOsc1 = null, engineOsc2 = null, engineGain = null, engineFilter = null;
  let muted = false;
  let started = false;

  function init() {
    if (started) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    started = true;
  }

  function startEngine() {
    if (!ctx) return;
    engineOsc1 = ctx.createOscillator();
    engineOsc1.type = 'sawtooth';
    engineOsc1.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineOsc2.frequency.value = 28;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.0;
    engineOsc1.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc1.start();
    engineOsc2.start();
  }

  function updateEngine(speedRatio, throttle) {
    if (!ctx || !engineOsc1) return;
    const t = ctx.currentTime;
    const f = 50 + speedRatio * 150 + throttle * 20;
    engineOsc1.frequency.setTargetAtTime(f, t, 0.08);
    engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    engineFilter.frequency.setTargetAtTime(240 + speedRatio * 500, t, 0.1);
    engineGain.gain.setTargetAtTime(muted ? 0 : 0.05 + speedRatio * 0.1, t, 0.15);
  }

  function beep(freq, dur, vol, type) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  function countdown() { beep(660, 0.12, 0.25); }
  function go() { beep(990, 0.3, 0.3); }
  function goal() { beep(523, 0.1, 0.3, 'square'); setTimeout(() => beep(784, 0.22, 0.3, 'square'), 100); }
  function jump() { beep(420, 0.09, 0.18, 'sine'); }
  function coin() { beep(880, 0.07, 0.2, 'sine'); setTimeout(() => beep(1320, 0.09, 0.18, 'sine'), 70); }
  function power() { beep(520, 0.1, 0.2, 'triangle'); setTimeout(() => beep(780, 0.14, 0.2, 'triangle'), 90); }
  function dash() { beep(240, 0.18, 0.2, 'sawtooth'); }
  function hit() { beep(150, 0.09, 0.25, 'square'); setTimeout(() => beep(110, 0.1, 0.18, 'square'), 60); }
  function alarm() { beep(220, 0.28, 0.35, 'sawtooth'); setTimeout(() => beep(220, 0.28, 0.3, 'sawtooth'), 320); }
  function whoosh() { beep(300, 0.12, 0.22, 'sine'); setTimeout(() => beep(700, 0.1, 0.16, 'sine'), 60); }
  function infected() { beep(140, 0.3, 0.3, 'square'); setTimeout(() => beep(110, 0.34, 0.28, 'square'), 260); }
  function crash() {
    if (!ctx || muted) return;
    const dur = 0.6;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }

  function setMuted(m) {
    muted = m;
    if (engineGain && ctx) engineGain.gain.setTargetAtTime(m ? 0 : 0.08, ctx.currentTime, 0.1);
  }
  function isMuted() { return muted; }

  return { init, startEngine, updateEngine, beep, countdown, go, goal, jump, coin, power, dash, hit, alarm, whoosh, infected, crash, setMuted, isMuted };
})();

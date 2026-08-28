/* =====================================================================
 * Jianying Jianghu Digital Edition - Web Audio synthesized SFX (no external files)
 * All sounds are synthesized from oscillators/noise: techniques, flips,
 * hits, ultimates, victory, etc.
 * Environments without AudioContext (or test stubs) stay silent and never throw.
 * ===================================================================== */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
      return ctx;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  // Envelope: fast attack + exponential decay
  function env(gainNode, t0, attack, peak, dur) {
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.linearRampToValueAtTime(peak, t0 + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
  }

  // Tone (with optional glide)
  function tone(freq, opts) {
    if (!ensure()) return;
    opts = opts || {};
    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + opts.slide), t0 + (opts.dur || 0.2));
    env(g, t0, 0.008, opts.peak || 0.2, opts.dur || 0.2);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + (opts.dur || 0.2) + 0.12);
  }

  // Noise (high-/low-pass filtered)
  function noise(dur, opts) {
    if (!ensure()) return;
    opts = opts || {};
    var t0 = ctx.currentTime + (opts.delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filt = ctx.createBiquadFilter();
    filt.type = opts.type || 'lowpass';
    filt.frequency.value = opts.hp || 800;
    var g = ctx.createGain();
    env(g, t0, 0.005, opts.peak || 0.3, dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  var SFX = {
    get muted() { return muted; },
    // Interaction feedback
    tick: function () { tone(620, { dur: 0.05, type: 'triangle', peak: 0.12 }); },
    select: function () { tone(760, { dur: 0.07, type: 'triangle', peak: 0.2 }); tone(1010, { dur: 0.09, type: 'triangle', peak: 0.14, delay: 0.045 }); },
    confirm: function () { tone(430, { dur: 0.12, type: 'square', peak: 0.1 }); tone(215, { dur: 0.14, type: 'square', peak: 0.08, delay: 0.02 }); },
    flip: function () { noise(0.2, { peak: 0.22, hp: 1400 }); tone(880, { dur: 0.12, type: 'sine', peak: 0.1, slide: -420 }); },
    move: function () { noise(0.24, { peak: 0.14, hp: 950 }); },
    // Combat
    hit: function () { noise(0.13, { peak: 0.38, hp: 320 }); tone(150, { dur: 0.16, type: 'sine', peak: 0.3, slide: -70 }); },
    bigHit: function () { noise(0.32, { peak: 0.5, hp: 220 }); tone(85, { dur: 0.42, type: 'sine', peak: 0.48, slide: -35 }); tone(230, { dur: 0.22, type: 'triangle', peak: 0.22, delay: 0.03 }); },
    poison: function () { noise(0.3, { peak: 0.1, hp: 2600 }); tone(320, { dur: 0.3, type: 'sine', peak: 0.07, slide: -170 }); },
    heal: function () { tone(523, { dur: 0.12, type: 'sine', peak: 0.1 }); tone(784, { dur: 0.16, type: 'sine', peak: 0.09, delay: 0.09 }); },
    reflect: function () { tone(1150, { dur: 0.15, type: 'triangle', peak: 0.16, slide: 320 }); },
    // Ultimate / ending
    ult: function () {
      tone(75, { dur: 0.95, type: 'sine', peak: 0.5, slide: -30 });
      tone(165, { dur: 0.6, type: 'triangle', peak: 0.28 });
      noise(0.5, { peak: 0.28, hp: 520 });
      tone(540, { dur: 0.5, type: 'sine', peak: 0.11, slide: 420, delay: 0.28 });
    },
    win: function () {
      tone(130, { dur: 0.9, type: 'sine', peak: 0.42, slide: -55 });
      tone(262, { dur: 0.75, type: 'triangle', peak: 0.22, delay: 0.12 });
      tone(392, { dur: 0.65, type: 'sine', peak: 0.14, delay: 0.28 });
      noise(0.5, { peak: 0.14, hp: 3000, delay: 0.05 });
    },
    draw: function () { tone(175, { dur: 0.7, type: 'sine', peak: 0.22, slide: -45 }); tone(88, { dur: 0.85, type: 'sine', peak: 0.18, delay: 0.18, slide: -20 }); },
    // Toggle
    toggle: function () {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    setMuted: function (m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    }
  };

  global.JY_SFX = SFX;
  if (typeof module !== 'undefined' && module.exports) module.exports = SFX;
})(typeof window !== 'undefined' ? window : globalThis);

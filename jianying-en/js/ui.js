/* =====================================================================
 * 《剑影江湖》电子版 —— 界面与热座流程
 * 依赖：data.js, engine.js（均为全局脚本，非模块，兼容 file:// 直开）
 * ===================================================================== */
(function () {
  'use strict';
  var DATA = window.JY_DATA, JY = window.JY;
  if (!DATA || !JY) { document.body.innerHTML = '<p style="padding:40px;font-size:18px">Failed to load: please make sure js/data.js and js/engine.js exist.</p>'; return; }

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var HERO_ORDER = ['liu', 'tie', 'li', 'tang', 'zhang'];
  var DIST_NAMES = ['0 Point-blank', '1 Close', '2 Mid', '3 Far', '4 Extreme'];
  var WEAPON_ICON = { 'Sword': '⚔', 'Fist': '👊', 'Blade': '🗡', 'Hidden': '🎯' };
  var PORTRAIT = { liu: 'S', tie: 'F', li: 'B', tang: 'N', zhang: 'T' };   // seal monograms: S=Sword F=Fist B=Blade N=Needle T=Tai Chi
  var PORTRAIT_ICON = { liu: '⚔', tie: '👊', li: '🗡', tang: '🎯', zhang: '☯' };
  // 印章风立绘（纯 CSS）
  function portraitHtml(heroId, size) {
    return '<span class="portrait ' + heroId + '" style="width:' + size + 'px;height:' + size + 'px">' +
      '<b>' + (PORTRAIT[heroId] || 'H') + '</b><i>' + (PORTRAIT_ICON[heroId] || '') + '</i></span>';
  }

  var UI = {
    game: null,
    screen: 'setup',
    phase: 'setup',          // setup|draft|yuanhu|adjust|select|pass|reveal|roundEnd
    heroSel: [null, null],
    sceneSel: null,          // 场景 id 或 'random'
    sel: [null, null],       // 本回合双方所选牌
    selector: 0,             // 当前选牌玩家
    logCount: 0,
    busy: false,
    yuanhuStage: 0,
    yuanhuSel: null,
    flipped: false,          // 亮牌翻牌状态
    flipDone: false,
    flipAnim: false,         // 正在播放翻牌动画
    p2AI: false,             // 人机对战：玩家二由电脑控制
    aiLevel: 'normal',       // AI 难度：easy / normal / hard
    statusSnap: null,        // 结算前状态快照（状态印章用）
    prevDist: undefined,     // 上一次渲染的距离（突进残影用）
    distFrom: null           // 位移起点
  };

  // ================= 工具 =================
  function who(pIdx) { return pIdx === 0 ? 'Player 1' : 'Player 2'; }
  function findCard(p, uid) {
    for (var i = 0; i < p.hand.length; i++) if (p.hand[i].uid === uid) return p.hand[i];
    if (p.ult && p.ult.uid === uid) return p.ult;
    return null;
  }
  function toast(msg) {
    var root = $('toast-root');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 320);
    }, 2000);
  }

  // ---------------- 夜墨主题 ----------------
  var THEME_KEY = 'jy_jianying_theme';
  function applyTheme(dark) {
    var root = document.documentElement;
    if (root) {
      if (dark) root.setAttribute('data-theme', 'dark');
      else root.removeAttribute('data-theme');
    }
    var box = $('opt-dark');
    if (box) box.checked = !!dark;
  }
  function loadTheme() {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY) === 'dark'; }
    catch (e) { return false; }
  }
  function saveTheme(dark) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { /* 忽略 */ }
  }

  // ---------------- 音效（Web Audio 合成；无 AudioContext 时静默） ----------------
  var SFX = (typeof window !== 'undefined' && window.JY_SFX) || null;
  function sfx(name) {
    if (SFX && SFX[name]) { try { SFX[name](); } catch (e) { /* 忽略 */ } }
  }
  function isAI(pIdx) { return UI.p2AI && pIdx === 1; }

  // ---------------- 战绩统计（localStorage；不可用时静默） ----------------
  var STATS_KEY = 'jy_jianying_stats_v1';
  function defaultStats() {
    return { games: 0, wins: { p1: 0, p2: 0, draw: 0, limit: 0 }, heroes: {}, turnsSum: 0, pairs: {} };
  }
  function loadStats() {
    try {
      if (typeof localStorage === 'undefined') return defaultStats();
      var raw = localStorage.getItem(STATS_KEY);
      if (!raw) return defaultStats();
      return Object.assign(defaultStats(), JSON.parse(raw));
    } catch (e) { return defaultStats(); }
  }
  function saveStats(st) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch (e) { /* 忽略 */ }
  }
  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function recordGame(winner, hero1, hero2, turns) {
    var st = loadStats();
    st.games++;
    st.wins[winner] = (st.wins[winner] || 0) + 1;
    if (winner === 'p1' && hero1) st.heroes[hero1] = (st.heroes[hero1] || 0) + 1;
    if (winner === 'p2' && hero2) st.heroes[hero2] = (st.heroes[hero2] || 0) + 1;
    st.turnsSum += turns;
    // 对阵胜率矩阵：记录（胜者侠客 vs 败者侠客）
    if ((winner === 'p1' || winner === 'p2') && hero1 && hero2) {
      var wHero = winner === 'p1' ? hero1 : hero2;
      var lHero = winner === 'p1' ? hero2 : hero1;
      if (wHero !== lHero) {
        var key = pairKey(wHero, lHero);
        var pair = st.pairs[key] || (st.pairs[key] = { games: 0, win1: 0 });
        pair.games++;
        if (wHero === key.split('|')[0]) pair.win1++;
      }
    }
    saveStats(st);
  }
  function renderStats() {
    var box = $('stats-body');
    if (!box) return;
    var st = loadStats();
    var p1w = st.wins.p1 || 0, p2w = st.wins.p2 || 0;
    var dr = (st.wins.draw || 0) + (st.wins.limit || 0);
    var html = '<div class="st-line">Total games <b>' + st.games + '</b>　Player 1 wins <b>' + p1w + '</b>　Player 2 wins <b>' + p2w + '</b>　Draws <b>' + dr + '</b></div>';
    if (st.games > 0) {
      html += '<div class="st-line">Player 1 win rate <b>' + Math.round(p1w / st.games * 100) + '%</b>　Player 2 win rate <b>' +
        Math.round(p2w / st.games * 100) + '%</b>　Avg turns <b>' + Math.round(st.turnsSum / st.games) + '</b></div>';
    }
    var heroes = Object.keys(st.heroes).sort(function (a, b) { return (st.heroes[b] || 0) - (st.heroes[a] || 0); });
    if (heroes.length) {
      html += '<div class="st-line">Hero wins: ' + heroes.slice(0, 6).map(function (h) {
        return '<b>' + h + '</b>×' + st.heroes[h];
      }).join('　') + '</div>';
    }
    // 对阵胜率矩阵
    var MATRIX_ORDER = ['Liu Rufeng', 'Tie Wushuang', 'Li Zhanfeng', 'Tang Shiqi', 'Zhang Xuanqing'];
    var hasPairs = Object.keys(st.pairs).length > 0;
    if (hasPairs) {
      html += '<div class="st-line">Matchup win rate (row beats column):</div><table class="matrix"><tr><th></th>';
      MATRIX_ORDER.forEach(function (n) { html += '<th>' + n.charAt(0) + '</th>'; });
      html += '</tr>';
      MATRIX_ORDER.forEach(function (rn) {
        html += '<tr><th>' + rn + '</th>';
        MATRIX_ORDER.forEach(function (cn) {
          if (rn === cn) { html += '<td class="self">—</td>'; return; }
          var pair = st.pairs[pairKey(rn, cn)];
          if (!pair) { html += '<td class="none">·</td>'; return; }
          var first = pairKey(rn, cn).split('|')[0];
          var rnWins = (first === rn) ? pair.win1 : (pair.games - pair.win1);
          var pct = Math.round(rnWins / pair.games * 100);
          html += '<td' + (pct >= 60 ? ' class="good"' : pct <= 40 ? ' class="bad"' : '') + '>' + pct + '%</td>';
        });
        html += '</tr>';
      });
      html += '</table>';
    }
    html += '<button class="btn small" id="btn-stats-reset">Reset Stats</button>';
    box.innerHTML = html;
    var rb = $('btn-stats-reset');
    if (rb) rb.onclick = function () { saveStats(defaultStats()); renderStats(); toast('Stats cleared'); };
  }

  // ---------------- 过场动效：回合涟漪 / 胜利墨爆 / 距离提示 ----------------
  function spawnRipple() {
    var board = $('board');
    if (!board || !board.appendChild) return;
    var r = document.createElement('div');
    r.className = 'round-ripple';
    board.appendChild(r);
    setTimeout(function () { r.remove(); }, 1000);
  }
  function spawnInkBurst() {
    var burst = document.createElement('div');
    burst.className = 'ink-burst';
    document.body.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 1150);
  }
  function spawnDistTag(text) {
    var track = $('dist-track');
    if (!track || !track.appendChild) return;
    var tag = document.createElement('div');
    tag.className = 'dist-tag';
    tag.textContent = String(text).replace(/^➜\s*/, '');
    track.appendChild(tag);
    setTimeout(function () { tag.remove(); }, 1400);
  }
  // 「第 N 回合」墨字浮影
  function spawnRoundMark(turnNum) {
    var board = $('board');
    if (!board || !board.appendChild) return;
    var m = document.createElement('div');
    m.className = 'round-mark';
    m.textContent = 'Turn ' + turnNum;
    board.appendChild(m);
    setTimeout(function () { m.remove(); }, 1650);
  }
  // 命中墨溅：目标面板溅出几滴墨点
  function spawnInkSplatter(idx) {
    var panel = $(idx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.appendChild) return;
    for (var i = 0; i < 6; i++) {
      var d = document.createElement('span');
      d.className = 'ink-dot';
      d.style.left = (28 + Math.random() * 44) + '%';
      d.style.top = (16 + Math.random() * 34) + '%';
      var size = 5 + Math.random() * 7;
      d.style.width = size + 'px';
      d.style.height = size + 'px';
      d.style.animationDelay = (Math.random() * 0.12) + 's';
      panel.appendChild(d);
      (function (el) { setTimeout(function () { el.remove(); }, 800); })(d);
    }
  }
  // 出牌墨点：确认选牌时出牌区泛起一圈墨环
  function spawnInkPuff(pIdx) {
    var panel = $(pIdx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.appendChild) return;
    var puff = document.createElement('span');
    puff.className = 'ink-puff';
    panel.appendChild(puff);
    setTimeout(function () { puff.remove(); }, 750);
  }
  // 平速墨印：「平」字印章浮现于棋盘中央
  function spawnTieStamp() {
    var board = $('board');
    if (!board || !board.appendChild) return;
    var s = document.createElement('span');
    s.className = 'tie-stamp';
    s.textContent = 'Tie';
    board.appendChild(s);
    setTimeout(function () { s.remove(); }, 1250);
  }
  // 招名吟唱：先手命中的招式名在面板上爆发浮现
  function spawnCardBanner(idx, cardName) {
    var panel = $(idx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.appendChild) return;
    var b = document.createElement('div');
    b.className = 'card-banner';
    b.textContent = cardName;
    panel.appendChild(b);
    setTimeout(function () { b.remove(); }, 950);
  }
  // 突进残影：距离标记移动路径上的墨点拖尾
  function spawnDashTrail(from, to) {
    var track = $('dist-track');
    if (!track || !track.appendChild) return;
    var dir = to > from ? 1 : -1;
    var steps = Math.abs(to - from);
    for (var i = 1; i <= steps; i++) {
      (function (frac) {
        var dot = document.createElement('span');
        dot.className = 'dash-dot';
        dot.style.left = ((from + dir * frac) * 20) + '%';
        track.appendChild(dot);
        setTimeout(function () { dot.remove(); }, 620);
      })(i);
    }
  }
  // 状态印章：结算后对比快照，新施加的状态砸出墨章（破/伤/毒/极/涌）
  function snapshotStatuses() {
    if (!UI.game) return null;
    return UI.game.players.map(function (p) {
      return { poise: p.poise, inner: p.inner, poison: p.poison, taiji: !!p.pendingTaiji, surge: !!p.qisurge };
    });
  }
  function spawnStatusSeals() {
    if (!UI.statusSnap) return;
    [0, 1].forEach(function (idx) {
      var p = UI.game.players[idx], snap = UI.statusSnap[idx];
      if (!snap) return;
      var defs = [
        { d: p.poise - snap.poise, ch: 'Flaw', cls: 'poise' },
        { d: p.inner - snap.inner, ch: 'Inj', cls: 'inner' },
        { d: p.poison - snap.poison, ch: 'Poi', cls: 'poison' },
        { d: (p.pendingTaiji ? 1 : 0) - (snap.taiji ? 1 : 0), ch: 'Tai', cls: 'taiji' },
        { d: (p.qisurge ? 1 : 0) - (snap.surge ? 1 : 0), ch: 'Surge', cls: 'qisurge' }
      ];
      var offset = -70;
      defs.forEach(function (d) {
        if (d.d > 0) {
          spawnStatusStamp(idx, d.ch, offset);
          offset += 46;
        }
      });
    });
    UI.statusSnap = null;
  }
  function spawnStatusStamp(idx, ch, offset) {
    var panel = $(idx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.appendChild) return;
    var st = document.createElement('span');
    st.className = 'status-seal';
    st.textContent = ch;
    st.style.left = 'calc(50% + ' + offset + 'px)';
    panel.appendChild(st);
    setTimeout(function () { st.remove(); }, 980);
  }
  // 绝杀定格：败者墨章 + 全屏闪光
  function spawnKoSeal(loserIdx) {
    var panel = $(loserIdx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.appendChild) return;
    var seal = document.createElement('div');
    seal.className = 'ko-seal';
    seal.textContent = 'KO';
    panel.appendChild(seal);
    setTimeout(function () { seal.remove(); }, 1500);
  }
  function spawnScreenFlash() {
    var f = document.createElement('div');
    f.className = 'screen-flash';
    document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 620);
  }

  // ================= 模态 =================
  function showModal(title, htmlText, options, onChoose) {
    var root = $('modal-root');
    root.innerHTML = '';
    var modal = document.createElement('div');
    modal.className = 'modal';
    var h = document.createElement('h3');
    h.textContent = title;
    var t = document.createElement('div');
    t.className = 'm-text';
    t.innerHTML = htmlText;
    modal.appendChild(h);
    modal.appendChild(t);
    var opts = document.createElement('div');
    opts.className = 'm-options';
    (options || []).forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'm-option';
      var inner = '<div class="mo-name">' + escapeHtml(o.label) + '</div>';
      if (o.desc) inner += '<div class="mo-sub">' + escapeHtml(o.desc) + '</div>';
      b.innerHTML = inner;
      b.onclick = function () {
        root.classList.remove('show');
        if (onChoose) onChoose(o.id);
      };
      opts.appendChild(b);
    });
    modal.appendChild(opts);
    root.appendChild(modal);
    root.classList.add('show');
  }
  function hideModal() { $('modal-root').classList.remove('show'); }

  function handleError(e) {
    console.error(e);
    UI.busy = false;
    var msg = (e && e.message) ? e.message : String(e);
    showModal('⚠ An Error Occurred', 'Error: <b>' + escapeHtml(msg) + '</b><br>Please screenshot or note this message, then refresh the page to restart.',
      [{ label: 'OK', id: 'ok' }], function () { });
  }

  // ---------------- 快捷键 ----------------
  function toggleSfx() {
    if (SFX) SFX.toggle();
    var btn = $('btn-sfx');
    if (btn) btn.textContent = (SFX && SFX.muted) ? 'Sound Off' : 'Sound On';
    toast(SFX && SFX.muted ? 'Sound off' : 'Sound on');
  }
  function bindKeyboard() {
    if (!document.addEventListener) return;
    document.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var modal = $('modal-root');
      if (modal && modal.classList.contains('show')) return;   // 弹窗打开时不响应
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (document.querySelector) {
          var primary = document.querySelector('.action-bar .btn-primary');
          if (primary && primary.click) primary.click();
        }
      } else if (e.key === 'Escape') {
        if (UI.phase === 'select' && !isAI(UI.selector) && UI.sel[UI.selector] !== null) {
          UI.sel[UI.selector] = null;
          renderAll();
        }
      } else if (e.key && e.key.toLowerCase() === 'm') {
        toggleSfx();
      } else if (/^[1-9]$/.test(e.key || '')) {
        if (UI.phase === 'select' && !isAI(UI.selector) && UI.sel[UI.selector] === null) {
          var idx = parseInt(e.key, 10) - 1;
          var g = UI.game;
          if (g) {
            var p = g.players[UI.selector];
            var cards = p.hand.slice();
            if (!p.ultUsed) cards.push(p.ult);
            if (cards[idx]) onCardClick(UI.selector, cards[idx]);
          }
        }
      }
    });
  }

  // 画卷视差：滚动时背景远山缓慢错位（水墨画"移步换景"）
  function bindParallax() {
    if (!window.addEventListener || !document.body || !document.body.style) return;
    function onScroll() {
      var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
      document.body.style.setProperty('--par', (y * 0.12).toFixed(1) + 'px');
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // 引擎决策处理器：AI 玩家自动应答，人类玩家弹出模态选择
  function uiDecide(prompt) {
    renderLog();                       // 先刷新战报
    if (prompt.player && isAI(prompt.player.index)) {
      var answer = ((typeof window !== 'undefined' && window.JY_AI) ? window.JY_AI.decide(prompt) : 'skip');
      return Promise.resolve(answer);
    }
    return new Promise(function (resolve) {
      var opts = prompt.options.map(function (o) {
        return { id: o.id, label: o.label, desc: o.desc || '' };
      });
      showModal(prompt.title, escapeHtml(prompt.text), opts, function (id) {
        UI.busy = false;
        resolve(id);
      });
      UI.busy = true;                  // 弹窗期间禁止其他操作
    });
  }

  // ================= 屏幕切换 =================
  function showScreen(name) {
    ['cover', 'setup', 'draft', 'yuanhu', 'game', 'codex'].forEach(function (s) {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
    UI.screen = name;
    window.scrollTo(0, 0);
  }

  // ================= 设置界面 =================
  function renderSetup() {
    ['0', '1'].forEach(function (pIdx) {
      var box = $('hero-pick-' + pIdx);
      box.innerHTML = '';
      HERO_ORDER.forEach(function (hid) {
        var h = DATA.CHARACTERS[hid];
        var div = document.createElement('div');
        div.className = 'hero-card' + (UI.heroSel[pIdx] === hid ? ' selected' : '');
        div.innerHTML = '<div class="hc-top">' + portraitHtml(hid, 58) +
          '<div><div><span class="hc-name">' + h.name + '</span><span class="hc-title">· ' + h.title + '</span></div>' +
          '<div class="hc-style">' + escapeHtml(h.style) + '</div></div></div>';
        div.onclick = function () {
          UI.heroSel[pIdx] = (UI.heroSel[pIdx] === hid ? null : hid);
          renderSetup();
        };
        box.appendChild(div);
      });
    });
    $('scene-picker').classList.toggle('hidden', !$('opt-dlc3').checked);
    renderSceneList();
    renderStats();
    // 对战模式单选状态
    var hot = $('mode-hotseat'), ai = $('mode-ai');
    if (hot) hot.checked = !UI.p2AI;
    if (ai) ai.checked = !!UI.p2AI;
    var lvlRow = $('ai-level-row');
    if (lvlRow) lvlRow.classList.toggle('hidden', !UI.p2AI);
    var lvlEasy = $('ai-easy'), lvlNormal = $('ai-normal'), lvlHard = $('ai-hard');
    if (lvlEasy) lvlEasy.checked = UI.aiLevel === 'easy';
    if (lvlNormal) lvlNormal.checked = UI.aiLevel === 'normal';
    if (lvlHard) lvlHard.checked = UI.aiLevel === 'hard';
    applyTheme(loadTheme());
    $('btn-start').disabled = !(UI.heroSel[0] && UI.heroSel[1]);
    // 人机模式提示
    var start = $('btn-start');
    start.textContent = UI.p2AI ? 'Start Duel (vs AI)' : 'Start Duel';
  }

  function renderSceneList() {
    var list = $('scene-list');
    list.innerHTML = '';
    var ids = Object.keys(DATA.SCENES);
    function sceneCard(id, name, desc, cls) {
      var div = document.createElement('div');
      div.className = 'scene-card' + (UI.sceneSel === id ? ' selected' : '') + (cls ? ' ' + cls : '');
      div.innerHTML = '<div class="sc-name">' + name + '</div><div class="sc-desc">' + escapeHtml(desc) + '</div>';
      div.onclick = function () { UI.sceneSel = id; renderSceneList(); };
      list.appendChild(div);
    }
    ids.forEach(function (id) {
      var s = DATA.SCENES[id];
      sceneCard(id, s.name, s.desc);
    });
    var r = document.createElement('div');
    r.className = 'scene-card' + (UI.sceneSel === 'random' ? ' selected' : '');
    r.innerHTML = '<div class="sc-name sc-random">🎲 Random Scene</div><div class="sc-desc">Draw a random scene card at the start</div>';
    r.onclick = function () { UI.sceneSel = (UI.sceneSel === 'random' ? null : 'random'); renderSceneList(); };
    list.appendChild(r);
  }

  // ================= 开始新对局 =================
  function startGame() {
    var scene = null;
    if ($('opt-dlc3').checked) {
      scene = (UI.sceneSel === 'random' || !UI.sceneSel)
        ? Object.keys(DATA.SCENES)[Math.floor(Math.random() * 6)]
        : UI.sceneSel;
    }
    var g = new JY.Game({
      hero1: UI.heroSel[0],
      hero2: UI.heroSel[1],
      dlc2: $('opt-dlc2').checked,
      scene: scene,
      dlc4: $('opt-dlc4').checked,
      decide: uiDecide
    });
    UI.game = g;
    UI.logCount = 0;
    UI.busy = false;
    UI.sel = [null, null];
    UI.flipped = false;
    UI.flipDone = false;
    UI.flipAnim = false;

    if (g.dlc2) {
      g.startPublicDraft();
      UI.screen = 'draft';
      UI.phase = 'draft';
      showScreen('draft');
      renderDraft();
    } else if (g.dlc4) {
      g.startYuanhuDraft();
      UI.yuanhuStage = 0;
      UI.yuanhuSel = null;
      UI.screen = 'yuanhu';
      UI.phase = 'yuanhu';
      showScreen('yuanhu');
      renderYuanhu();
    } else {
      startGameBoard();
    }
  }

  // ================= DLC2 选牌 =================
  function draftTransition() {
    var g = UI.game;
    if (!g.draftDone) return;
    if (g.dlc4) {
      g.startYuanhuDraft();
      UI.yuanhuStage = 0;
      UI.yuanhuSel = null;
      UI.phase = 'yuanhu';
      showScreen('yuanhu');
      renderYuanhu();
    } else {
      startGameBoard();
    }
  }

  function renderDraft() {
    var g = UI.game;
    var faceup = $('draft-faceup');
    faceup.innerHTML = '';
    var aiTurn = isAI(g.draftTurn);
    g.draftFaceup.forEach(function (card) {
      var div = buildBigCard(card, 'public-card');
      div.onclick = function () {
        if (UI.busy || aiTurn) return;        // 电脑回合人类不可代选
        g.publicDraftPick(g.draftTurn, card);
        renderDraft();
        draftTransition();
      };
      faceup.appendChild(div);
    });
    // 电脑回合：自动挑选
    if (aiTurn && typeof window !== 'undefined' && window.JY_AI) {
      var g0 = g;
      setTimeout(function () {
        if (UI.game !== g0 || g0.draftDone) return;
        var pick = window.JY_AI.pickPublic(g0, g0.draftFaceup);
        if (pick) {
          g0.publicDraftPick(g0.draftTurn, pick);
          renderDraft();
          draftTransition();
        }
      }, 700);
    }
    var picker = g.draftTurn === 0 ? 'Player 1 (' + g.p1.heroName + ')' : 'Player 2 (' + g.p2.heroName + ')';
    $('draft-status').textContent = 'It is ' + picker + ' to pick ' + (g.draftCount + 1) + ' of 4';
    $('draft-picks').innerHTML =
      'Player 1 picked ' + (g.p1.hand.length - 8) + '　|　Player 2 picked ' + (g.p2.hand.length - 8);
  }

  // ================= DLC4 援护选牌 =================
  function renderYuanhu() {
    var g = UI.game;
    var body = $('yuanhu-body');
    body.innerHTML = '';
    if (UI.yuanhuStage >= 2) { startGameBoard(); return; }
    var pIdx = UI.yuanhuStage;
    var p = g.players[pIdx];
    // 电脑密邀：自动挑选
    if (isAI(pIdx) && typeof window !== 'undefined' && window.JY_AI) {
      var pick = window.JY_AI.pickYuanhu(g.yuanhuDraft[pIdx]);
      g.yuanhuDraftPick(pIdx, pick);
      UI.yuanhuSel = null;
      UI.yuanhuStage++;
      renderYuanhu();
      return;
    }
    var stage = document.createElement('div');
    stage.className = 'yuanhu-stage';
    var h = document.createElement('div');
    h.className = 'yuanhu-hint';
    h.textContent = who(pIdx) + ' (' + p.heroName + ') secretly invites aid';
    var note = document.createElement('div');
    note.className = 'pass-notice';
    note.textContent = 'Ask your opponent to look away: secretly pick 1 of the 3 jianghu masters below (keep it hidden until played)';
    stage.appendChild(h);
    stage.appendChild(note);
    var cards = document.createElement('div');
    cards.className = 'yuanhu-cards';
    g.yuanhuDraft[pIdx].forEach(function (yh) {
      var div = document.createElement('div');
      div.className = 'card public-card' + (UI.yuanhuSel === yh.id ? ' selected' : '');
      div.innerHTML = '<div class="c-name">' + escapeHtml(yh.name) + '</div><div class="c-desc">' + escapeHtml(yh.desc) + '</div>';
      div.onclick = function () { UI.yuanhuSel = yh.id; renderYuanhu(); };
      cards.appendChild(div);
    });
    stage.appendChild(cards);
    var btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Confirm Pick (Secret)';
    btn.disabled = !UI.yuanhuSel;
    btn.onclick = function () {
      var yh = null;
      for (var i = 0; i < g.yuanhuDraft[pIdx].length; i++) {
        if (g.yuanhuDraft[pIdx][i].id === UI.yuanhuSel) { yh = g.yuanhuDraft[pIdx][i]; break; }
      }
      if (!yh) return;
      g.yuanhuDraftPick(pIdx, yh);
      UI.yuanhuSel = null;
      UI.yuanhuStage++;
      renderYuanhu();
    };
    stage.appendChild(btn);
    body.appendChild(stage);
  }

  // ================= 对局流程 =================
  function startGameBoard() {
    UI.screen = 'game';
    UI.phase = 'adjust';
    showScreen('game');
    spawnRipple();
    spawnRoundMark(1);
    renderAll();
    runBeginTurn();
  }

  function runBeginTurn() {
    var g = UI.game;
    UI.busy = true;
    UI.game.beginTurn().then(function () {
      if (UI.game !== g) return;               // 对局已切换，忽略过期回调
      UI.busy = false;
      UI.phase = 'select';
      UI.sel = [null, null];
      UI.selector = UI.game.activePlayer;
      renderAll();
      beginSelectPhase();
    }, function (e) {
      if (UI.game !== g) return;
      handleError(e);
    });
  }

  function beginSelectPhase() {
    if (isAI(UI.selector)) { aiAutoSelect(UI.selector); return; }
    var p = UI.game.players[UI.selector];
    if (p.forcedCard) {
      UI.sel[UI.selector] = p.forcedCard;
      toast(who(UI.selector) + ' is controlled by the Soul-Seizing Art and must play "' + p.forcedCard.name + '" this turn');
    }
    renderAll();
  }

  function onCardClick(pIdx, card) {
    if (UI.busy) return;
    if (UI.phase !== 'select' || UI.selector !== pIdx) return;
    if (UI.sel[pIdx] !== null) return;
    var g = UI.game, p = g.players[pIdx];
    var cost = g.effectiveCost(p, card);
    if (cost > p.qi) {
      var hasAffordable = p.hand.some(function (c) { return g.effectiveCost(p, c) <= p.qi; }) ||
        (!p.ultUsed && g.effectiveCost(p, p.ult) <= p.qi);
      if (hasAffordable) { toast('Not enough Qi for this technique'); return; }
      toast('Not enough Qi: the technique will be treated as a miss');
    }
    UI.sel[pIdx] = card;
    sfx('select');
    spawnInkPuff(pIdx);
    renderAll();
  }

  function confirmSelection(pIdx) {
    if (UI.busy) return;
    if (UI.phase !== 'select' || UI.selector !== pIdx) return;
    if (UI.sel[pIdx] === null) return;
    sfx('confirm');
    afterConfirm(pIdx);
  }

  // 确认后推进：对方已选→亮牌；对方是电脑→自动选牌；
  // 人机模式（无交接）→ 直接进入下一方选牌；双人热座 → 交接设备
  function afterConfirm(pIdx) {
    var other = 1 - pIdx;
    if (UI.sel[other] !== null) {
      enterReveal();
    } else if (isAI(other)) {
      aiAutoSelect(other);
    } else if (UI.p2AI) {
      UI.selector = other;
      UI.phase = 'select';
      beginSelectPhase();
    } else {
      UI.phase = 'pass';
      renderAll();
    }
  }

  // 电脑自动出招（带短暂"思考"停顿）
  function aiAutoSelect(pIdx) {
    if (typeof window === 'undefined' || !window.JY_AI) return;
    var g = UI.game;
    UI.phase = 'select';
    UI.sel[pIdx] = window.JY_AI.choose(g, g.players[pIdx], UI.aiLevel);
    renderAll();
    setTimeout(function () {
      if (UI.game !== g) return;                  // 对局已切换
      afterConfirm(pIdx);
    }, 850);
  }

  // 进入亮牌：先以盖牌呈现，短暂停顿后翻牌揭晓
  function enterReveal() {
    var g = UI.game;
    UI.phase = 'reveal';
    UI.flipped = false;
    UI.flipDone = false;
    UI.flipAnim = false;
    renderAll();
    setTimeout(function () {
      if (UI.game !== g || UI.phase !== 'reveal') return;   // 已切换对局/阶段，忽略
      UI.flipped = true;
      UI.flipDone = true;
      UI.flipAnim = true;                     // 触发 3D 翻转动画
      sfx('flip');
      renderAll();
      setTimeout(function () {                // 动画结束后移除动画类，避免后续重播
        if (UI.game !== g) return;
        UI.flipAnim = false;
        if (UI.phase === 'reveal') renderAll();
      }, 740);
    }, 160);
  }

  // ---------------- 绝学专属动画 ----------------
  var ULT_FLAVOR = {
    'Flying Immortal': 'A sword from the west — nothing can withstand it',
    'Prajna Vajra Palm': 'Overwhelmingly fierce; those struck have their meridians shattered',
    'Nine-Turn Heaven Blade': 'One turn of the divine blade — gods and ghosts alike perish',
    'Pear-Blossom Needle Storm': 'It always draws blood; returning empty-handed bodes ill',
    'Taiji Two-Polar Palm': 'The tai chi circle turns — what comes must go'
  };

  // 各角色绝学特效元素
  function ultFxMarkup(heroId) {
    if (heroId === 'tang') {           // 唐十七：暴雨梨花针雨
      var n = '';
      for (var i = 0; i < 18; i++) {
        n += '<span class="needle" style="left:' + (4 + Math.random() * 92).toFixed(1) + '%;' +
          'animation-delay:' + (Math.random() * 1.1).toFixed(2) + 's;' +
          'animation-duration:' + (0.55 + Math.random() * 0.5).toFixed(2) + 's"></span>';
      }
      return n;
    }
    var fx = {
      liu: '<span class="glow"></span><span class="streak"></span>',   // 柳如风：一剑西来
      tie: '<span class="flash"></span><span class="ring"></span><span class="ring" style="animation-delay:.3s"></span><span class="ring" style="animation-delay:.6s"></span>',  // 铁无双：金刚掌波
      li: '<span class="blade"></span><span class="slash"></span><span class="slash s2"></span>',  // 厉斩风：天刀回旋
      zhang: '<span class="taiji"></span>'                             // 张玄清：太极圆转
    };
    return fx[heroId] || '';
  }

  // 播放绝学动画：返回 Promise，结束后自动移除遮罩
  function playUltAnimation() {
    var g = UI.game;
    sfx('ult');
    var list = [];
    UI.sel.forEach(function (c, i) {
      if (c && c.ultimate) list.push({ p: g.players[i], card: c });
    });
    if (!list.length) return Promise.resolve();
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'ult-overlay';
      var fx = '', core = '';
      list.forEach(function (item) {
        fx += '<div class="ult-fx ' + item.p.heroId + '">' + ultFxMarkup(item.p.heroId) + '</div>';
        core += '<div class="ult-hero">' + escapeHtml(item.p.title) + ' · ' + escapeHtml(item.p.heroName) + '</div>' +
          '<div class="ult-name">' + escapeHtml(item.card.name) + '</div>' +
          '<div class="ult-flavor">' + escapeHtml(ULT_FLAVOR[item.card.name] || '') + '</div>';
      });
      overlay.innerHTML = fx + '<div class="ult-core">' + core + '</div>';
      document.body.appendChild(overlay);
      setTimeout(function () {
        overlay.classList.add('out');
        setTimeout(function () {
          overlay.remove();
          resolve();
        }, 480);
      }, 1780);
    });
  }

  function reveal() {
    if (UI.busy) return;
    if (!UI.sel[0] || !UI.sel[1]) return;
    var g = UI.game;
    UI.busy = true;
    UI.phase = 'reveal';
    UI.statusSnap = snapshotStatuses();        // 结算前状态快照
    renderAll();
    playUltAnimation().then(function () {
      return UI.game.resolveCombat(UI.sel[0], UI.sel[1]);
    }).then(function () {
      if (UI.game !== g) return;               // 对局已切换，忽略过期回调
      UI.busy = false;
      renderAll();                             // 结算后全量渲染（日志 + 飘字/横幅生成）
      if (UI.game.winner) {
        spawnStatusSeals();                    // 新施加状态砸出墨章
        showGameOver();
      } else {
        UI.phase = 'roundEnd';
        renderHeader();                        // 只更新横幅与操作条，不重建面板，
        renderActionBar();                     // 以免清掉飘字/印章/横幅等战斗特效
        spawnStatusSeals();
      }
    }, function (e) {
      if (UI.game !== g) return;
      handleError(e);
    });
  }

  function nextRound() {
    if (UI.busy) return;
    UI.phase = 'adjust';
    UI.flipped = false;
    UI.flipDone = false;
    UI.flipAnim = false;
    spawnRipple();
    spawnRoundMark(UI.game ? UI.game.turn + 1 : 1);
    renderAll();
    runBeginTurn();
  }

  function quitToSetup() {
    hideModal();
    UI.busy = false;
    UI.game = null;
    UI.phase = 'setup';
    UI.sel = [null, null];
    showScreen('setup');
    renderSetup();
  }

  // ================= 结算动画辅助 =================
  var animTimer = null;
  function delayForLog(ms, fn) {
    if (animTimer) clearTimeout(animTimer);
    animTimer = setTimeout(fn, ms);
  }

  // ================= 渲染 =================
  function renderAll() {
    if (!UI.game) return;
    renderHeader();
    renderDist();
    renderPanels();
    renderLog();
    renderActionBar();
  }

  var lastBannerText = '';
  function renderHeader() {
    var g = UI.game;
    $('g-turn').textContent = 'Turn ' + (g.turn + 1);
    $('g-scene').textContent = g.scene ? 'Scene: ' + DATA.SCENES[g.scene].name : 'No scene · Mount Hua Summit';
    var map = {
      adjust: 'Recovery Phase', select: 'Play Phase', pass: 'Pass Device', reveal: 'Reveal & Duel', roundEnd: 'Turn End'
    };
    var text = map[UI.phase] || '';
    var banner = $('phase-banner');
    if (text !== lastBannerText) {
      banner.classList.remove('banner-anim');
      void banner.offsetWidth;                 // 强制回流以重启动画
      banner.classList.add('banner-anim');
      lastBannerText = text;
    }
    banner.textContent = text;
  }

  function renderDist() {
    var g = UI.game, el = $('dist-track');
    // 记录位移起点（突进残影用）
    if (UI.prevDist !== undefined && UI.prevDist !== g.dist) UI.distFrom = UI.prevDist;
    UI.prevDist = g.dist;
    // 首次（或结构被重建时）生成 5 格 + 滑动标记；之后只更新激活格与标记位置，
    // 保证距离标记的 left 过渡动画生效
    if (!el.children || el.children.length !== 6) {
      var html = '';
      for (var d = 0; d <= 4; d++) {
        html += '<div class="dist-cell' + (g.dist === d ? ' active' : '') + '"><div class="d-num">' + d + '</div>' +
          DIST_NAMES[d].slice(2) + '</div>';
      }
      html += '<div class="dist-marker" style="left:' + (g.dist * 20) + '%"></div>';
      el.innerHTML = html;
      return;
    }
    var cells = (el.querySelectorAll ? el.querySelectorAll('.dist-cell') : []);
    for (var i = 0; i < cells.length; i++) {
      cells[i].className = 'dist-cell' + (g.dist === i ? ' active' : '');
    }
    var marker = (el.querySelector ? el.querySelector('.dist-marker') : null);
    if (marker) marker.style.left = (g.dist * 20) + '%';
  }

  function weaponIconFor(card) {
    return WEAPON_ICON[card.weapon] || '';
  }

  // 亮牌时翻出的牌面（迷你卡面）
  function revealCardHtml(card) {
    var rc = '<div class="reveal-card' + (card.ultimate ? ' ult' : '') + (card.isPublic ? ' pub' : '') + '">';
    rc += '<div class="rc-name">' + escapeHtml(card.name) +
      (card.ultimate ? '<em class="rc-seal">Ult</em>' : '') +
      (card.isPublic ? '<em class="rc-seal pub">Pub</em>' : '') + '</div>';
    rc += '<div class="rc-meta">Spd ' + card.speed + ' · Cost ' + card.cost + ' · ' +
      DATA.rangeText(card.lo, card.hi) + ' · Dmg ' + card.dmg + '</div>';
    rc += '<div class="rc-desc">' + escapeHtml(card.desc || '') + '</div>';
    rc += '</div>';
    return rc;
  }

  function handCardHtml(pIdx, card) {
    var g = UI.game, p = g.players[pIdx];
    var cost = g.effectiveCost(p, card);
    var affordable = cost <= p.qi;
    var cls = 'card';
    if (card.ultimate) cls += ' ultimate';
    if (card.isPublic) cls += ' public-card';
    if (!affordable) cls += ' dim';
    if (UI.sel[pIdx] && UI.sel[pIdx].uid === card.uid) cls += ' selected';
    var costTxt = cost < card.cost ? card.cost + '→' + cost : String(cost);
    return '<div class="' + cls + '" data-uid="' + card.uid + '">' +
      (card.ultimate ? '<span class="c-ult">Ult</span>' : '') +
      (card.isPublic ? '<span class="c-ult" style="background:var(--green)">Pub</span>' : '') +
      '<div class="c-name">' + escapeHtml(card.name) + '</div>' +
      '<div class="c-meta"><span>Spd<b>' + card.speed + '</b></span><span>Dmg<b>' + card.dmg + '</b></span></div>' +
      '<div class="c-range">' + DATA.rangeText(card.lo, card.hi) + '</div>' +
      '<div class="c-cost">Cost<b>' + costTxt + '</b></div>' +
      '<div class="c-desc">' + escapeHtml(card.desc || '') + '</div>' +
      '<span class="c-weapon">' + weaponIconFor(card) + '</span>' +
      '</div>';
  }

  function renderPanel(pIdx) {
    var g = UI.game, p = g.players[pIdx];
    var el = $(pIdx === 0 ? 'panel-p1' : 'panel-p2');
    var lowHp = p.hp > 0 && p.hp / p.maxhp <= 0.3;
    var winCls = (UI.game.winner === 'p1' && pIdx === 0) || (UI.game.winner === 'p2' && pIdx === 1) ? ' winner' : '';
    el.className = 'player-panel' + (lowHp ? ' low-hp' : '') + winCls;
    var handVisible = UI.phase === 'select' && UI.selector === pIdx && UI.sel[pIdx] === null;

    var html = '<div class="pp-head">' +
      '<span class="pp-id">' + portraitHtml(p.heroId, 52) +
      '<span><span class="pp-name">' + who(pIdx) + ' · ' + escapeHtml(p.heroName) + '</span><span class="pp-title">' + escapeHtml(p.title) + '</span></span></span>' +
      '<span class="pp-tag">' + (WEAPON_ICON[p.title === 'Swordsman' ? 'Sword' : (p.title === 'Boxer' || p.title === 'Taiji') ? 'Fist' : (p.title === 'Blade Fiend' ? 'Blade' : 'Hidden')] || '') + ' ' +
      (g.dlc4 ? (p.yuanhuUsed ? '<span class="badge used">Aid used</span>' : '<span class="badge yuanhu">Aid: ?</span>') : '') + '</span></div>';

    var hpPct = Math.max(0, Math.min(100, Math.round(p.hp / p.maxhp * 100)));
    html += '<div class="hp-row"><span class="hp-label">HP</span>' +
      '<div class="hp-bar"><div class="hp-fill' + (hpPct <= 30 ? ' low' : '') + '" style="width:' + hpPct + '%"></div>' +
      '<div class="hp-text">' + p.hp + ' / ' + p.maxhp + '</div></div></div>';

    var qipips = '';
    for (var i = 0; i < g.maxQi; i++) qipips += '<div class="qi-pip' + (i < p.qi ? ' on' : '') + '"></div>';
    html += '<div class="qi-row"><span class="hp-label">Qi</span><div class="qi-pips">' + qipips + '</div></div>';

    var badges = '';
    function badge(cls, txt) { return '<span class="badge ' + cls + '">' + txt + '</span>'; }
    if (p.poise > 0) badges += badge('poise', 'Flaw×' + p.poise);
    if (p.inner > 0) badges += badge('inner', 'Internal×' + p.inner);
    if (p.poison > 0) badges += badge('poison', 'Poison×' + p.poison);
    if (p.pendingTaiji) badges += badge('taiji', 'Tai Chi');
    if (p.slowActiveVal > 0) badges += badge('slow', 'Slow ' + p.slowActiveVal);
    if (p.qisurge) badges += badge('qisurge', 'Qi Surge');
    if (p.immuneRound) badges += badge('immune', 'Immune');
    if (p.shields.length) badges += badge('shield', 'Shield×' + p.shields.length);
    html += '<div class="status-row">' + (badges || '<span style="font-size:12px;color:var(--ink-4)">No status</span>') + '</div>';

    html += '<div class="pp-sub"><span>Qi-return <b>' + p.discard.length + '</b>/' + g.discardLimit + '</span>' +
      '<span>Hand <b>' + p.hand.length + '</b></span>' +
      '<span>Ult <b>' + (p.ultUsed ? 'Used' : 'Ready') + '</b></span></div>';

    // 出牌区
    var token = '';
    var selected = UI.sel[pIdx];
    // 翻牌容器：front=盖牌背面，back=牌面（.flipped 触发 3D 翻转）
    function flipWrap(faceUp, cardHtml) {
      var innerCls = faceUp ? ' flipped' : '';
      if (faceUp && UI.flipAnim) innerCls += ' flip-anim';
      return '<div class="flip-wrap"><div class="flip-inner' + innerCls + '">' +
        '<div class="flip-face flip-front"><span class="flip-mark">S</span></div>' +
        '<div class="flip-face flip-back">' + (cardHtml || '') + '</div>' +
        '</div></div>';
    }
    if (UI.phase === 'reveal') {
      // 亮牌阶段：翻牌动画
      var faceUp = UI.flipped && !!selected;
      token = '<div class="play-token' + (faceUp ? ' revealed' : '') + '">' +
        flipWrap(faceUp, selected ? revealCardHtml(selected) : '') +
        '<div class="token-side">' +
        '<span class="token-note">' + (faceUp ? 'Revealed' : 'Face-down') + '</span>' +
        (faceUp && selected ? '<span class="token-effect">' + escapeHtml(selected.desc || '') + '</span>' : '') +
        '</div></div>';
    } else if (UI.phase === 'roundEnd') {
      var cur = selected || p.curCard;
      if (cur) {
        token = '<div class="play-token revealed">' +
          flipWrap(true, revealCardHtml(cur)) +
          '<div class="token-side">' +
          '<span class="token-note">' + (cur.ultimate ? 'Ult · Spd ' + cur.speed : 'Spd ' + cur.speed + ' · Dmg ' + cur.dmg) + '</span>' +
          '<span class="token-effect">' + escapeHtml(cur.desc || '') + '</span>' +
          '</div></div>';
      }
    } else if (selected) {
      // 摄魂大法强制出牌：被强制方可见自己必须打出的牌（明牌）
      var forced = UI.phase === 'select' && UI.selector === pIdx && p.forcedCard && p.forcedCard.uid === selected.uid;
      if (forced) {
        token = '<div class="play-token revealed">' +
          flipWrap(true, revealCardHtml(selected)) +
          '<div class="token-side">' +
          '<span class="token-note">Controlled by the Soul-Seizing Art — you must play this card</span>' +
          '<span class="token-effect">' + escapeHtml(selected.desc || '') + '</span>' +
          '</div></div>';
      } else {
        token = '<div class="play-token">' +
          flipWrap(false, '') +
          '<div class="token-side"><span class="token-note">Technique selected (face-down)</span></div></div>';
      }
    }
    html += token;

    // 手牌
    html += '<div class="hand-label">Hand (' + (handVisible ? 'choosing' : 'face-down') + ')</div><div class="hand">';
    if (handVisible) {
      p.hand.forEach(function (card) { html += handCardHtml(pIdx, card); });
      if (!p.ultUsed) html += handCardHtml(pIdx, p.ult);
    } else {
      for (var b = 0; b < p.hand.length; b++) html += '<div class="card back"><div class="back-mark">S</div></div>';
    }
    html += '</div>';
    el.innerHTML = html;

    if (handVisible) {
      var cards = el.querySelectorAll('.card[data-uid]');
      for (var c = 0; c < cards.length; c++) {
        (function (node) {
          node.onclick = function () {
            var uid = parseInt(node.getAttribute('data-uid'), 10);
            var card = findCard(p, uid);
            if (card) onCardClick(pIdx, card);
          };
        })(cards[c]);
      }
    }
  }

  function renderPanels() {
    renderPanel(0);
    renderPanel(1);
  }

  // ---------------- 战斗动效：飘字 / 受击闪白 / 震屏 ----------------
  function playerIndexByName(name) {
    var g = UI.game;
    if (!g) return -1;
    if (g.p1.heroName === name) return 0;
    if (g.p2.heroName === name) return 1;
    return -1;
  }
  function floatText(idx, amount, cls) {
    var panel = $(idx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.appendChild || !panel.classList) return;
    var span = document.createElement('span');
    span.className = 'float-num ' + (cls || 'dmg');
    span.textContent = (cls === 'heal' ? '+' : '-') + amount;
    span.style.left = 'calc(50% + ' + Math.round((Math.random() - 0.5) * 76) + 'px)';
    panel.appendChild(span);
    setTimeout(function () { span.remove(); }, 1150);
  }
  function hitFlash(idx) {
    var panel = $(idx === 0 ? 'panel-p1' : 'panel-p2');
    if (!panel || !panel.classList) return;
    panel.classList.remove('hit');
    void panel.offsetWidth;
    panel.classList.add('hit');
    setTimeout(function () { panel.classList.remove('hit'); }, 520);
  }
  function screenShake() {
    var board = $('board');
    if (!board || !board.classList) return;
    board.classList.remove('screen-shake');
    void board.offsetWidth;
    board.classList.add('screen-shake');
    setTimeout(function () { board.classList.remove('screen-shake'); }, 540);
  }
  function handleCombatFx(e) {
    var t = e.t || '', m, r, p, h, idx;
    // 距离变化：提示标签 + 风声 + 突进残影
    if (e.c === 'move') {
      sfx('move');
      spawnDistTag(t);
      var nm = /changes distance to\s+(\d+)/.exec(t);
      if (nm && UI.distFrom !== null && UI.distFrom !== undefined) {
        spawnDashTrail(UI.distFrom, parseInt(nm[1], 10));
        UI.distFrom = null;
      }
      return;
    }
    // 平速：「平」字墨印
    if (e.c === 'tie') {
      spawnTieStamp();
    }
    // 伤害：💥 攻击者 的「招」对 目标 造成 N 点伤害
    m = /deals\s+(\d+)\s+damage to\s+([^\s]+)/.exec(t);
    if (m) {
      idx = playerIndexByName(m[1]);
      if (idx >= 0) {
        var amt = parseInt(m[2], 10);
        floatText(idx, amt, 'dmg');
        hitFlash(idx);
        spawnInkSplatter(idx);
        sfx(amt >= 5 ? 'bigHit' : 'hit');
        // 先手招名吟唱
        if (UI.game && UI.game.firstAttacker) {
          var atk = /deals\s+\d+\s+damage to\s+[^\s]+ with "([^"]+)"/.exec(t);
          if (atk) {
            var aidx = playerIndexByName(atk[1]);
            var faIdx = UI.game.firstAttacker === UI.game.p1 ? 0 : 1;
            if (aidx === faIdx) spawnCardBanner(aidx, atk[2]);
          }
        }
        if (amt >= 5) screenShake();           // 大招/重击：整屏震屏
      }
      return;
    }
    // 反弹（两种格式）：「反弹 N 点给 X」/「将 N 点伤害…反弹给 X」
    r = /reflects\s+(\d+)\s+to\s+([^\s]+)/.exec(t) || /reflects\s+(\d+)\s+to\s+([^\s]+)/.exec(t);
    if (r) {
      idx = playerIndexByName(r[2]);
      if (idx >= 0) { floatText(idx, parseInt(r[1], 10), 'dmg'); sfx('reflect'); }
      return;
    }
    // 中毒：☠ X 中毒发作，受到 N 点伤害
    p = /suffers poison for\s+(\d+)/.exec(t);
    if (p) {
      var nameTok = (t.split(' ')[1] || '').replace(/[^A-Za-z]/g, '');
      idx = playerIndexByName(nameTok);
      if (idx >= 0) { floatText(idx, parseInt(p[1], 10), 'poison'); hitFlash(idx); sfx('poison'); }
      return;
    }
    // 回复：📋 X（…）：气血 A→B（B>A 视为治疗）
    h = /📋\s+([^\s(]+).*?HP\s+(\d+)→(\d+)/.exec(t);
    if (h && parseInt(h[3], 10) > parseInt(h[2], 10)) {
      idx = playerIndexByName(h[1]);
      if (idx >= 0) { floatText(idx, parseInt(h[3], 10) - parseInt(h[2], 10), 'heal'); sfx('heal'); }
    }
  }

  function renderLog() {
    if (!UI.game) return;
    var list = $('log-list');
    var base = UI.logCount;
    for (var i = base; i < UI.game.logEntries.length; i++) {
      var e = UI.game.logEntries[i];
      var div = document.createElement('div');
      div.className = 'log-line ' + (e.c || 'info');
      div.textContent = e.t;
      div.style.animationDelay = Math.min((i - base) * 70, 700) + 'ms';
      list.appendChild(div);
      handleCombatFx(e);                       // 飘字/受击闪白/震屏
    }
    UI.logCount = UI.game.logEntries.length;
    list.scrollTop = list.scrollHeight;
  }

  function renderActionBar() {
    var bar = $('action-bar');
    bar.innerHTML = '';
    function hint(main, sub) {
      var d = document.createElement('div');
      d.className = 'ab-hint';
      d.innerHTML = escapeHtml(main) + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '');
      bar.appendChild(d);
    }
    function addBtn(label, cls, onClick) {
      var b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.onclick = onClick;
      bar.appendChild(b);
    }
    switch (UI.phase) {
      case 'adjust':
        hint('Recovery phase…', 'Qi recovers, Flaws fade, Poison ticks');
        break;
      case 'select': {
        var p = UI.game.players[UI.selector];
        var forced = !!p.forcedCard;
        if (isAI(UI.selector)) {
          hint('AI (' + p.heroName + ') is thinking…', forced ? 'Controlled by the Soul-Seizing Art — must play "' + p.forcedCard.name + '"' : 'Weighing its options');
        } else {
          hint('It is ' + who(UI.selector) + ' to choose a technique (' + p.heroName + ')',
            forced ? 'Controlled by the Soul-Seizing Art: you must play "' + p.forcedCard.name + '" this turn' : 'Click a card to select it, then press "Confirm Technique"');
          if (UI.sel[UI.selector]) {
            addBtn('Confirm Technique', 'btn-primary', function () { confirmSelection(UI.selector); });
            if (!forced) addBtn('Reselect', '', function () { UI.sel[UI.selector] = null; renderAll(); });
          }
        }
        break;
      }
      case 'pass': {
        var next = 1 - UI.selector;
        hint('Pass the device to ' + who(next), "Don't let your opponent see your choice");
        addBtn('I have the device — start picking', 'btn-primary', function () {
          UI.selector = next;
          UI.phase = 'select';
          beginSelectPhase();
        });
        break;
      }
      case 'reveal':
        if (!UI.flipDone) {
          hint('Revealing…', 'Both techniques are being revealed');
        } else {
          hint('Reveal!', 'Review both techniques, then resolve the duel');
          addBtn('⚔ Resolve', 'btn-primary', function () { reveal(); });
        }
        break;
      case 'roundEnd':
        hint('Turn over', '');
        addBtn('Next Turn', 'btn-primary', function () { nextRound(); });
        break;
    }
  }

  function buildBigCard(card, extraCls) {
    var div = document.createElement('div');
    div.className = 'card ' + (extraCls || '');
    div.innerHTML =
      (card.ultimate ? '<span class="c-ult">Ult</span>' : '') +
      '<div class="c-name">' + escapeHtml(card.name) + '</div>' +
      '<div class="c-meta"><span>Spd<b>' + card.speed + '</b></span><span>Cost<b>' + card.cost + '</b></span><span>Dmg<b>' + card.dmg + '</b></span></div>' +
      '<div class="c-range">' + DATA.rangeText(card.lo, card.hi) + '</div>' +
      '<div class="c-desc">' + escapeHtml(card.desc || '') + '</div>';
    return div;
  }

  // ================= 武林图鉴 =================
  function codexSection(title, innerHtml) {
    return '<div class="codex-section"><h2>' + title + '</h2>' + innerHtml + '</div>';
  }
  function codexCards(cards) {
    var html = '<div class="codex-cards">';
    cards.forEach(function (c) {
      var div = buildBigCard(c);
      html += div.outerHTML || '<div class="card">' + c.name + '</div>';
    });
    return html + '</div>';
  }
  function showCodex() {
    showScreen('codex');
    var body = $('codex-body');
    if (!body) return;
    var html = '';
    // 规则速查
    html += codexSection('Quick Reference', '<div class="codex-rules">' +
      '<p><b>Goal:</b> reduce the opponent HP to 0 or below; if both hit 0 together it is a draw; if no winner after 60 turns, it is a draw.</p>' +
      '<p><b>Distance:</b> a shared track from 0 (point-blank) to 4 (extreme), starting at 2. A technique outside its valid range misses (+1 Flaw).</p>' +
      '<p><b>Qi:</b> max 5, start with 5, recover 1 at the start of each turn; playing a technique costs the Qi printed on the card.</p>' +
      '<p><b>Flaw:</b> each stack -1 technique speed; 1 stack is removed at the start of each turn. <b>Internal Injury:</b> each stack +1 damage taken. <b>Poison:</b> take its damage at turn start, then decay 1 stack.</p>' +
      '<p><b>Qi Return:</b> played techniques go to the qi-return pile; at 4 cards (5 with DLC2) all return to hand.</p>' +
      '<p><b>Duel:</b> both reveal at once and compare speed (technique speed - Flaws + Tai Chi - Slow); the higher acts first, the lower acts second; on a tie both count as acting second and damage is -1 (min 1).</p>' +
      '<p><b>Ultimate:</b> once per game; removed from play after use; a miss also removes it and grants +1 Flaw.</p>' +
      '<p><b>Qi Surge:</b> your next technique costs 1 less Qi. <b>Tai Chi:</b> your technique speed is +2 next turn. <b>Slow:</b> your technique speed is -N next turn.</p>' +
      '</div>');
    // 侠客
    HERO_ORDER.forEach(function (hid) {
      var h = DATA.CHARACTERS[hid];
      var cards = h.cards.slice();
      html += codexSection(hid === 'liu' ? 'Sword Hero · Liu Rufeng' : hid === 'tie' ? 'Fist Master · Tie Wushuang' : hid === 'li' ? 'Blade Maniac · Li Zhanfeng' : hid === 'tang' ? 'Thousand Hands · Tang Shiqi' : 'Tai Chi · Zhang Xuanqing',
        '<p class="codex-style">' + escapeHtml(h.style) + '</p>' +
        codexCards(cards) +
        '<p class="codex-ult-label">Ultimate</p>' + codexCards([h.ult]));
    });
    // 公共牌
    html += codexSection('Wulin Secrets · Public Moves (DLC2)', codexCards(DATA.PUBLIC_CARDS));
    // 场景
    var sc = Object.keys(DATA.SCENES).map(function (k) {
      var x = DATA.SCENES[k];
      return '<div class="codex-item scene"><b>' + x.name + '</b>　' + escapeHtml(x.desc) + '</div>';
    }).join('');
    html += codexSection('Ten Directions Wonderland · Scenes (DLC3)', sc);
    // 援护
    var yh = DATA.YUANHU_CARDS.map(function (y) {
      return '<div class="codex-item"><b>' + y.name + '</b>　' + escapeHtml(y.desc) + '</div>';
    }).join('');
    html += codexSection('Two Heroes Rise · Aid (DLC4)', yh);
    body.innerHTML = html;
  }

  // ================= 对局结束 =================
  function showGameOver() {
    var g = UI.game;
    var title, cls, sub;
    if (g.winner === 'p1') { title = g.p1.heroName + ' Wins'; cls = 'p1'; sub = 'Player 1 (' + g.p1.heroName + ') now reigns over the jianghu!'; }
    else if (g.winner === 'p2') { title = g.p2.heroName + ' Wins'; cls = 'p2'; sub = 'Player 2 (' + g.p2.heroName + ') now reigns over the jianghu!'; }
    else if (g.winner === 'draw') { title = 'Draw'; cls = 'draw'; sub = 'Both fell together — good and evil perished alike, a tale told across the jianghu.'; }
    else { title = 'Draw'; cls = 'draw'; sub = 'Sixty turns passed with no victor — the jianghu awaits your return.'; }
    // 战绩记录 + 音效 + 墨爆 + 绝杀定格
    recordGame(g.winner, g.p1.heroName, g.p2.heroName, g.turn);
    sfx(g.winner === 'p1' || g.winner === 'p2' ? 'win' : 'draw');
    spawnInkBurst();
    if (g.winner === 'p1' || g.winner === 'p2') {
      spawnScreenFlash();
      spawnKoSeal(g.winner === 'p1' ? 1 : 0);  // 败者面板砸「败」章
    }
    renderStats();

    var html = '<div class="win-banner">' +
      '<div class="win-title ' + cls + '">' + escapeHtml(title) + '</div>' +
      '<div class="win-sub">' + escapeHtml(sub) + '</div>' +
      '<div class="win-sub">Lasted ' + g.turn + ' turns　|　' +
      'Player 1 HP ' + Math.max(0, g.p1.hp) + ' / ' + g.p1.maxhp + '　|　' +
      'Player 2 HP ' + Math.max(0, g.p2.hp) + ' / ' + g.p2.maxhp + '</div></div>';
    showModal('Duel Over', html, [
      { label: 'Rematch (Same Setup)', id: 'again' },
      { label: 'Back to Setup', id: 'setup' }
    ], function (id) {
      if (id === 'again') { startGame(); }
      else { quitToSetup(); }
    });
  }

  // ================= 事件绑定与初始化 =================
  function bindEvents() {
    $('btn-start').onclick = function () {
      if (UI.heroSel[0] && UI.heroSel[1]) startGame();
    };
    ['opt-dlc2', 'opt-dlc3', 'opt-dlc4'].forEach(function (id) {
      $(id).onchange = function () { renderSetup(); };
    });
    $('btn-quit').onclick = function () {
      showModal('Quit Duel', 'Are you sure you want to end this game and return to the setup screen?', [
        { label: 'Yes, Quit', id: 'yes' },
        { label: 'Keep Fighting', id: 'no' }
      ], function (id) { if (id === 'yes') quitToSetup(); });
    };
    $('btn-enter').onclick = function () {     // 封面：踏入江湖
      showScreen('setup');
      renderSetup();
    };
    // 对战模式
    $('mode-hotseat').onchange = function () { UI.p2AI = !this.checked; renderSetup(); };
    $('mode-ai').onchange = function () { UI.p2AI = !!this.checked; renderSetup(); };
    // AI 难度
    $('ai-easy').onchange = function () { UI.aiLevel = 'easy'; renderSetup(); };
    $('ai-normal').onchange = function () { UI.aiLevel = 'normal'; renderSetup(); };
    $('ai-hard').onchange = function () { UI.aiLevel = 'hard'; renderSetup(); };
    // 武林图鉴
    $('btn-codex').onclick = function () { showCodex(); };
    $('btn-codex-back').onclick = function () { showScreen('setup'); renderSetup(); };
    // 夜墨主题
    $('opt-dark').onchange = function () {
      var dark = !!this.checked;
      applyTheme(dark);
      saveTheme(dark);
      toast(dark ? 'Switched to the Dark Ink Theme' : 'Switched to the Light Paper Theme');
    };
    // 快捷键
    bindKeyboard();
    // 音效开关
    var btnSfx = $('btn-sfx');
    function updateSfxBtn() {
      var muted = SFX ? SFX.muted : false;
      btnSfx.textContent = muted ? 'Sound Off' : 'Sound On';
    }
    if (btnSfx) {
      btnSfx.onclick = function () {
        if (SFX) SFX.toggle(); else UI.sfxMuted = !UI.sfxMuted;
        updateSfxBtn();
        toast(SFX && SFX.muted ? 'Sound off' : 'Sound on');
      };
      updateSfxBtn();
    }
  }

  renderSetup();
  bindEvents();
  applyTheme(loadTheme());                     // 应用保存的主题
  bindParallax();                              // 背景画卷视差
  showScreen('cover');                         // 默认显示封面开场

  // 测试钩子（供自动化测试驱动界面流程）
  window.__JY_UI__ = {
    UI: UI,
    startGame: startGame,
    renderAll: renderAll,
    renderSetup: renderSetup,
    renderDraft: renderDraft,
    renderYuanhu: renderYuanhu,
    draftTransition: draftTransition,
    beginSelectPhase: beginSelectPhase,
    confirmSelection: confirmSelection,
    reveal: reveal,
    nextRound: nextRound,
    quitToSetup: quitToSetup,
    showModal: showModal,
    uiDecide: uiDecide,
    loadStats: loadStats,
    saveStats: saveStats,
    recordGame: recordGame,
    renderStats: renderStats,
    defaultStats: defaultStats,
    showCodex: showCodex,
    applyTheme: applyTheme,
    loadTheme: loadTheme,
    saveTheme: saveTheme
  };
})();

/* ============================================================
 * game.js — 2D 俯视版主游戏：Canvas 渲染 + 相机 + 缩圈 + 结算
 * ============================================================ */

const Game = (() => {
  let cv, ctx, W = 960, H = 600;
  let camX = 0, camZ = 0, camZoom = 9;
  const cars = [];
  const drivers = [];
  const particles = [];
  let player = null;
  let player2 = null;

  let state = 'menu';          // menu | countdown | playing | over
  let countdownT = 0;
  let lastBeep = -1;
  let outerRing = Grid.RING_MAX;
  let collapseTimer = 10;
  let collapseInterval = 10;
  let decayTimer = 5;
  let aliveCount = 0;
  let winner = null;
  let overT = 0;
  let resultShown = false;
  let elapsed = 0;
  let minimapDirty = 0;
  let shakeT = 0;
  let camRot = 0;   // 相机旋转：跟随车头，让车永远朝屏幕上方
  const keys = {};
  const isFast = location.search.includes('fastring');
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  // 经济系统
  const coins = [];
  const MAX_COINS = 12;
  let coinSpawnTimer = 2;
  let matchCoins = 0;
  const COIN_VALUE = 5;
  // 道具系统
  const items = [];
  const MAX_ITEMS = 3;
  let itemSpawnTimer = 8;
  const ITEM_TYPES = ['rocket', 'shield', 'magnet', 'missile', 'cloak'];
  // 观战
  let mode = 'race';           // race | football | infection | lava
  const balls = [];            // 足球列表，每球 {x,z,vx,vz,lastToucher,touchFlash,r}
  let footballTimer = 0;
  let ballSpawnTimer = 0;      // 定时补充新球
  const FOOTBALL_TIME = 90;
  const BALL_R = 4.0;          // 足球半径（约 4 个车宽 ≈ 8 世界单位直径）
  const BALL_COUNT_START = 3;  // 开球球数（多个球同时在场）
  const BALL_MAX = 4;          // 场上球数上限
  const BALL_SPAWN_INTERVAL = 30; // 每 30 秒补一个新球（直到上限）
  const CAR_L = 1.95;          // 车半长（与 draw.js 车身一致）
  const CAR_W = 1.0;           // 车半宽（与 draw.js 车身一致）
  let goalFlash = [0, 0, 0, 0, 0, 0]; // 6 个球门闪光
  let spectateIndex = 0;
  let spectateTimer = 0;
  let spectateTarget = null;
  // 机关（加速带/弹射板/传送门）
  const gadgets = [];
  let gadgetByIdx = new Map();
  // 僵尸车
  const ZOMBIE_MAX = 4;        // 场上僵尸车数量上限
  let zombieCount = 0;
  // 感染模式
  let infectedCount = 0;
  // 熔岩模式计时
  const LAVA_TIME = 120;
  let lavaTimer = 0;
  // 慢动作（死亡回放 / 进球回放）
  let slowmoT = 0;
  let slowmoTarget = null;
  const pendingGoalBalls = [];  // 进球后暂停待重置的球
  let goalReplayLeft = 2;       // 每局最多 2 次进球回放
  // 检查点竞速赛
  let cpRace = false;           // 竞速赛模式开关（mode 仍为 race）
  const checkpoints = [];       // 按序要冲的检查点 {x,z}
  const CP_LAPS = 2;            // 完成圈数获胜
  // 足球：6 个球门中点（供 AI 射门/守门用）
  let goalMids = [];

  /* ---------------- 配置：地图 / 难度 / 双人 ---------------- */
  const MAPS = {
    arena:  { name: '标准竞技场', ringMax: 14, holes: 'none' },
    small:  { name: '小盘快战',   ringMax: 10, holes: 'none' },
    mini:   { name: '迷你竞技场', ringMax: 6,  holes: 'none' },
    mine:   { name: '雷区',       ringMax: 14, holes: 'scatter' },
    canyon: { name: '裂谷',       ringMax: 14, holes: 'line' },
    gadget: { name: '机关场',     ringMax: 12, holes: 'none', gadgets: true },
    custom: { name: '自定义',     ringMax: 14, holes: 'none' },
  };
  const DIFFS = {
    easy:   { name: '简单', skillMin: 0.30, skillMax: 0.62, aiCount: 5, speedMult: 0.92 },
    normal: { name: '普通', skillMin: 0.55, skillMax: 1.00, aiCount: 7, speedMult: 1.00 },
    hard:   { name: '困难', skillMin: 0.78, skillMax: 1.00, aiCount: 7, speedMult: 1.10 },
  };
  const CHALLENGES = [
    { id: 'survive60',  name: '初露锋芒', desc: '存活 60 秒',     type: 'survive', target: 60,  reward: 80 },
    { id: 'coin40',     name: '捡钱小能手', desc: '收集 40 金币', type: 'coin',    target: 40,  reward: 120 },
    { id: 'ram3',       name: '撞人大师',  desc: '撞掉 3 个 AI',  type: 'ram',     target: 3,   reward: 150 },
    { id: 'survive120', name: '铁人三项',  desc: '存活 120 秒',   type: 'survive', target: 120, reward: 200 },
    { id: 'place1',     name: '登顶之路',  desc: '拿到第 1 名',   type: 'place',   target: 1,   reward: 250 },
  ];
  const AI_COLORS = ['#ff4d4d', '#ffa726', '#ffe14d', '#6bd96b', '#4dd0e1', '#b39ddb', '#f48fb1', '#ff6b9d', '#8d6bff', '#5cf0c8'];
  let is2P = false;
  let challenge = null;      // 当前挑战
  let challengeDone = false; // 挑战是否达成
  let koCount = 0;           // 玩家撞掉的 AI 数
  let editRing = 14;         // 编辑器当前圈数
  // 小窗模式
  let miniMode = false;
  const MINI_W = 380, MINI_H = 254;
  let miniX = 14, miniY = 14;
  let dragging = false, dragOffX = 0, dragOffY = 0;
  // 菜单：当前选择的模式（race | 2p | cp | football | football2p | infection | lava）与玩法大类
  let selectedMode = 'race';
  let selectedCat = 'race';

  const $ = (id) => {
    const el = document.getElementById(id);
    // 容错：被简化删除的元素返回空壳，避免报错
    if (!el) return { style: {}, classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, textContent: '', innerHTML: '', value: '', dataset: {}, onclick: null, focus(){}, blur(){} };
    return el;
  };

  /* ---------------- 初始化 ---------------- */
  function init() {
    cv = $('game');
    ctx = cv.getContext('2d');
    onResize();
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    $('btnStart').addEventListener('click', () => { Sound.init(); Sound.startEngine(); launchMode(); });
    $('btnRestart').addEventListener('click', () => location.reload());
    $('btnMute').addEventListener('click', toggleMute);
    $('btnMini').addEventListener('click', () => { if (miniMode) exitMini(); else enterMini(); });
    // 小窗模式
    $('miniToggle').addEventListener('click', () => {
      miniMode = !miniMode;
      refreshMiniToggle();
    });
    $('btnMiniBig').addEventListener('click', () => exitMini());
    $('btnMiniClose').addEventListener('click', () => { exitMini(); location.reload(); });
    // 小窗拖动
    cv.addEventListener('pointerdown', (e) => {
      if (!miniMode) return;
      dragging = true;
      dragOffX = e.clientX - miniX;
      dragOffY = e.clientY - miniY;
      cv.classList.add('dragging');
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!miniMode || !dragging) return;
      moveMini(e.clientX - dragOffX, e.clientY - dragOffY);
    });
    cv.addEventListener('pointerup', () => { dragging = false; cv.classList.remove('dragging'); });
    setupMenuTabs();
    // 地图编辑器
    $('editCanvas').addEventListener('click', editorClick);
    [6, 8, 10, 12, 14].forEach((n) => {
      $('ed-size-' + n).addEventListener('click', () => editorSize(n));
    });
    $('ed-clear').addEventListener('click', () => {
      for (const t of Grid.tiles) { t.state = Grid.ST.SOLID; t.scale = 1; t.perm = false; }
      drawEditor();
    });
    $('ed-save').addEventListener('click', saveEditor);
    $('ed-cancel').addEventListener('click', closeEditor);
    // 手机触屏虚拟按键
    if (isTouch) {
      $('touchUI').style.display = 'flex';
      bindTouch('tl', 'KeyA');
      bindTouch('tr', 'KeyD');
      bindTouch('tJump', null, 'jump');
      bindTouch('tDash', 'KeyE');
    }

    Grid.build(mapCfg());
    buildCars();
    Save.applyToCar(player); // 永久升级生效
    setupShop();

    if (location.search.includes('autostart')) { Sound.init(); Sound.startEngine(); startRace(false); }

    requestAnimationFrame(loop);
  }

  // 菜单里的难度/地图选择按钮
  function setupMenuTabs() {
    Object.keys(DIFFS).forEach((key) => {
      $('diff-' + key).addEventListener('click', () => {
        Save.setPref('diff', key);
        refreshMenuTabs();
      });
    });
    Object.keys(MAPS).forEach((key) => {
      $('map-' + key).addEventListener('click', () => {
        if (key === 'custom') { openEditor(); return; }
        Save.setPref('map', key);
        refreshMenuTabs();
      });
    });
    // 挑战模式
    CHALLENGES.forEach((ch) => {
      $('ch-' + ch.id).addEventListener('click', () => {
        Save.setPref('diff', 'normal');
        startChallenge(ch);
      });
    });
    // AI 数量调节
    $('ai-minus').addEventListener('click', () => changeAiCount(-1));
    $('ai-plus').addEventListener('click', () => changeAiCount(1));
    // 模式选择（两级：玩法大类 → 子模式），高亮当前
    document.querySelectorAll('.cat-btn').forEach((b) => {
      b.addEventListener('click', () => {
        selectedCat = b.dataset.cat;
        // 切大类时，自动选中该大类的第一个子模式
        const first = document.querySelector('.mode-btn[data-cat="' + selectedCat + '"]');
        if (first) selectedMode = first.dataset.mode;
        refreshModeTabs();
      });
    });
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.addEventListener('click', () => {
        selectedMode = b.dataset.mode;
        selectedCat = b.dataset.cat;
        refreshModeTabs();
      });
    });
    refreshModeTabs();
    refreshMiniToggle();
    refreshMenuTabs();
  }

  function refreshModeTabs() {
    // 一级：高亮大类
    document.querySelectorAll('.cat-btn').forEach((b) => b.classList.toggle('sel', b.dataset.cat === selectedCat));
    // 二级：只显示当前大类的子模式，并高亮选中项
    document.querySelectorAll('.mode-btn').forEach((b) => {
      const show = b.dataset.cat === selectedCat;
      b.style.display = show ? '' : 'none';
      b.classList.toggle('sel', b.dataset.mode === selectedMode);
    });
    // 设置项按模式显隐：AI 数量 / 地图只对「生存竞速、双人」有效
    const wantMap = (selectedMode === 'race' || selectedMode === '2p');
    const aiRow = $('aiRow');
    if (aiRow) aiRow.style.display = wantMap ? '' : 'none';
    $('mapRow').style.display = wantMap ? '' : 'none';
    // 开始按钮显示当前模式名
    const names = {
      race: '🏁 生存竞速', '2p': '👥 双人同屏', cp: '🏎 竞速赛',
      football: '⚽ 足球', football2p: '👥⚽ 双人足球',
      infection: '☠ 感染模式', lava: '🔥 熔岩模式',
    };
    $('btnStart').textContent = '🚀 开始 · ' + (names[selectedMode] || '生存竞速');
  }

  function changeAiCount(delta) {
    const cur = (Save.data.aiCount != null) ? Save.data.aiCount : DIFFS[Save.data.diff].aiCount;
    const next = Math.max(1, Math.min(10, cur + delta));
    Save.setPref('aiCount', next);
    refreshMenuTabs();
  }

  // 当前地图配置（自定义地图动态读取存档）
  function mapCfg() {
    const key = Save.data.map;
    if (key === 'custom') {
      return { ringMax: Save.data.customMap.ringMax, holes: 'custom', holeList: Save.data.customMap.holes };
    }
    return MAPS[key];
  }

  function refreshMenuTabs() {
    Object.keys(DIFFS).forEach((key) => {
      $('diff-' + key).classList.toggle('sel', Save.data.diff === key);
    });
    Object.keys(MAPS).forEach((key) => {
      $('map-' + key).classList.toggle('sel', Save.data.map === key);
    });
    // AI 数量显示（未自定义则显示难度默认）
    const aiVal = (Save.data.aiCount != null) ? Save.data.aiCount : DIFFS[Save.data.diff].aiCount;
    $('aiCountVal').textContent = aiVal;
  }

  function onResize() {
    W = miniMode ? MINI_W : window.innerWidth;
    H = miniMode ? MINI_H : window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- 小窗模式 ----
  function moveMini(x, y) {
    miniX = Math.max(0, Math.min(window.innerWidth - MINI_W, x));
    miniY = Math.max(0, Math.min(window.innerHeight - MINI_H, y));
    const r = document.documentElement.style;
    r.setProperty('--mw-x', miniX + 'px');
    r.setProperty('--mw-y', miniY + 'px');
    r.setProperty('--mw-w', MINI_W + 'px');
    r.setProperty('--mw-h', MINI_H + 'px');
  }
  function enterMini() {
    if (miniMode) return;
    miniMode = true;
    document.body.classList.add('mini-mode');
    moveMini(miniX, miniY);
    $('miniHud').style.display = 'block';
    $('miniBtns').style.display = 'flex';
    camZoom = Math.max(camZoom, 14); // 小窗视野拉远，看得更全
    onResize();
  }
  function exitMini() {
    if (!miniMode) return;
    miniMode = false;
    document.body.classList.remove('mini-mode');
    $('miniHud').style.display = 'none';
    $('miniBtns').style.display = 'none';
    camZoom = Math.min(camZoom, 9);
    onResize();
  }
  function refreshMiniToggle() {
    $('miniToggle').textContent = '小窗模式：' + (miniMode ? '开' : '关');
    $('miniToggle').classList.toggle('sel', miniMode);
  }

  // 启动游戏（简化版：固定生存竞速）
  function launchMode() {
    startRace(false);
    if (miniMode) {
      enterMini();
      showBanner('🗔 小窗模式：游戏已在小窗开始，点右上角 ⛶ 放大', 3.5);
    }
  }

  function buildCars(nAIOverride) {
    cars.length = 0;
    drivers.length = 0;
    player2 = null; // 重建车队时清掉上一局遗留的 P2 引用
    const diff = DIFFS[Save.data.diff];
    const nAI = (nAIOverride != null)
      ? Math.max(1, Math.min(12, nAIOverride))
      : ((Save.data.aiCount != null) ? Math.max(1, Math.min(10, Save.data.aiCount)) : diff.aiCount);
    const n = nAI + (is2P ? 2 : 1);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const radius = (Grid.RING_MAX - 0.6) * Grid.SPACING * Math.sqrt(3);
      const px = Math.cos(ang) * radius, pz = Math.sin(ang) * radius;
      const idx = Grid.nearestSolid(px, pz, Grid.RING_MAX - 1);
      let sx = px, sz = pz;
      if (idx >= 0) { const t = Grid.tiles[idx]; sx = t.x; sz = t.z; }
      const yaw = Math.atan2(-sx, -sz);
      let def;
      if (i === 0) def = { name: '你', color: '#2f6bff', isPlayer: true };
      else if (is2P && i === 1) def = { name: 'P2', color: '#ff7b3d', isPlayer: true, p2: true };
      else def = { name: 'AI-' + (i - (is2P ? 2 : 1) + 1), color: AI_COLORS[i - (is2P ? 2 : 1)], isPlayer: false };
      const car = new Car({
        name: def.name, isPlayer: def.isPlayer,
        color: def.color, x: sx, z: sz, yaw,
      });
      if (def.p2) { car.isP2 = true; player2 = car; }
      cars.push(car);
      if (def.isPlayer && !def.p2) player = car;
      else if (!def.isPlayer) drivers.push(new AIDriver(car, Math.random, diff));
    }
    aliveCount = cars.length;
  }

  /* ---------------- 流程 ---------------- */
  function startChallenge(ch) {
    challenge = ch;
    challengeDone = false;
    koCount = 0;
    startRace(false);
  }

  // 足球模式：不缩圈、无安全区、10 辆车 + 中心足球 + 6 边 6 球门（可选双人同队）
  function startFootball(twoP) {
    mode = 'football';
    is2P = !!twoP;
    challenge = null;
    Grid.build({ ringMax: 10, holes: 'none', safeZone: false });
    resetSpecialState();
    buildCars(twoP ? 8 : 9); // 双人：2 玩家 + 8 AI = 10；单人：1 + 9 = 10
    Save.applyToCar(player);
    // 车出生在近中心，开局就能抢球
    for (let i = 0; i < cars.length; i++) {
      const ang = (i / cars.length) * Math.PI * 2;
      const radius = 6 * Grid.SPACING * Math.sqrt(3);
      const px = Math.cos(ang) * radius, pz = Math.sin(ang) * radius;
      const idx = Grid.nearestSolid(px, pz, 8);
      if (idx >= 0) { cars[i].x = Grid.tiles[idx].x; cars[i].z = Grid.tiles[idx].z; }
      cars[i].yaw = Math.atan2(-cars[i].x, -cars[i].z);
      cars[i].vx = 0; cars[i].vz = 0;
    }
    // 开球：多个球分散摆开（中心 + 两侧），互不重叠
    balls.length = 0;
    for (let i = 0; i < BALL_COUNT_START; i++) {
      const ang = (i / BALL_COUNT_START) * Math.PI * 2 + 0.5;
      const rr = i === 0 ? 0 : 12;
      balls.push({
        x: Math.cos(ang) * rr, z: Math.sin(ang) * rr,
        vx: 0, vz: 0, lastToucher: null, touchFlash: 0, r: BALL_R,
      });
    }
    balls.forEach((b) => ballSpawnFree(b));
    ballSpawnTimer = BALL_SPAWN_INTERVAL;
    goalReplayLeft = 2;
    // 6 个球门中点 + 指派 2 个 AI 当守门员
    const R_FLAT = Grid.SPACING * Math.sqrt(3) * (Grid.RING_MAX + 0.5);
    goalMids = [];
    for (let e = 0; e < 6; e++) {
      const a = (e * 60) * Math.PI / 180;
      goalMids.push({ x: Math.cos(a) * R_FLAT, z: Math.sin(a) * R_FLAT });
    }
    drivers.forEach((d) => { d.goalie = false; d.goalIdx = 0; });
    for (let k = 0; k < Math.min(2, drivers.length); k++) {
      const d = drivers[k];
      d.goalie = true;
      let best = 0, bd = 1e9;
      for (let e = 0; e < 6; e++) {
        const dd = Math.hypot(d.car.x - goalMids[e].x, d.car.z - goalMids[e].z);
        if (dd < bd) { bd = dd; best = e; }
      }
      d.goalIdx = best;
    }
    footballTimer = FOOTBALL_TIME;
    goalFlash = [0, 0, 0, 0, 0, 0];
    cars.forEach((c) => { c.goals = 0; c.grace = 3.5; });
    $('menu').style.display = 'none';
    $('hud').style.display = 'block';
    $('minimapWrap').style.display = 'block';
    $('controlsHint').textContent = twoP
      ? '⚽ P1+P2 同队踢 AI！P1: WASD 驾驶 · 空格 跳 · E 撞　|　P2: 方向键 · K 跳 · L 撞 · 进球最多者获胜'
      : '⚽ 把球撞进对方球门！WASD 驾驶 · 空格 跳 · E 冲撞 · 进球最多者获胜';
    state = 'countdown';
    countdownT = 3.05;
    lastBeep = -1;
    matchCoins = 0;
    coins.length = 0;
    coinSpawnTimer = 2;
    items.length = 0;
    itemSpawnTimer = 8;
    spectateTarget = null;
    camX = player.x; camZ = player.z; camZoom = 8.5;
    const cd = $('countdown');
    cd.style.display = 'flex';
    cd.textContent = '3';
  }

  // 足球出界 → 判定进球
  function goalEdgeIndex(ang) {
    let deg = ang * 180 / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    return Math.round(deg / 60) % 6;
  }

  // 车撞球：完整的"球圆 vs 车胶囊体"几何碰撞。
  // 车 = 中轴线段（车尾→车头，半长 CAR_L）+ 半径 CAR_W 的胶囊。
  // 任意角度都保证：① 球与车不相交（推出到刚好相切）② 按命中位置响应
  // （车头半段 → 带球/射门；侧面/后方 → 沿法线弹开，力度随逼近速度）。
  function ballCarCollide(ball, c, applyVel) {
    const BR = ball.r || BALL_R;
    const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
    const ax = c.x - hx * CAR_L, az = c.z - hz * CAR_L; // 车尾
    const bx = c.x + hx * CAR_L, bz = c.z + hz * CAR_L; // 车头
    const ddx = bx - ax, ddz = bz - az;
    const len2 = ddx * ddx + ddz * ddz;
    let t = ((ball.x - ax) * ddx + (ball.z - az) * ddz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + ddx * t, pz = az + ddz * t;      // 中轴最近点
    const cdx = ball.x - px, cdz = ball.z - pz;
    const dist = Math.hypot(cdx, cdz);
    const minD = CAR_W + BR;                          // 相切距离（球缘贴车身）
    if (dist >= minD) return;
    // 法线（球心→最近点）；球心恰压在中轴上时取车侧面法线
    let nx = cdx, nz = cdz;
    if (dist < 1e-6) { nx = -hz; nz = hx; }
    else { nx /= dist; nz /= dist; }
    // 1) 分离（双向）：球大且重，车也顶不开它——车被推回 40%，球被推出 60%，
    //    车无法钻进球体，多车包围时也不会把球夹死在车里。
    const pen = minD - dist;
    const carShare = 0.4;
    ball.x = px + nx * (dist + pen * (1 - carShare));
    ball.z = pz + nz * (dist + pen * (1 - carShare));
    c.x -= nx * pen * carShare;
    c.z -= nz * pen * carShare;
    if (applyVel === false) return; // 只分离不动速度（收敛用）
    // 2) 响应
    if (t > 0.5) {
      // 命中车头半段：带球 + 朝车头踢（速度越快踢得越狠，冲刺更狠）
      const kick = 6 + c.speed() * 0.5 + (c.dashT > 0 ? 10 : 0);
      ball.vx = c.vx * 0.9 + hx * kick;
      ball.vz = c.vz * 0.9 + hz * kick;
      const bs = Math.hypot(ball.vx, ball.vz);
      const cap = c.maxSpeed * 2.2 + 18;
      if (bs > cap) { ball.vx *= cap / bs; ball.vz *= cap / bs; }
      ball.lastToucher = c;
      ball.touchFlash = 0.2;
    } else {
      // 命中侧面/后方：沿法线弹开，力度随逼近速度（耗散，不凭空加能量）
      const closing = -((ball.vx - c.vx) * nx + (ball.vz - c.vz) * nz);
      const imp = Math.max(1.5, closing * 0.45);
      ball.vx = c.vx * 0.5 + nx * imp;
      ball.vz = c.vz * 0.5 + nz * imp;
      ball.lastToucher = c;
    }
  }

  // 残余穿透（多车包围时顺序求解可能夹住球）→ 弹射逃逸
  // 单次：把球从最深处那辆车里弹出；返回是否发生逃逸，循环调用直至无深交
  function ballEscapeOnce(ball) {
    const BR = ball.r || BALL_R;
    const minD = CAR_W + BR;
    let maxR = 0, ex = 0, ez = 0, escCar = null;
    for (const c of cars) {
      if (!c.alive) continue;
      const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
      const ax = c.x - hx * CAR_L, az = c.z - hz * CAR_L;
      const bx = c.x + hx * CAR_L, bz = c.z + hz * CAR_L;
      const ddx = bx - ax, ddz = bz - az;
      const len2 = ddx * ddx + ddz * ddz;
      let t = ((ball.x - ax) * ddx + (ball.z - az) * ddz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cdx = ball.x - (ax + ddx * t), cdz = ball.z - (az + ddz * t);
      const dist = Math.hypot(cdx, cdz);
      const r = minD - dist;
      if (r > maxR) {
        maxR = r;
        if (dist < 1e-6) { ex = -hz; ez = hx; }
        else { ex = cdx / dist; ez = cdz / dist; }
        escCar = c;
      }
    }
    if (maxR <= 0.6 || !escCar) return false;
    // 弹出到相切 + 沿逃逸方向给速度（球被挤出人堆）
    ball.x += ex * maxR;
    ball.z += ez * maxR;
    const boost = 8 + escCar.speed() * 0.8;
    ball.vx = ball.vx * 0.5 + ex * boost;
    ball.vz = ball.vz * 0.5 + ez * boost;
    ball.lastToucher = escCar;
    return true;
  }

  // 球重生时若被车或其它球压着，双向让位直到无重叠
  // （车也挪开 40%——球被四周对称包围时加权方向会抵消，必须让车让位球才能出来）
  function ballSpawnFree(ball) {
    const BR = ball.r || BALL_R;
    const minD = CAR_W + BR;
    for (let n = 0; n < 30; n++) {
      let maxPen = 0;
      for (const c of cars) {
        if (!c.alive) continue;
        const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
        const ax = c.x - hx * CAR_L, az = c.z - hz * CAR_L;
        const bx = c.x + hx * CAR_L, bz = c.z + hz * CAR_L;
        const ddx = bx - ax, ddz = bz - az;
        const len2 = ddx * ddx + ddz * ddz;
        let t = ((ball.x - ax) * ddx + (ball.z - az) * ddz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + ddx * t, pz = az + ddz * t;
        const cdx = ball.x - px, cdz = ball.z - pz;
        const dist = Math.hypot(cdx, cdz);
        const pen = minD - dist;
        if (pen <= 0.01) continue;
        let nx = cdx, nz = cdz;
        if (dist < 1e-6) { nx = -hz; nz = hx; }
        else { nx /= dist; nz /= dist; }
        // 球完全让位到相切，车让 40%
        ball.x = px + nx * minD; ball.z = pz + nz * minD;
        c.x -= nx * pen * 0.4; c.z -= nz * pen * 0.4;
        if (pen > maxPen) maxPen = pen;
      }
      // 其它球也是障碍（多球同时在场时重生不能压着别的球，对半分）
      for (const o of balls) {
        if (o === ball) continue;
        const cdx = ball.x - o.x, cdz = ball.z - o.z;
        const dist = Math.hypot(cdx, cdz);
        const pen = o.r + ball.r - dist;
        if (pen <= 0.01) continue;
        const len = dist < 1e-6 ? 1 : dist;
        ball.x -= (cdx / len) * pen * 0.5; ball.z -= (cdz / len) * pen * 0.5;
        o.x += (cdx / len) * pen * 0.5; o.z += (cdz / len) * pen * 0.5;
        if (pen > maxPen) maxPen = pen;
      }
      if (maxPen <= 0.01) return;
    }
  }

  // 球-球：等质量弹性对撞（分离 + 交换法线速度分量）；返回是否发生分离
  function ballBallCollide(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const minD = a.r + b.r;
    if (dist >= minD || dist < 1e-6) return false;
    const nx = dx / dist, nz = dz / dist;
    const overlap = minD - dist;
    a.x -= nx * overlap * 0.5; a.z -= nz * overlap * 0.5;
    b.x += nx * overlap * 0.5; b.z += nz * overlap * 0.5;
    const va = a.vx * nx + a.vz * nz; // 法线速度分量
    const vb = b.vx * nx + b.vz * nz;
    const dv = va - vb;
    if (dv <= 0) return true; // 相离/静止：只分离不换速
    a.vx += (vb - va) * nx; a.vz += (vb - va) * nz;
    b.vx += (va - vb) * nx; b.vz += (va - vb) * nz;
    return true;
  }

  // 该位置是否够空（不贴车、不贴其它球）
  function ballSpotFree(b, carGap) {
    for (const c of cars) {
      if (c.alive && Math.hypot(c.x - b.x, c.z - b.z) < carGap) return false;
    }
    for (const o of balls) {
      if (o !== b && Math.hypot(o.x - b.x, o.z - b.z) < o.r + b.r + 1) return false;
    }
    return true;
  }

  // 造一个球：优先随机空位，找不到就落中心再外推（供补球与进球重生复用）
  function makeBallAtFreeSpot() {
    const b = { x: 0, z: 0, vx: 0, vz: 0, lastToucher: null, touchFlash: 0, r: BALL_R };
    for (let tries = 0; tries < 30; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = 6 + Math.random() * 22;
      b.x = Math.cos(ang) * rr; b.z = Math.sin(ang) * rr;
      if (ballSpotFree(b, 7)) break;
    }
    ballSpawnFree(b);
    return b;
  }

  // 定时补一个新球（带横幅）
  function spawnNewBall() {
    const b = makeBallAtFreeSpot();
    balls.push(b);
    showBanner('⚽ 新球登场！场上 ' + balls.length + ' 个球', 1.6);
  }

  function updateBalls(dt) {
    if (!balls.length) return;
    const R_FLAT = Grid.SPACING * Math.sqrt(3) * (Grid.RING_MAX + 0.5);
    const active = balls.filter((b) => !b._goalPause); // 进球回放中的球冻结在球门处
    if (!active.length) return;
    // 摩擦 + 积分（每球独立）
    for (const ball of active) {
      ball.vx *= (1 - dt * 0.45);
      ball.vz *= (1 - dt * 0.45);
      ball.x += ball.vx * dt;
      ball.z += ball.vz * dt;
      if (ball.touchFlash > 0) ball.touchFlash -= dt;
    }
    // 车-球碰撞：每个球完整过一遍（圆-胶囊 + 逃逸）
    for (const ball of active) {
      for (let iter = 0; iter < 3; iter++) {
        for (const c of cars) if (c.alive) ballCarCollide(ball, c);
      }
      for (let iter = 0; iter < 2; iter++) {
        for (const c of cars) if (c.alive) ballCarCollide(ball, c, false);
      }
      for (let k = 0; k < 5; k++) {
        if (!ballEscapeOnce(ball)) break;
      }
    }
    // 球-球碰撞（多球同时在场），循环直到无重叠
    for (let bb = 0; bb < 3; bb++) {
      let dirty = false;
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          if (ballBallCollide(active[i], active[j])) dirty = true;
        }
      }
      if (!dirty) break;
    }
    // 车-球第二轮纯分离 + 逃逸（清掉球-球对撞挤进车的残余）
    for (const ball of active) {
      for (let iter = 0; iter < 2; iter++) {
        for (const c of cars) if (c.alive) ballCarCollide(ball, c, false);
      }
      for (let k = 0; k < 5; k++) {
        if (!ballEscapeOnce(ball)) break;
      }
    }
    // 再清一次球-球（车-球分离可能又把球挤回别的球）
    for (let bb = 0; bb < 3; bb++) {
      let dirty = false;
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          if (ballBallCollide(balls[i], balls[j])) dirty = true;
        }
      }
      if (!dirty) break;
    }
    // 出界（球缘越过平台边界六边形）→ 按最近边判进球，进球那球重置
    for (const ball of active) {
      const BR = ball.r || BALL_R;
      const r = Math.hypot(ball.x, ball.z);
      if (r + BR <= R_FLAT) continue;
      const ang = Math.atan2(ball.z, ball.x);
      let deg = ang * 180 / Math.PI;
      deg = ((deg % 360) + 360) % 360;
      const edge = Math.round(deg / 60) % 6;
      const mid = edge * 60;
      let off = Math.abs(deg - mid);
      if (off > 180) off = 360 - off;
      const boundary = R_FLAT / Math.cos(off * Math.PI / 180);
      if (r + BR < boundary) continue;
      const scorer = ball.lastToucher;
      goalFlash[edge] = 1;
      if (scorer) {
        scorer.goals = (scorer.goals || 0) + 1;
        Sound.goal();
        showBanner('⚽ GOAL！' + scorer.name + ' 进球（共 ' + scorer.goals + ' 球）', 2);
      }
      // 进球回放：玩家进球时慢动作 + 镜头锁球（每局限 2 次）；回放结束后再重置
      const isPlayerGoal = scorer && (scorer === player || (player2 && scorer === player2));
      if (isPlayerGoal && goalReplayLeft > 0 && slowmoT <= 0 && !pendingGoalBalls.length) {
        goalReplayLeft--;
        ball._goalPause = 1;
        pendingGoalBalls.push(ball);
        slowmoT = 2.4;
        slowmoTarget = ball;
        continue; // 这球暂停在球门处等回放
      }
      // 这球重生到随机空位（多球时中心人人扎堆，随机空位不挤、不穿模）
      const nb = makeBallAtFreeSpot();
      ball.x = nb.x; ball.z = nb.z;
      ball.vx = (Math.random() - 0.5) * 4;
      ball.vz = (Math.random() - 0.5) * 4;
      ball.lastToucher = null;
    }
  }

  function endFootball() {
    state = 'over';
    overT = 0;
    resultShown = false;
    // 进球最多者获胜；同分存活者优先
    winner = cars[0];
    for (const c of cars) {
      const wg = winner.goals || 0, cg = c.goals || 0;
      if (cg > wg || (cg === wg && c.alive && !winner.alive)) winner = c;
    }
    showBanner('⏱ 终场！' + (winner.isPlayer ? '你' : winner.name) + ' 进球最多', 3);
  }

  function startRace(twoP) {
    is2P = !!twoP;
    mode = 'race';
    // 按所选地图重建平台 + 按所选难度/人数重建赛车
    Grid.build(mapCfg());
    resetSpecialState();
    if (mapCfg().gadgets) buildGadgets();
    // 重置缩圈状态（换地图后外圈号必须跟随新地图）
    outerRing = Grid.RING_MAX;
    collapseTimer = isFast ? 3 : 10;
    collapseInterval = collapseTimer;
    buildCars();
    Save.applyToCar(player);
    $('menu').style.display = 'none';
    $('hud').style.display = 'block';
    $('minimapWrap').style.display = 'block';
    // 按键提示（双人时显示 P2 按键）
    $('controlsHint').textContent = is2P
      ? 'P1: WASD 驾驶 · 空格 跳 · E 撞 · Shift 手刹　|　P2: 方向键 · K 跳 · L 撞 · J 手刹'
      : 'WASD / 方向键 驾驶 · 空格 跳跃 · E 冲撞 · Shift 手刹（漂移蓄氮气）· M 静音';
    state = 'countdown';
    countdownT = 3.05;
    lastBeep = -1;
    cars.forEach((c) => { c.grace = 3.5; });
    matchCoins = 0;
    coins.length = 0;
    coinSpawnTimer = 2;
    items.length = 0;
    itemSpawnTimer = 8;
    spectateTarget = null;
    camX = player.x; camZ = player.z; camZoom = 9;
    const cd = $('countdown');
    cd.style.display = 'flex';
    cd.textContent = '3';
  }

  // 挑战达成：立即胜利结算
  function challengeWin() {
    challengeDone = true;
    state = 'over';
    winner = player;
    overT = 0;
    resultShown = false;
    showBanner('🎉 挑战完成！+💰' + challenge.reward, 2.5);
    Sound.go();
  }

  // 头顶吐槽气泡
  function say(car, text, dur) {
    if (!car || car.isPlayer) return; // 只有 AI 会吐槽
    car.bubble = { text, t: dur || 1.6 };
  }
  const pickPhrase = (pool) => pool[(Math.random() * pool.length) | 0];

  // 机关场布局：6 加速带（外圈切线方向）+ 3 弹射板（近中心）+ 2 组传送门（最外圈对侧）
  function buildGadgets() {
    gadgets.length = 0;
    gadgetByIdx = new Map();
    const place = (ring, ang, type, dir, pair) => {
      const rw = ring * Grid.SPACING * 1.5;
      const px = Math.cos(ang) * rw, pz = Math.sin(ang) * rw;
      const idx = Grid.nearestSolid(px, pz, ring + 1);
      if (idx < 0) return null;
      const t = Grid.tiles[idx];
      const g = { x: t.x, z: t.z, tileIdx: idx, type, dir: dir || 0, pair: pair == null ? -1 : pair };
      gadgets.push(g);
      gadgetByIdx.set(idx, g);
      return g;
    };
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + Math.PI / 6;
      place(5, ang, 'boost', ang + Math.PI / 2); // 沿圈切线顺时针
    }
    for (const ang of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) place(2, ang, 'jump');
    const p1 = place(9, 0, 'portal'), p2 = place(9, Math.PI, 'portal');
    const p3 = place(9, Math.PI / 3, 'portal'), p4 = place(9, Math.PI * 4 / 3, 'portal');
    if (p1 && p2) { p1.pair = gadgets.indexOf(p2); p2.pair = gadgets.indexOf(p1); }
    if (p3 && p4) { p3.pair = gadgets.indexOf(p4); p4.pair = gadgets.indexOf(p3); }
    // 机关扩展：地雷（爆炸弹飞）/ 加速门（直线走廊）/ 弹簧台（大跳发射）
    for (const ang of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
      const g = place(7, ang, 'mine');
      if (g) g.armed = true;
    }
    for (const ang of [0, Math.PI]) place(6, ang, 'gate', ang);
    for (const ang of [Math.PI / 3, Math.PI * 4 / 3]) place(3, ang, 'spring');
  }

  // 僵尸车：淘汰后游荡 + 见人就冲
  function zombieUpdate(c, dt, grid) {
    const ud = c.userData;
    if (!ud.zTarget || ud.zRepick <= 0) {
      ud.zRepick = 2 + Math.random() * 3;
      // 找最近的活人冲，否则随机游荡
      let best = null, bd = 14 * 14;
      for (const o of cars) {
        if (o === c || !o.alive || o.zombie) continue;
        const d = (o.x - c.x) * (o.x - c.x) + (o.z - c.z) * (o.z - c.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) { ud.zTarget = { x: best.x, z: best.z, charge: true }; }
      else {
        const idx = grid.nearestSafe(c.x, c.z, grid.RING_MAX, false);
        if (idx >= 0) ud.zTarget = { x: grid.tiles[idx].x, z: grid.tiles[idx].z, charge: false };
      }
    } else {
      ud.zRepick -= dt;
    }
    const tx = ud.zTarget.x, tz = ud.zTarget.z;
    c.throttle = 1;
    c.dash = ud.zTarget.charge && c.canDash();
    let err = Math.atan2(tx - c.x, tz - c.z) - c.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    c.steer = Math.max(-1, Math.min(1, err * 2));
    if (Math.hypot(tx - c.x, tz - c.z) < 2.5) ud.zRepick = 0;
  }

  function startInfection() {
    mode = 'infection';
    is2P = false;
    challenge = null;
    Grid.build({ ringMax: 12, holes: 'none', safeZone: true });
    buildCars(7); // 你 + 7 AI = 8 人
    Save.applyToCar(player);
    resetSpecialState();
    // 随机选一个 AI 当初始感染者
    const pool = cars.filter((c) => !c.isPlayer);
    const first = pool[(Math.random() * pool.length) | 0];
    first.infected = true;
    first.infectTime = elapsed;
    infectedCount = 1;
    $('menu').style.display = 'none';
    $('hud').style.display = 'block';
    $('minimapWrap').style.display = 'block';
    $('controlsHint').textContent = '☠ ' + first.name + ' 是感染者！碰到就会被传染 · 最后没被感染的人获胜 · 缩圈照旧';
    state = 'countdown';
    countdownT = 3.05;
    lastBeep = -1;
    matchCoins = 0;
    coins.length = 0;
    coinSpawnTimer = 2;
    items.length = 0;
    itemSpawnTimer = 8;
    spectateTarget = null;
    camX = player.x; camZ = player.z; camZoom = 9;
    const cd = $('countdown');
    cd.style.display = 'flex';
    cd.textContent = '3';
  }

  function startLava() {
    mode = 'lava';
    is2P = false;
    challenge = null;
    // 熔岩：地板被踩过就永久消失，不缩圈，跑到最后一个人
    Grid.build({ ringMax: 14, holes: 'none', safeZone: false, lava: true });
    buildCars(7); // 你 + 7 AI = 8 人
    Save.applyToCar(player);
    resetSpecialState();
    lavaTimer = LAVA_TIME;
    $('menu').style.display = 'none';
    $('hud').style.display = 'block';
    $('minimapWrap').style.display = 'block';
    $('controlsHint').textContent = '🔥 踩过的地板会永久消失！永远开新路 · 最后活着的人获胜 · 掉下去即淘汰';
    state = 'countdown';
    countdownT = 3.05;
    lastBeep = -1;
    matchCoins = 0;
    coins.length = 0;
    coinSpawnTimer = 2;
    items.length = 0;
    itemSpawnTimer = 8;
    spectateTarget = null;
    camX = player.x; camZ = player.z; camZoom = 9;
    const cd = $('countdown');
    cd.style.display = 'flex';
    cd.textContent = '3';
  }

  // 检查点竞速赛：异型赛道，按 1→6 顺序冲检查点，完成 CP_LAPS 圈获胜
  function startCpRace() {
    mode = 'race';
    is2P = false;
    challenge = null;
    buildCars(7); // 你 + 7 AI = 8 人
    Save.applyToCar(player);
    resetSpecialState();
    cpRace = true;
    // 异型赛道：建网格 + 抠出环形赛道 + 检查点沿赛道分布
    const samples = buildTrack();
    // 车沿赛道均匀起跑
    for (let i = 0; i < cars.length; i++) {
      const s = samples[Math.floor((i / cars.length) * samples.length) % samples.length];
      const s2 = samples[(Math.floor((i / cars.length) * samples.length) + 3) % samples.length];
      cars[i].x = s[0]; cars[i].z = s[1];
      cars[i].yaw = Math.atan2(s2[0] - s[0], s2[1] - s[1]);
      cars[i].vx = 0; cars[i].vz = 0;
    }
    cars.forEach((c) => { c.cpNext = 0; c.laps = 0; c.grace = 3.5; });
    outerRing = -1; // 赛道固定，不缩圈
    $('menu').style.display = 'none';
    $('hud').style.display = 'block';
    $('minimapWrap').style.display = 'block';
    $('controlsHint').textContent = '🏁 异型赛道竞速！路面会掉落但会恢复，还有分支捷径 · 按顺序冲 6 检查点完成 2 圈获胜';
    state = 'countdown';
    countdownT = 3.05;
    lastBeep = -1;
    matchCoins = 0;
    coins.length = 0;
    coinSpawnTimer = 2;
    items.length = 0;
    itemSpawnTimer = 8;
    spectateTarget = null;
    camX = player.x; camZ = player.z; camZoom = 9;
    const cd = $('countdown');
    cd.style.display = 'flex';
    cd.textContent = '3';
  }

  // ---- 异型赛道生成：Catmull-Rom 闭合样条 + 宽度变化，抠出环形路面 ----
  function buildTrack() {
    // 赛道中心线控制点（世界坐标，环形）：
    // 大直道 → 高速右弯 → 发卡弯 → S 弯 → 左长弯 → 回大直道
    const P = [
      [-18, -50], [8, -54], [34, -48], [54, -30], [60, -6],
      [50, 16], [26, 26], [10, 18], [-4, 30], [-16, 40],
      [-32, 28], [-46, 10], [-54, -12], [-46, -34], [-32, -48],
    ];
    // 闭合 Catmull-Rom 采样
    const samples = [];
    const N = 240;
    for (let i = 0; i < N; i++) {
      const f = (i / N) * P.length;
      const i0 = Math.floor(f) % P.length;
      const t = f - Math.floor(f);
      const a = P[(i0 - 1 + P.length) % P.length];
      const b = P[i0];
      const c = P[(i0 + 1) % P.length];
      const d = P[(i0 + 2) % P.length];
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3);
      const z = 0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3);
      samples.push([x, z]);
    }
    // 网格范围要覆盖整个赛道
    let maxR = 0;
    for (const [x, z] of samples) maxR = Math.max(maxR, Math.hypot(x, z));
    const ringMax = Math.ceil(maxR / (Grid.SPACING * 1.5)) + 3;
    Grid.build({ ringMax, holes: 'none', safeZone: false });
    // 分支捷径：内部内切路线（从主路岔开、前方重新汇合），与主路同样算路面
    const BRANCHES = [
      // 内部捷径：下直道 → 场地内部 → 右侧（跳过外侧高速弯，走更紧凑的线）
      [[10, -44], [24, -28], [34, -12], [34, 6], [28, 18]],
      // 左侧内切：切开左侧大弧
      [[-26, -40], [-18, -20], [-22, 0], [-28, 16]],
    ];
    // 宽度：整体加宽（半宽 8.3 ~ 12.7 世界单位 ≈ 5~7 格宽），直道宽、弯道略窄
    const widths = samples.map((_, i) => 10.5 + 2.2 * Math.sin(i * 0.09));
    // 靠近任一中心线的瓦片 = 路面（会掉落并恢复，和生存模式一致），其余 = 深坑
    for (const t of Grid.tiles) {
      let d = distToPolyline(t.x, t.z, samples);
      for (const br of BRANCHES) d = Math.min(d, distToPolyline(t.x, t.z, br));
      if (d < widths[nearestSample(t.x, t.z, samples)]) {
        t.state = Grid.ST.SOLID; t.scale = 1; t.perm = false; t.safe = false; t.road = true;
      } else {
        t.state = Grid.ST.DEAD; t.scale = 0; t.perm = true; t.safe = false; t.road = false;
      }
    }
    // 检查点沿中心线等距
    checkpoints.length = 0;
    for (let k = 0; k < 6; k++) {
      const s = samples[Math.floor((k / 6) * samples.length) % samples.length];
      checkpoints.push({ x: s[0], z: s[1] });
    }
    return samples;
  }

  // 点到折线的距离（逐段投影取最小）
  function distToPolyline(x, z, pts) {
    let best = 1e9;
    for (let i = 0; i < pts.length; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const bx = pts[(i + 1) % pts.length][0], bz = pts[(i + 1) % pts.length][1];
      const ddx = bx - ax, ddz = bz - az;
      const len2 = ddx * ddx + ddz * ddz || 1e-9;
      let t = ((x - ax) * ddx + (z - az) * ddz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + ddx * t, cz = az + ddz * t;
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function nearestSample(x, z, pts) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < pts.length; i++) {
      const d = (x - pts[i][0]) * (x - pts[i][0]) + (z - pts[i][1]) * (z - pts[i][1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // 竞速赛：冲检查点 + 圈数判定
  function updateCpRace() {
    for (const c of cars) {
      if (!c.alive) continue;
      const cp = checkpoints[c.cpNext % checkpoints.length];
      if (!cp) continue;
      if (Math.hypot(c.x - cp.x, c.z - cp.z) < 3.4) {
        c.cpNext++;
        if (c.cpNext >= checkpoints.length) {
          c.cpNext = 0;
          c.laps++;
          if (c === player || c === player2) {
            showBanner('🏁 完成第 ' + c.laps + ' 圈！' + (c.laps >= CP_LAPS ? ' 冲线！' : ''), 2);
            Sound.goal();
          }
        } else if (c === player || c === player2) {
          showBanner('✅ 检查点 ' + c.cpNext + ' / ' + checkpoints.length, 1.2);
          Sound.coin();
        }
        if (c.laps >= CP_LAPS) {
          winner = c;
          state = 'over';
          overT = 0;
          resultShown = false;
          showBanner((c.isPlayer ? '🏆 你' : '🏆 ' + c.name) + ' 率先冲线，冠军！', 3);
          Sound.go();
          return;
        }
      }
    }
  }

  // 清空上一局遗留的特殊状态（僵尸/感染/机关/慢动作/竞速赛）
  function resetSpecialState() {
    zombieCount = 0;
    infectedCount = 0;
    gadgets.length = 0;
    gadgetByIdx = new Map();
    slowmoT = 0;
    slowmoTarget = null;
    pendingGoalBalls.length = 0;
    cpRace = false;
    checkpoints.length = 0;
    for (const b of balls) delete b._goalPause;
    for (const c of cars) {
      c.zombie = false;
      c.infected = false;
      c.infectTime = 0;
      c.bubble = null;
      delete c.userData.zTarget;
    }
  }

  // 机关效果：加速带/弹射板/传送门
  function updateGadgets(dt) {
    for (const c of cars) {
      if (!c.alive && !c.zombie) continue;
      const g = gadgetByIdx.get(Grid.idxAt(c.x, c.z));
      if (!g) continue;
      if (g.type === 'boost') {
        if ((c.userData.padCd || 0) > 0) continue; // 冷却，避免贴边反复触发
        c.userData.padCd = 1.2;
        const bx = Math.cos(g.dir), bz = Math.sin(g.dir);
        c.vx += bx * 16; c.vz += bz * 16;
        const spd = c.speed();
        const cap = c.maxSpeed * 2.2;
        if (spd > cap) { c.vx *= cap / spd; c.vz *= cap / spd; }
        spark(g.x, g.z, '#6fd3ff', 10);
        Sound.whoosh();
        if (c === player || c === player2) shakeT = 0.15;
      } else if (g.type === 'jump') {
        if (c.airborne) continue;
        c.airborne = true;
        c.jumpT = Math.max(c.jumpT, 1.25);
        c.grounded = false;
        const h = c.heading();
        c.vx += h.x * 6; c.vz += h.z * 6;
        spark(g.x, g.z, '#ffd98a', 12);
        Sound.jump();
      } else if (g.type === 'spring') {
        // 弹簧台：把车沿车头方向发射出去 + 超长滞空
        if (c.airborne || (c.userData.padCd || 0) > 0) continue;
        c.userData.padCd = 1.2;
        const h = c.heading();
        c.vx += h.x * 26; c.vz += h.z * 26;
        const spd = c.speed();
        const cap = c.maxSpeed * 2.6;
        if (spd > cap) { c.vx *= cap / spd; c.vz *= cap / spd; }
        c.airborne = true;
        c.jumpT = Math.max(c.jumpT, 1.6);
        c.grounded = false;
        spark(g.x, g.z, '#ffffff', 16);
        Sound.whoosh();
        if (c === player || c === player2) shakeT = 0.25;
      } else if (g.type === 'gate') {
        // 加速门：穿过两柱之间 → 直线加速
        if ((c.userData.padCd || 0) > 0) continue;
        const gx = Math.cos(g.dir), gz = Math.sin(g.dir);
        const px = c.x - g.x, pz = c.z - g.z;
        const along = px * gx + pz * gz;
        const perp = Math.abs(px * -gz + pz * gx);
        if (Math.abs(along) < 4.2 && perp < 2.6) {
          c.userData.padCd = 1.2;
          c.vx += gx * 22; c.vz += gz * 22;
          const spd = c.speed();
          const cap = c.maxSpeed * 2.4;
          if (spd > cap) { c.vx *= cap / spd; c.vz *= cap / spd; }
          spark(g.x, g.z, '#7fe0ff', 12);
          Sound.whoosh();
          if (c === player || c === player2) showBanner('💨 加速门！', 0.9);
        }
      } else if (g.type === 'mine') {
        // 地雷：踩到爆炸弹飞，6 秒后重新布防
        if (!g.armed) continue;
        if (Math.hypot(c.x - g.x, c.z - g.z) > 2.3) continue;
        g.armed = false;
        g.armT = 6;
        let dx = c.x - g.x, dz = c.z - g.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        c.vx += dx * 20; c.vz += dz * 20;
        c.stunT = Math.max(c.stunT, 0.5);
        c.spinV = (Math.random() - 0.5) * 10;
        c.hitEvent = Math.max(c.hitEvent || 0, 16);
        c.hitFlash = 0.3;
        c.itemFlash = 0.3;
        spark(g.x, g.z, '#ff5d3d', 26);
        Sound.crash();
        if (c === player || c === player2) { shakeT = 0.4; showBanner('💣 踩到地雷！', 1.2); }
      } else if (g.type === 'portal') {
        if ((c.userData.portalCd || 0) > 0) continue;
        c.userData.portalCd = 1.5;
        const other = gadgets[g.pair];
        if (other) {
          spark(g.x, g.z, '#c98bff', 14);
          spark(other.x, other.z, '#c98bff', 14);
          c.x = other.x; c.z = other.z;
          c.vx *= 0.6; c.vz *= 0.6;
          c.itemFlash = 0.4;
          Sound.whoosh();
          if (c === player || c === player2) showBanner('🌀 传送！', 1);
        }
      }
    }
    for (const c of cars) {
      if (c.userData.padCd > 0) c.userData.padCd -= dt;
      if (c.userData.portalCd > 0) c.userData.portalCd -= dt;
    }
    // 地雷重新布防
    for (const g of gadgets) {
      if (g.type === 'mine' && !g.armed) {
        g.armT -= dt;
        if (g.armT <= 0) g.armed = true;
      }
    }
  }

  // 感染模式：触碰传染 + 保险传染 + 结束判定
  function updateInfection() {
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (!b.alive) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > 2.3) continue;
        if ((a.infected || a.zombie) && !b.infected && !b.zombie) infectCar(b, a);
        else if ((b.infected || b.zombie) && !a.infected && !a.zombie) infectCar(a, b);
      }
    }
    infectedCount = cars.filter((c) => c.alive && c.infected).length;
    // 保险：感染者全没了但正常人还有多个 → 随机传染一个（避免僵局）
    if (infectedCount === 0) {
      const un = cars.filter((c) => c.alive && !c.infected && !c.zombie);
      if (un.length > 1) infectCar(un[(Math.random() * un.length) | 0], null, true);
    }
    // 结束：正常人 ≤ 1
    const unInfected = cars.filter((c) => c.alive && !c.infected && !c.zombie).length;
    if (unInfected <= 1 && state === 'playing') {
      const survivor = cars.find((c) => c.alive && !c.infected && !c.zombie);
      if (survivor) {
        winner = survivor;
      } else {
        // 全员感染：最后一个被感染的（感染最晚）算"活到最后"
        winner = cars.filter((c) => c.alive).reduce((a, b) => (b.infectTime > a.infectTime ? b : a), cars[0]);
      }
      state = 'over';
      overT = 0;
      resultShown = false;
      showBanner(survivor && survivor.isPlayer ? '😇 你是唯一没被感染的人！获胜！'
        : '😇 ' + (survivor ? survivor.name : winner.name) + ' 没被感染，获胜！', 3);
      Sound.go();
    }
  }

  function infectCar(c, from, silent) {
    if (c.infected || c.zombie || !c.alive) return;
    c.infected = true;
    c.infectTime = elapsed;
    infectedCount++;
    Sound.infected();
    spark(c.x, c.z, '#c44dff', 16);
    if (c === player) {
      showBanner('☠ 你被感染了！快去传染别人！', 2.5);
    } else {
      showBanner('☠ ' + c.name + ' 被感染了！', 2);
      if (!silent) say(c, pickPhrase(['不要啊！！', '我恨你！！', '好恶！', '救命啊！', '完了完了！']), 2);
      if (from && from.zombie) say(from, '嘿嘿……', 1.6);
      else if (from && from.infected && !from.isPlayer && Math.random() < 0.5) {
        say(from, pickPhrase(['嘿嘿，传染成功！', '你也是感染者了！', '别怪我！']), 1.6);
      }
    }
    if (challenge && c === player) challengeDone = false;
  }

  function endGame() {
    state = 'over';
    overT = 0;
    resultShown = false;
    const alive = cars.filter((c) => c.alive);
    if (alive.length === 1) winner = alive[0];
    else {
      winner = cars.reduce((a, b) => (!a || b.eliminatedAt > a.eliminatedAt) ? b : a, null);
    }
    // 挑战"登顶之路"：拿到第 1 名即达成
    if (challenge && challenge.type === 'place' && winner === player) challengeDone = true;
    showBanner(winner && winner.isPlayer ? '🏆 冠军：你！' : '🏆 冠军：' + (winner ? winner.name : '无'), 3);
  }

  function placementOf(car) {
    if (car.alive) return 1;
    const pe = car.eliminatedAt;
    return 1 + cars.filter((c) => c !== car && (c.alive || c.eliminatedAt > pe)).length;
  }

  function showResult() {
    resultShown = true;
    // 足球结算：进球最多者获胜
    if (mode === 'football') {
      const myG = (player.goals || 0) + (player2 ? (player2.goals || 0) : 0);
      const win = winner === player || (player2 && winner === player2);
      $('resultTitle').textContent = win ? '🏆 你赢了！' : '⚽ 终场';
      // 比分榜（前 3 名）
      const sorted = cars.slice().sort((a, b) => (b.goals || 0) - (a.goals || 0) || Number(b.alive) - Number(a.alive));
      const top3 = sorted.slice(0, 3).map((c, i) => `${i + 1}. ${c.isPlayer ? (c === player ? '你' : 'P2') : c.name} ${c.goals || 0}球`).join('　');
      $('resultSub').innerHTML = win
        ? `你们进了 <b>${myG}</b> 球，全场最多！`
        : '冠军是 <b>' + (winner ? (winner.isPlayer ? (winner === player ? '你' : 'P2') : winner.name) : '无') + '</b>（' + (winner.goals || 0) + ' 球）';
      const total = matchCoins + (win ? 150 : 30);
      Save.addCoins(total);
      $('resultEarn').textContent = `你们 ${myG} 球 · 比分：${top3} · 奖金 💰${total}`;
      $('wallet').textContent = Save.data.coins;
      $('result').style.display = 'flex';
      return;
    }
    // 挑战结算
    if (challenge) {
      const done = challengeDone;
      $('resultTitle').textContent = done ? '🎉 挑战完成！' : '💥 挑战失败';
      $('resultSub').innerHTML = done
        ? `<b>${challenge.name}</b>：${challenge.desc} 达成！`
        : `<b>${challenge.name}</b>：${challenge.desc} 未达成，再试一次！`;
      if (done) {
        Save.addCoins(challenge.reward);
        $('resultEarn').textContent = `奖励 💰${challenge.reward}`;
      } else {
        $('resultEarn').textContent = '失败无奖励，再试一次！';
      }
      $('wallet').textContent = Save.data.coins;
      $('result').style.display = 'flex';
      challenge = null;
      return;
    }
    // 感染模式结算：最后没被感染的人获胜
    if (mode === 'infection') {
      const win = winner === player;
      $('resultTitle').textContent = win ? '😇 你免疫了！' : '☠ 你被感染了';
      $('resultSub').innerHTML = win
        ? '你是唯一没被感染的人，病毒之王也得服你！'
        : '冠军是 <b>' + (winner ? winner.name : '无') + '</b>——最后一个没被感染的人';
      const total = matchCoins + (win ? 150 : 30);
      Save.addCoins(total);
      $('resultEarn').textContent = `幸存者 ${winner ? winner.name : '无'} · 收集 💰${matchCoins} · 奖金 💰${total}`;
      $('wallet').textContent = Save.data.coins;
      $('result').style.display = 'flex';
      return;
    }
    // 熔岩模式结算：最后活着 / 时间到金币最多
    if (mode === 'lava') {
      const win = winner === player;
      $('resultTitle').textContent = win ? '🔥 熔岩之王！' : '💥 地板吃掉了你';
      $('resultSub').innerHTML = win
        ? '你在不断塌陷的地板上活到了最后！'
        : '冠军是 <b>' + (winner ? winner.name : '无') + '</b>（剩瓦 ' + Grid.solidCount() + ' 块）';
      const total = matchCoins + (win ? 150 : 30);
      Save.addCoins(total);
      $('resultEarn').textContent = `你收集 💰${matchCoins} · 奖金 💰${total}`;
      $('wallet').textContent = Save.data.coins;
      $('result').style.display = 'flex';
      return;
    }
    const win = winner && winner.isPlayer;
    $('resultTitle').textContent = win ? '🏆 你赢了！' : '💥 你被淘汰了';
    // 经济结算：名次 + 收集金币（只有 P1 有钱包）
    const p1Place = placementOf(player);
    const p2Place = player2 ? placementOf(player2) : null;
    $('resultSub').innerHTML = win
      ? '你坚持到了最后，是当之无愧的赛道之王！'
      : '冠军是 <b>' + (winner ? winner.name : '无') + '</b>，再试一次干掉它！'
      + (player2 ? `<br>你第 ${p1Place} 名 · P2 第 ${p2Place} 名` : '');
    const bonus = [100, 60, 40, 25, 10][Math.min(p1Place - 1, 4)];
    const total = matchCoins + bonus;
    Save.addCoins(total);
    // 金币收集排名（AI 也会抢金币）
    const coinRank = 1 + cars.filter((c) => c !== player && (c.coinCount || 0) > (player.coinCount || 0)).length;
    $('resultEarn').textContent =
      `你 第 ${p1Place} 名 · 收集 💰${matchCoins}（全场第 ${coinRank}）· 名次奖金 💰${bonus} = 本局 +💰${total}`;
    $('wallet').textContent = Save.data.coins;
    $('result').style.display = 'flex';
    try { parent.postMessage({ type: 'dshGameScore', game: 'racing', score: 101 - p1Place, detail: '第' + p1Place + '名', mode: 'best' }, '*'); } catch (e) {}
  }

  /* ---------------- 商店 ---------------- */
  const UP_IDS = ['engine', 'steer', 'jump', 'lucky'];
  function setupShop() {
    UP_IDS.forEach((up) => {
      $('up-' + up).addEventListener('click', () => {
        if (Save.buy(up)) {
          Sound.init();
          Sound.coin();
          refreshShop();
        } else {
          Sound.init();
          Sound.beep(180, 0.12, 0.2, 'square');
        }
      });
    });
    refreshShop();
  }

  function refreshShop() {
    $('wallet').textContent = Save.data.coins;
    UP_IDS.forEach((up) => {
      const lv = Save.data.ups[up];
      const btn = $('up-' + up);
      $('up-' + up + '-lv').textContent = lv + ' / ' + Save.MAX_LV;
      if (!Save.canUpgrade(up)) {
        $('up-' + up + '-cost').textContent = '已满级';
        btn.classList.add('maxed');
      } else {
        const cost = Save.upgradeCost(up);
        $('up-' + up + '-cost').textContent = cost + '💰';
        btn.classList.toggle('afford', Save.data.coins >= cost);
      }
    });
  }

  /* ---------------- 输入 ---------------- */
  function onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'KeyM') toggleMute();
  }
  function onKeyUp(e) { keys[e.code] = false; }

  // 触屏按键：按住=持续按键，跳=点击触发
  function bindTouch(id, code, action) {
    const el = $(id);
    const down = (e) => {
      e.preventDefault();
      if (code) keys[code] = true;
      if (action === 'jump' && player && player.alive && state === 'playing') player.jump();
    };
    const up = (e) => {
      e.preventDefault();
      if (code) keys[code] = false;
    };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
  }

  function toggleMute() {
    Sound.setMuted(!Sound.isMuted());
    $('btnMute').textContent = Sound.isMuted() ? '🔇' : '🔊';
  }

  /* ---------------- 主循环 ---------------- */
  let lastT = performance.now();
  function loop(t) {
    const dtRaw = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    // 慢动作：世界时间缩放（死亡回放 / 进球回放）
    const slowScale = slowmoT > 0 ? 0.3 : 1;
    const dt = dtRaw * slowScale;
    if (slowmoT > 0) slowmoT -= dtRaw;
    // 慢动作结束 → 重置被暂停的进球
    if (slowmoT <= 0 && pendingGoalBalls.length) {
      for (const b of pendingGoalBalls) {
        b.x = 0; b.z = 0;
        b.vx = (Math.random() - 0.5) * 4;
        b.vz = (Math.random() - 0.5) * 4;
        b.lastToucher = null;
        delete b._goalPause;
        ballSpawnFree(b);
      }
      pendingGoalBalls.length = 0;
      slowmoTarget = null;
    }
    elapsed += dt;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    Grid.update(dt);

    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vx *= (1 - dt * 2); p.vz *= (1 - dt * 2);
      if (p.t >= p.life) particles.splice(i, 1);
    }

    if (state === 'menu') { updateCam(dt); return; }

    if (state === 'countdown') {
      countdownT -= dt;
      const n = Math.ceil(countdownT);
      if (n !== lastBeep && n >= 1 && n <= 3) { lastBeep = n; Sound.countdown(); $('countdown').textContent = String(n); }
      if (countdownT <= 0) {
        state = 'playing';
        const cd = $('countdown');
        cd.textContent = 'GO!';
        cd.style.color = '#7dff8a';
        Sound.go();
        setTimeout(() => { cd.style.display = 'none'; cd.style.color = '#fff'; }, 700);
        collapseTimer = isFast ? 3 : 10;
        collapseInterval = collapseTimer;
        // 提示随机安全区（金色/翠绿瓦片，缩圈到达前永不掉）
        showBanner('🛡 金色安全区（1~3 块）：碾不掉，缩到才崩', 3);
      }
      updateCam(dt);
      return;
    }

    // ---- playing / over ----
    if (state === 'playing') {
      // P1：WASD + 空格(跳) + E(撞) + Shift(手刹)；触屏自动油门
      const up = keys.KeyW || (isTouch ? true : false);
      const down = keys.KeyS;
      const left = keys.KeyA;
      const right = keys.KeyD;
      player.throttle = (up ? 1 : 0) - (down ? 1 : 0);
      // A=左转 D=右转（世界 yaw 增大会让车头在屏幕上向左摆，故左=+1 右=-1）
      player.steer = (left ? 1 : 0) - (right ? 1 : 0);
      player.handbrake = !!(keys.ShiftLeft || keys.ShiftRight);
      const wasAir = player.airborne;
      if (keys.Space) player.jump();
      if (player.airborne && !wasAir) Sound.jump();
      player.dash = !!keys.KeyE;

      // P2（双人）：方向键 + K(跳) + L(撞) + J(手刹)
      if (player2) {
        const p2u = keys.ArrowUp, p2d = keys.ArrowDown, p2l = keys.ArrowLeft, p2r = keys.ArrowRight;
        player2.throttle = (p2u ? 1 : 0) - (p2d ? 1 : 0);
        player2.steer = (p2l ? 1 : 0) - (p2r ? 1 : 0);
        player2.handbrake = !!keys.KeyJ;
        const wasAir2 = player2.airborne;
        if (keys.KeyK) player2.jump();
        if (player2.airborne && !wasAir2) Sound.jump();
        player2.dash = !!keys.KeyL;
      }
    } else {
      player.throttle = 0; player.steer = 0; player.handbrake = false;
      player.dash = false;
      if (player2) { player2.throttle = 0; player2.steer = 0; player2.handbrake = false; player2.dash = false; }
    }

    const gm = { mode, infectedCount, zombieCount, cpRace, checkpoints, goals: mode === 'football' ? goalMids : undefined };
    for (const d of drivers) d.update(dt, Grid, outerRing, cars, coins, mode === 'football' ? balls : undefined, gm);
    for (const c of cars) c.update(dt, Grid);
    // 僵尸车：淘汰的车继续游荡撞人
    for (const c of cars) if (c.zombie) zombieUpdate(c, dt, Grid);
    carCollide(cars);
    // 机关效果（加速带/弹射板/传送门）
    if (gadgets.length && (mode === 'race' || mode === 'infection')) updateGadgets(dt);
    // 头顶气泡计时
    for (const c of cars) {
      if (c.bubble) { c.bubble.t -= dt; if (c.bubble.t <= 0) c.bubble = null; }
    }
    // 感染传播（感染模式）
    if (mode === 'infection') updateInfection();

    // 护盾破裂特效
    for (const c of cars) {
      if (c.shieldBreak) {
        c.shieldBreak = false;
        spark(c.x, c.z, '#5dd6ff', 20);
        Sound.power();
        if (c === player || c === player2) showBanner('🛡 护盾救了你一命！', 1.8);
      }
    }

    // 冲刺音效（P1/P2 刚进入冲刺）
    const dashSfxCar = (c) => {
      if (c.dashT > 0 && !c.userData.dashSfx) { c.userData.dashSfx = true; Sound.dash(); }
      else if (c.dashT <= 0) c.userData.dashSfx = false;
    };
    dashSfxCar(player);
    if (player2) dashSfxCar(player2);

    // 漂移烟尘 + 氮气爆发特效
    for (const c of cars) {
      if (!c.alive && !c.zombie) continue;
      if (c.drifting && Math.random() < 0.35) {
        particles.push({
          x: c.x + (Math.random() - 0.5) * 1.4, z: c.z + (Math.random() - 0.5) * 1.4,
          vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
          t: 0, life: 0.5, r: 0.3 + Math.random() * 0.25, color: 'rgba(190,200,220,0.55)',
        });
      }
      if (c.nitroFlash > 0) {
        if (!c.userData.nitroSfx) {
          c.userData.nitroSfx = true;
          Sound.whoosh();
          spark(c.x, c.z, '#7fe0ff', 14);
          if (c === player || c === player2) showBanner('⚡ 氮气爆发！', 1.2);
        }
      } else c.userData.nitroSfx = false;
    }

    // 冲撞特效：火花 + 音效 + 镜头震动
    for (const c of cars) {
      if (c.hitEvent > 0) {
        const impact = c.hitEvent;
        c.hitEvent = 0;
        spark(c.x, c.z, '#ffd23e', Math.min(14, Math.round(impact * 1.2)));
        const nearP1 = Math.hypot(player.x - c.x, player.z - c.z) < 12;
        const nearP2 = player2 ? Math.hypot(player2.x - c.x, player2.z - c.z) < 12 : false;
        if (c === player || c === player2 || nearP1 || nearP2) Sound.hit();
        if ((c === player || (player2 && c === player2)) && impact > 7) shakeT = 0.3;
      }
    }

    // 淘汰
    for (const c of cars) {
      if (!c.alive && !c.userData.deadFx) {
        c.userData.deadFx = true;
        explode(c.x, c.z, c.color);
        Sound.crash();
        // 撞人计数：被玩家高速撞下去的
        if (c !== player && c !== player2 && c.lastHitBy === player) {
          koCount++;
          showBanner('💥 你撞掉了 ' + c.name + '！', 1.8);
        } else {
          showBanner(c === player ? '💥 你掉下去了！' : (c === player2 ? '💥 P2 掉下去了！' : '💥 ' + c.name + ' 被淘汰'), 2);
        }
        // 弹幕吐槽：临终遗言
        if (c !== player && c !== player2) say(c, pickPhrase(['啊啊啊——', '我不甘心！', '别了兄弟们！']), 2);
        // 死亡慢动作：玩家/近处/被玩家撞掉的 AI 淘汰瞬间特写（足球无死亡）
        if (mode !== 'football' && slowmoT <= 0) {
          const near = Math.hypot(player.x - c.x, player.z - c.z) < 16;
          if (c === player || c === player2 || (c.lastHitBy === player && !player2) || (near && c !== player && c !== player2)) {
            slowmoT = 2.0;
            slowmoTarget = c;
            Sound.whoosh();
          }
        }
        // 僵尸车：淘汰的车变成僵尸继续游荡撞人（足球模式除外，足球没有掉落）
        if (mode !== 'football' && c !== player && c !== player2 && zombieCount < ZOMBIE_MAX) {
          c.zombie = true;
          c.infected = false; // 僵尸不再算感染者
          const zi = Grid.randomSolidAnywhere(Math.max(1, outerRing - 1));
          if (zi >= 0) { const t = Grid.tiles[zi]; c.x = t.x; c.z = t.z; }
          c.y = 0; c.vy = 0; c.grounded = true;
          c.userData.zRepick = 0;
          zombieCount++;
        }
        // 挑战：玩家死亡即失败
        if (challenge && c === player) {
          challengeDone = false;
          endGame();
        }
      }
    }
    aliveCount = cars.filter((c) => c.alive).length;

    if (state === 'playing') {
      // 随机老化（熔岩/异型赛道不需要：路面永不掉）
      if (mode !== 'lava' && !cpRace) {
        decayTimer -= dt;
        if (decayTimer <= 0) { decayTimer = 5; Grid.randomDecay(outerRing); }
      }

      // 金币刷新
      coinSpawnTimer -= dt;
      if (coinSpawnTimer <= 0) {
        coinSpawnTimer = 4;
        const n = Math.min(2, MAX_COINS - coins.length);
        for (let i = 0; i < n; i++) {
          const idx = Grid.randomSolidAnywhere(Math.max(1, outerRing - 1));
          if (idx >= 0) {
            const t = Grid.tiles[idx];
            coins.push({ x: t.x, z: t.z, tileIdx: idx, t: Math.random() * 6 });
          }
        }
      }
      // 金币：格子掉了就消失；任何车碾到都会被吃掉（AI 也抢金币）
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        const tile = Grid.tiles[c.tileIdx];
        if (tile.state === Grid.ST.FALLING || tile.state === Grid.ST.GONE || tile.state === Grid.ST.DEAD) {
          coins.splice(i, 1);
          continue;
        }
        for (const car of cars) {
          if (!car.alive) continue;
          const dx = car.x - c.x, dz = car.z - c.z;
          if (dx * dx + dz * dz < 2.4 * 2.4) {
            const val = car.isPlayer ? Math.round(COIN_VALUE * (car.coinMult || 1)) : COIN_VALUE;
            car.coinCount = (car.coinCount || 0) + val;
            if (car.isPlayer) matchCoins = car.coinCount;
            coins.splice(i, 1);
            spark(c.x, c.z, '#ffd23e', 8);
            if (car.isPlayer || Math.hypot(player.x - c.x, player.z - c.z) < 12) Sound.coin();
            break;
          }
        }
      }
      // 磁铁吸金币：有磁铁的玩家自动吸附近金币
      if (player.magnetT > 0) magnetPull(player, coins);
      if (player2 && player2.magnetT > 0) magnetPull(player2, coins);

      // 道具刷新（每 8 秒一个，最多 3 个）
      itemSpawnTimer -= dt;
      if (itemSpawnTimer <= 0) {
        itemSpawnTimer = 8;
        if (items.length < MAX_ITEMS) {
          const idx = Grid.randomSolidAnywhere(Math.max(1, outerRing - 1));
          if (idx >= 0) {
            const t = Grid.tiles[idx];
            items.push({
              x: t.x, z: t.z, tileIdx: idx, t: Math.random() * 6,
              type: ITEM_TYPES[(Math.random() * ITEM_TYPES.length) | 0],
            });
          }
        }
      }
      // 道具拾取（仅玩家/P2；AI 不拾取）
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const tile = Grid.tiles[it.tileIdx];
        if (tile.state === Grid.ST.FALLING || tile.state === Grid.ST.GONE || tile.state === Grid.ST.DEAD) {
          items.splice(i, 1);
          continue;
        }
        for (const car of [player, player2]) {
          if (!car || !car.alive) continue;
          const dx = car.x - it.x, dz = car.z - it.z;
          if (dx * dx + dz * dz < 2.4 * 2.4) {
            applyItem(car, it.type);
            items.splice(i, 1);
            Sound.power();
            spark(it.x, it.z, '#ffffff', 14);
            break;
          }
        }
      }

      // 足球模式：不缩圈，跑足球物理 + 计时 + 定期补球
      if (mode === 'football') {
        updateBalls(dt);
        for (let i = 0; i < 6; i++) if (goalFlash[i] > 0) goalFlash[i] -= dt;
        footballTimer -= dt;
        ballSpawnTimer -= dt;
        if (ballSpawnTimer <= 0 && balls.length < BALL_MAX) {
          spawnNewBall();
          ballSpawnTimer = BALL_SPAWN_INTERVAL;
        }
        if (footballTimer <= 0) {
          endFootball();
        } else if (aliveCount <= 1) {
          endFootball(); // 只剩一人，提前终场
        }
      } else if (mode === 'lava') {
        // 熔岩模式：不缩圈，靠地板被吃光；限时 120s，时间到金币最多者胜
        lavaTimer -= dt;
        if (aliveCount <= 1) {
          endGame();
        } else if (lavaTimer <= 0) {
          winner = cars.filter((c) => c.alive).reduce((a, b) => ((b.coinCount || 0) > (a.coinCount || 0) ? b : a), cars[0]);
          state = 'over';
          overT = 0;
          resultShown = false;
          showBanner('⏱ 时间到！金币最多者：' + (winner.isPlayer ? '你' : winner.name), 3);
        }
      } else if (cpRace) {
        // 异型赛道竞速赛：不缩圈、不老化，掉出赛道即淘汰；先完成 2 圈者胜
        if (aliveCount <= 1) endGame();
        if (state === 'playing') updateCpRace();
      } else {
        // 缩圈：从外到内逐圈崩塌（竞速/感染）；随机安全区所在圈被缩到时同样掉落
        collapseTimer -= dt;
        if (collapseTimer <= 0 && outerRing >= 0) {
          Grid.killRing(outerRing);
          Sound.alarm();
          showBanner(outerRing > 0 ? '⚠ 缩圈！最外层掉落' : '⚠ 最终崩塌！', 2.5);
          outerRing -= 1;
          collapseInterval = Math.max(4, 4 + Math.max(0, outerRing) * 0.7);
          if (isFast) collapseInterval = Math.min(collapseInterval, 4);
          collapseTimer = collapseInterval;
        }

        if (aliveCount <= 1) endGame();

        // 挑战达成判定
        if (challenge && player.alive) {
          if (challenge.type === 'survive' && elapsed >= challenge.target) challengeWin();
          else if (challenge.type === 'coin' && matchCoins >= challenge.target) challengeWin();
          else if (challenge.type === 'ram' && koCount >= challenge.target) challengeWin();
        }
      }
    }

    if (state === 'over') {
      overT += dt;
      if (overT > 1.2 && !resultShown) showResult();
    }

    // 引擎音效
    if (state === 'playing' && player.alive) {
      Sound.updateEngine(player.speed() / player.maxSpeed, player.throttle);
    }

    updateCam(dt);
    updateHUD(dt);
  }

  function explode(x, z, color) {
    spark(x, z, color, 22);
  }

  function spark(x, z, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      particles.push({
        x, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
        t: 0, life: 0.6 + Math.random() * 0.6,
        r: 0.25 + Math.random() * 0.35, color,
      });
    }
  }

  // 磁铁：把附近金币吸过来
  function magnetPull(car, coinList) {
    for (let i = coinList.length - 1; i >= 0; i--) {
      const c = coinList[i];
      const dx = c.x - car.x, dz = c.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 12 * 12) {
        const d = Math.sqrt(d2) || 1;
        c.x -= (dx / d) * 12 * 0.06;
        c.z -= (dz / d) * 12 * 0.06;
        if (d2 < 2.4 * 2.4) {
          const val = car.isPlayer ? Math.round(COIN_VALUE * (car.coinMult || 1)) : COIN_VALUE;
          car.coinCount = (car.coinCount || 0) + val;
          if (car.isPlayer) matchCoins = car.coinCount;
          coinList.splice(i, 1);
          Sound.coin();
        }
      }
    }
  }

  // 应用道具效果
  function applyItem(car, type) {
    car.itemFlash = 0.6;
    if (type === 'rocket') {
      car.dashT = 2.5;             // 火箭：2.5 秒冲刺
      car.dashCd = 0;
      car.vx += Math.sin(car.yaw) * 6;
      car.vz += Math.cos(car.yaw) * 6;
    } else if (type === 'shield') {
      car.shieldT = 5;
    } else if (type === 'magnet') {
      car.magnetT = 6;
    } else if (type === 'missile') {
      // 锁定最近的敌方车
      let best = null, bestD = 1e9;
      for (const o of cars) {
        if (o === car || !o.alive || o.cloakT > 0) continue;
        const dx = o.x - car.x, dz = o.z - car.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { best = o; bestD = d; }
      }
      if (best) {
        car.missileTarget = best;
        car.missileT = 0.7;
      }
    } else if (type === 'cloak') {
      car.cloakT = 5;
    }
  }

  /* ---------------- 相机 ---------------- */
  function updateCam(dt) {
    const k = 1 - Math.exp(-4 * dt);
    // 慢动作回放：镜头锁定在目标（死亡的车 / 进球的球）
    if (slowmoT > 0 && slowmoTarget) {
      camX += (slowmoTarget.x - camX) * k;
      camZ += (slowmoTarget.z - camZ) * k;
      camZoom += (13 - camZoom) * k * 0.8;
      camRot += (0 - camRot) * k * 0.6;
      return;
    }
    if (state === 'menu') {
      const tz0 = 6.8;
      camX += (0 - camX) * k;
      camZ += (0 - camZ) * k;
      camZoom += (tz0 - camZoom) * k * 0.6;
      camRot += (0 - camRot) * k;
      return;
    }
    // 双人：跟随两车中点，两人都保持在画面内（北朝上）
    if (is2P && player2) {
      const ZM = miniMode ? 14 : 9;
      const a = player.alive ? player : null;
      const b = player2.alive ? player2 : null;
      if (a && b) {
        const tx = (a.x + b.x) / 2, tz = (a.z + b.z) / 2;
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        camX += (tx - camX) * k;
        camZ += (tz - camZ) * k;
        camZoom += (Math.max(4.2, Math.min(ZM, ZM - dist * 0.1)) - camZoom) * k * 0.6;
        camRot += (0 - camRot) * k;
      } else {
        const s = a || b;
        if (s) {
          camX += (s.x - camX) * k;
          camZ += (s.z - camZ) * k;
          camZoom += ((miniMode ? 13 : 8) - camZoom) * k * 0.6;
        }
        camRot += (0 - camRot) * k;
      }
    } else {
      // 观战模式：玩家阵亡时跟随其他车（每 5 秒切换目标）
      const playerAlive = player && player.alive;
      const p2Alive = player2 && player2.alive;
      if (!playerAlive && (!is2P || !p2Alive) && state === 'playing') {
        const alive = cars.filter((c) => c.alive && c !== player && (is2P ? c !== player2 : true));
        if (!alive.length) { // 只剩玩家自己没死（不该发生）或全灭
          camZoom += ((miniMode ? 12 : 7) - camZoom) * k * 0.6;
          camRot += (0 - camRot) * k;
        } else {
          spectateTimer -= dt;
          if (spectateTimer <= 0 || !spectateTarget || !spectateTarget.alive) {
            spectateTimer = 5;
            spectateIndex = (spectateIndex + 1) % alive.length;
            spectateTarget = alive[spectateIndex];
          }
          const t = spectateTarget;
          camX += (t.x - camX) * k;
          camZ += (t.z - camZ) * k;
          camZoom += ((miniMode ? 14 : 9) - camZoom) * k * 0.6;
          const targetRot = Math.PI - t.yaw;
          let diff = targetRot - camRot;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          camRot += diff * (1 - Math.exp(-5 * dt));
        }
      } else {
        const follow = playerAlive;
        const tx = follow ? player.x : 0;
        const tz = follow ? player.z : 0;
        const tZoom = follow ? (miniMode ? 14 : 9) : (miniMode ? 12 : 7);
        camX += (tx - camX) * k;
        camZ += (tz - camZ) * k;
        camZoom += (tZoom - camZoom) * k * 0.6;
        // 相机旋转：跟随玩家车头，让车永远朝屏幕上方（观战时回正北朝上）
        const targetRot = follow ? (Math.PI - player.yaw) : 0;
        let diff = targetRot - camRot;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        camRot += diff * (1 - Math.exp(-5 * dt));
      }
    }
    // 受击镜头震动
    if (shakeT > 0) {
      shakeT -= dt;
      const s = shakeT * 0.6;
      camX += (Math.random() - 0.5) * s;
      camZ += (Math.random() - 0.5) * s;
    }
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    // 昼夜：开局大白天，随时间渐变到夜晚再转回来（周期约 120 秒）
    const day = 0.5 + 0.5 * Math.sin(elapsed * 0.052 + Math.PI / 2);
    const view = { W, H, cx: W / 2, cy: H / 2, camX, camZ, zoom: camZoom, rot: camRot, time: elapsed, grid: Grid, day };
    Draw.background(ctx, view);
    Draw.platformBase(ctx, view);

    // 瓦片裁剪（按屏幕对角线放宽，兼容相机旋转）
    const margin = Grid.HEX_R * 3;
    const half = Math.hypot(W, H) / 2 / camZoom + margin;
    const x0 = camX - half, x1 = camX + half, z0 = camZ - half, z1 = camZ + half;
    for (const t of Grid.tiles) {
      if (t.x < x0 || t.x > x1 || t.z < z0 || t.z > z1) continue;
      Draw.tile(ctx, t, view, elapsed);
    }
    Draw.ringEdge(ctx, outerRing, view, elapsed, state === 'playing' ? collapseTimer : 99);

    // 足球模式：6 个球门 + 足球
    if (mode === 'football') {
      const GOAL_COLORS = ['#ff5d5d', '#ff9a3d', '#ffe14d', '#6bd96b', '#4dd0e1', '#c06bff'];
      for (let e = 0; e < 6; e++) {
        Draw.goal(ctx, e, GOAL_COLORS[e], goalFlash[e], view, elapsed);
      }
    }
    // 机关（加速带/弹射板/传送门）
    if (gadgets.length) for (const g of gadgets) Draw.gadget(ctx, g, view, elapsed);
    // 检查点（竞速赛）：下一个高亮
    if (checkpoints.length) {
      for (let i = 0; i < checkpoints.length; i++) {
        const isNext = player && i === (player.cpNext % checkpoints.length);
        Draw.checkpoint(ctx, checkpoints[i], isNext, view, elapsed);
      }
    }
    for (const c of coins) Draw.coin(ctx, c.x, c.z, view, elapsed, c.t);
    for (const it of items) Draw.item(ctx, it.x, it.z, view, elapsed, it.type, it.t);
    for (const c of cars) if (c.alive || c.zombie) Draw.car(ctx, c, view, elapsed);
    if (mode === 'football') for (const b of balls) Draw.ball(ctx, b, view, elapsed);
    Draw.particles(ctx, particles, view);
  }

  /* ---------------- HUD / 小地图 ---------------- */
  function showBanner(text, dur) {
    const b = $('banner');
    b.textContent = text;
    b.style.display = 'block';
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.style.display = 'none'; }, (dur || 2) * 1000);
  }

  function updateHUD(dt) {
    $('alive').textContent = aliveCount + ' / ' + cars.length;
    // 小窗模式：迷你状态条（存活 / 金币 / 模式信息 / 氮气）
    if (miniMode && state !== 'menu') {
      let line = '🏁 ' + aliveCount + '/' + cars.length + ' · 💰' + matchCoins;
      if (mode === 'football') line = '⚽ ' + Math.max(0, Math.ceil(footballTimer)) + 's · 你' + (player.goals || 0) + '球';
      else if (mode === 'infection') {
        const un = cars.filter((c) => c.alive && !c.infected && !c.zombie).length;
        line = '☠ 感染' + infectedCount + ' · 幸存' + un;
      } else if (mode === 'lava') line = '🔥 剩瓦' + Grid.solidCount() + ' · 💰' + matchCoins;
      else if (cpRace) line = '🏁 圈' + Math.min(player.laps + 1, CP_LAPS) + '/' + CP_LAPS + ' · 检' + (player.cpNext % Math.max(1, checkpoints.length)) + '/' + checkpoints.length;
      if (player.nitro > 0.02) line += ' · ⚡' + Math.round(player.nitro * 100) + '%';
      if (!player.alive) line += ' · 👁观战';
      $('miniHud').textContent = line;
    }
    // 特殊模式行：足球/感染/熔岩 复用 ftRow（隐藏缩圈条）
    const ftRow = $('ftRow');
    if (mode === 'football') {
      $('ringRow').style.display = 'none';
      $('ringBar').style.display = 'none';
      $('ringTimeRow').style.display = 'none';
      ftRow.style.display = 'flex';
      $('ftTimer').textContent = '⏱ ' + Math.max(0, Math.ceil(footballTimer)) + 's · ⚽x' + balls.length;
      // 领先者
      let lead = cars[0], leadG = 0;
      for (const c of cars) if ((c.goals || 0) > leadG) { lead = c; leadG = c.goals || 0; }
      $('ftLead').textContent = (lead.isPlayer ? '你' : lead.name) + ' ' + leadG + '球';
      $('ftMy').textContent = player2
        ? 'P1 ' + (player.goals || 0) + '球 · P2 ' + (player2.goals || 0) + '球'
        : (player.goals || 0) + '球';
    } else if (mode === 'infection') {
      $('ringRow').style.display = 'flex';
      $('ringBar').style.display = 'block';
      $('ringTimeRow').style.display = 'flex';
      ftRow.style.display = 'flex';
      $('ftTimer').textContent = '☠ 感染者 ' + infectedCount + ' · 僵尸 ' + zombieCount;
      const un = cars.filter((c) => c.alive && !c.infected && !c.zombie).length;
      $('ftLead').textContent = '😇 幸存 ' + un;
      $('ftMy').textContent = player.infected ? '你：被感染' : '你：安全';
      $('ringNum').textContent = outerRing >= 0 ? outerRing : 0;
      const frac = state === 'countdown' ? 1 : Math.max(0, Math.min(1, collapseTimer / collapseInterval));
      $('ringBarFill').style.width = (frac * 100).toFixed(1) + '%';
      $('ringTime').textContent = state === 'countdown' ? '--' : collapseTimer.toFixed(1) + 's';
    } else if (mode === 'lava') {
      $('ringRow').style.display = 'none';
      $('ringBar').style.display = 'none';
      $('ringTimeRow').style.display = 'none';
      ftRow.style.display = 'flex';
      const remain = Grid.solidCount();
      $('ftTimer').textContent = '🔥 剩瓦 ' + remain;
      $('ftLead').textContent = '⏱ ' + Math.max(0, Math.ceil(lavaTimer)) + 's';
      $('ftMy').textContent = '你 ' + (player.coinCount || 0) + '💰';
    } else if (cpRace) {
      // 竞速赛：圈数 + 检查点（赛道固定，无缩圈条）
      $('ringRow').style.display = 'none';
      $('ringBar').style.display = 'none';
      $('ringTimeRow').style.display = 'none';
      ftRow.style.display = 'flex';
      $('ftTimer').textContent = '🏁 圈 ' + Math.min(player.laps + 1, CP_LAPS) + ' / ' + CP_LAPS;
      $('ftLead').textContent = '检查点 ' + (player.cpNext % Math.max(1, checkpoints.length)) + ' / ' + checkpoints.length;
      let lead = cars[0];
      for (const c of cars) {
        if ((c.laps || 0) > (lead.laps || 0) || ((c.laps || 0) === (lead.laps || 0) && (c.cpNext || 0) > (lead.cpNext || 0))) lead = c;
      }
      $('ftMy').textContent = '领先 ' + (lead.isPlayer ? '你' : lead.name) + ' ' + (lead.laps || 0) + '圈';
    } else {
      ftRow.style.display = 'none';
      $('ringRow').style.display = 'flex';
      $('ringBar').style.display = 'block';
      $('ringTimeRow').style.display = 'flex';
      $('ringNum').textContent = outerRing >= 0 ? outerRing : 0;
      const frac = state === 'countdown' ? 1 : Math.max(0, Math.min(1, collapseTimer / collapseInterval));
      $('ringBarFill').style.width = (frac * 100).toFixed(1) + '%';
      $('ringTime').textContent = state === 'countdown' ? '--' : collapseTimer.toFixed(1) + 's';
    }
    $('coinCount').textContent = matchCoins;

    // 挑战目标 HUD
    const objRow = $('objRow');
    if (challenge) {
      objRow.style.display = 'flex';
      $('objLabel').textContent = '🎯 ' + challenge.name + '：' + challenge.desc;
      let v = '';
      if (challenge.type === 'survive') v = '⏱ 剩余 ' + Math.max(0, Math.ceil(challenge.target - elapsed)) + 's';
      else if (challenge.type === 'coin') v = '💰 ' + matchCoins + ' / ' + challenge.target;
      else if (challenge.type === 'ram') v = '💥 ' + koCount + ' / ' + challenge.target;
      else v = '🏆 冲向第一！';
      $('objVal').textContent = v;
    } else {
      objRow.style.display = 'none';
    }

    // 道具状态栏（玩家当前生效的道具 + 剩余时间）
    const itemRow = $('itemRow');
    const ic = player;
    const parts = [];
    if (ic.shieldT > 0) parts.push('🛡' + ic.shieldT.toFixed(1) + 's');
    if (ic.dashT > 1) parts.push('⚡' + ic.dashT.toFixed(1) + 's');
    if (ic.magnetT > 0) parts.push('🧲' + ic.magnetT.toFixed(1) + 's');
    if (ic.cloakT > 0) parts.push('👻' + ic.cloakT.toFixed(1) + 's');
    if (ic.missileT > 0) parts.push('🚀锁定');
    if (ic.nitro > 0.02) parts.push('🔥氮气' + Math.round(ic.nitro * 100) + '%');
    if (parts.length) {
      itemRow.style.display = 'flex';
      $('itemVal').textContent = parts.join(' ');
    } else {
      itemRow.style.display = 'none';
    }

    // 观战提示
    const sp = $('spectateLabel');
    if (state === 'playing' && !player.alive) {
      sp.style.display = 'block';
      sp.textContent = '👁 观战中：' + (spectateTarget ? spectateTarget.name : '…');
    } else {
      sp.style.display = 'none';
    }

    minimapDirty -= dt;
    if (minimapDirty <= 0) { minimapDirty = 0.12; drawMinimap(); }
  }

  /* ---------------- 自定义地图编辑器 ---------------- */
  function openEditor() {
    $('menu').style.display = 'none';
    $('editor').style.display = 'flex';
    editRing = Save.data.customMap.ringMax;
    Grid.build({ ringMax: editRing, holes: 'custom', holeList: Save.data.customMap.holes });
    // 尺寸按钮高亮
    [6, 8, 10, 12, 14].forEach((n) => $('ed-size-' + n).classList.toggle('sel', editRing === n));
    drawEditor();
  }

  function drawEditor() {
    const cv2 = $('editCanvas');
    const c2 = cv2.getContext('2d');
    const S = cv2.width / 2;
    c2.fillStyle = '#0b1120';
    c2.fillRect(0, 0, cv2.width, cv2.height);
    const R = (Grid.RING_MAX + 0.5) * Grid.SPACING * Math.sqrt(3);
    const zoom = S / R;
    const view = { W: cv2.width, H: cv2.height, cx: S, cy: S, camX: 0, camZ: 0, zoom, rot: 0, time: 0, grid: Grid };
    Draw.platformBase(c2, view);
    for (const t of Grid.tiles) Draw.tile(c2, t, view, 0);
    c2.strokeStyle = 'rgba(255,255,255,0.4)';
    c2.lineWidth = 2;
    c2.strokeRect(1, 1, cv2.width - 2, cv2.height - 2);
  }

  function editorClick(e) {
    const cv2 = $('editCanvas');
    const rect = cv2.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const S = cv2.width / 2;
    const R = (Grid.RING_MAX + 0.5) * Grid.SPACING * Math.sqrt(3);
    const zoom = S / R;
    const wx = (x - S) / zoom, wz = (y - S) / zoom;
    const idx = Grid.idxAt(wx, wz);
    if (idx < 0) return;
    const t = Grid.tiles[idx];
    if (t.state === Grid.ST.DEAD) { t.state = Grid.ST.SOLID; t.scale = 1; t.perm = false; }
    else { t.state = Grid.ST.DEAD; t.scale = 0; t.perm = true; }
    drawEditor();
  }

  function editorSize(n) {
    editRing = n;
    // 重建网格并保留范围内的已有空洞
    const old = new Set(Grid.tiles.filter((t) => t.state === Grid.ST.DEAD).map((t) => t.q + ',' + t.r));
    Grid.build({ ringMax: n, holes: 'custom', holeList: [...old].map((k) => k.split(',').map(Number)) });
    [6, 8, 10, 12, 14].forEach((m) => $('ed-size-' + m).classList.toggle('sel', editRing === m));
    drawEditor();
  }

  function saveEditor() {
    const holes = Grid.tiles.filter((t) => t.state === Grid.ST.DEAD).map((t) => [t.q, t.r]);
    Save.saveCustomMap(Grid.RING_MAX, holes);
    Save.setPref('map', 'custom');
    $('editor').style.display = 'none';
    $('menu').style.display = 'flex';
    refreshMenuTabs();
  }

  function closeEditor() {
    $('editor').style.display = 'none';
    $('menu').style.display = 'flex';
  }

  function drawMinimap() {
    const cv2 = $('minimap');
    const c2 = cv2.getContext('2d');
    const S = cv2.width / 2;
    const scale = 0.8; // px / world unit（平台半径 ~90，需容纳最外圈）
    c2.clearRect(0, 0, cv2.width, cv2.height);
    const size = 3.2;
    for (let i = 0; i < Grid.tiles.length; i++) {
      const t = Grid.tiles[i];
      if (t.state === Grid.ST.DEAD) continue;
      const x = S + t.x * scale, y = S + t.z * scale;
      if (t.safe) c2.fillStyle = '#7bd88f';
      else if (t.state === Grid.ST.SOLID) c2.fillStyle = 'rgba(150,168,196,0.9)';
      else if (t.state === Grid.ST.WARN) c2.fillStyle = '#ff8a3d';
      else if (t.state === Grid.ST.GROWING) c2.fillStyle = 'rgba(196,212,236,0.9)';
      else continue;
      c2.fillRect(x - size / 2, y - size / 2, size, size);
    }
    for (const c of cars) {
      if (!c.alive && !c.zombie) continue;
      const x = S + c.x * scale, y = S + c.z * scale;
      c2.beginPath();
      c2.arc(x, y, c.isPlayer ? 5 : 3.6, 0, Math.PI * 2);
      if (c.zombie) c2.fillStyle = '#7a7f6a';
      else if (c.infected) c2.fillStyle = '#c44dff';
      else c2.fillStyle = c.color;
      c2.fill();
      if (c.isPlayer) { c2.strokeStyle = c.isP2 ? '#ffd23e' : '#ffffff'; c2.lineWidth = 1.8; c2.stroke(); }
      else if (c.infected) { c2.strokeStyle = '#ff5d8f'; c2.lineWidth = 1.2; c2.stroke(); }
    }
    // 机关：加速带=蓝 弹射板/弹簧=黄 传送门=紫 地雷=红 加速门=青
    for (const g of gadgets) {
      c2.beginPath();
      c2.arc(S + g.x * scale, S + g.z * scale, 2.4, 0, Math.PI * 2);
      c2.fillStyle = g.type === 'boost' ? '#3d9bff' : (g.type === 'jump' || g.type === 'spring' ? '#ffb13d'
        : (g.type === 'mine' ? '#ff3d2e' : (g.type === 'gate' ? '#3df0ff' : '#a05bff')));
      c2.fill();
    }
    // 检查点（竞速赛）：金色圆点，下一个高亮
    if (checkpoints.length) {
      for (let i = 0; i < checkpoints.length; i++) {
        const cp = checkpoints[i];
        const isNext = (player && i === (player.cpNext % checkpoints.length));
        c2.beginPath();
        c2.arc(S + cp.x * scale, S + cp.z * scale, isNext ? 3.6 : 2.6, 0, Math.PI * 2);
        c2.fillStyle = '#ffd23e';
        c2.fill();
        if (isNext) { c2.strokeStyle = '#ffffff'; c2.lineWidth = 1.2; c2.stroke(); }
      }
    }
    // 足球：白色圆点（多球都显示）
    for (const b of balls) {
      c2.beginPath();
      c2.arc(S + b.x * scale, S + b.z * scale, 3.2, 0, Math.PI * 2);
      c2.fillStyle = '#ffffff';
      c2.fill();
    }
    c2.strokeStyle = 'rgba(255,255,255,0.35)';
    c2.lineWidth = 2;
    c2.strokeRect(2, 2, cv2.width - 4, cv2.height - 4);
  }

  return { init };
})();

window.addEventListener('DOMContentLoaded', () => Game.init());

// 调试：把运行错误写入标题，方便无头环境探测
window.addEventListener('error', (e) => {
  document.title = 'ERR: ' + String(e.message).slice(0, 120);
});

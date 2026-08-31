'use strict';
/* ============================================================
   火柴人龙之战 · Stickman Dragon Battle
   动作格斗:移动/连击/格挡/冲刺/蓄力/气技能/龙之变身
   模式:故事 / 对战 3v3 / 锦标赛 16队 / 双人本地 / 局域网联机 / 无尽 / 训练场
   桌面键盘 + 移动触屏(局域网联机需配合 server.js)

   文件结构导航:
   [1] 工具函数 / 颜色 / 音频 / 输入(双人键位映射)
   [2] 英雄 / 敌人 / 章节 / 难度 数据
   [3] 粒子系统(12+ 类型)与特效组合(带联机事件收集)
   [4] 弹幕 Proj
   [5] Fighter 战斗者(状态机/技能/绘制/姿态动画)
   [6] Battle 战斗场景(相机/判定/特效/CG 演出)
   [7] 全局状态 / 存档 / 经济 / 成就 / 每日任务 / 装备
   [8] 模式流程:故事 / 对战 / 锦标赛 / 双人 / 无尽 / 训练场 / 局域网联机
   [9] UI 界面:菜单 / 章节全览 / 英雄选择 / 强化 / 商店 / 成就 / 每日 / 联机
   [10] 主循环与 SDB 测试钩子
   ============================================================ */
const W = 960, H = 540, GROUND_Y = 470;
const $ = id => document.getElementById(id);

/* ---------------- 工具 ---------------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const TAU = Math.PI * 2;
/* 颜色工具:变亮/变暗 / 混合 */
function shade(hex, amt) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { const k = 1 + amt; r *= k; g *= k; b *= k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function mixC(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = (((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t) | 0;
  const g = (((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t) | 0;
  const bl = ((pa & 255) * (1 - t) + (pb & 255) * t) | 0;
  return `rgb(${r},${g},${bl})`;
}

/* ---------------- 音频 ---------------- */
let actx = null, muted = false, musicTimer = null;
function initAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
}
function tone(f0, f1, dur, type, vol, delay) {
  if (!actx || muted) return;
  const t = actx.currentTime + (delay || 0);
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol || 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.03);
}
function noiseBurst(dur, vol, delay) {
  if (!actx || muted) return;
  const t = actx.currentTime + (delay || 0);
  const n = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(); src.buffer = buf;
  const g = actx.createGain(); g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(g); g.connect(actx.destination); src.start(t);
}
const SFX = {
  hit: () => tone(190, 90, .09, 'square', .22),
  crit: () => { tone(320, 120, .14, 'sawtooth', .3); tone(520, 200, .1, 'square', .15); },
  block: () => tone(760, 520, .06, 'triangle', .18),
  dash: () => noiseBurst(.16, .15),
  charge: () => tone(180, 520, .25, 'sine', .1),
  chargeFull: () => tone(420, 900, .22, 'sawtooth', .2),
  shoot: () => tone(720, 220, .12, 'square', .14),
  skill: () => tone(380, 940, .22, 'sawtooth', .18),
  nova: () => { tone(120, 60, .35, 'sawtooth', .28); noiseBurst(.3, .2); },
  transform: () => { tone(180, 1300, .55, 'sawtooth', .24); tone(260, 1600, .6, 'square', .14, .12); noiseBurst(.5, .22); },
  ko: () => tone(420, 55, .5, 'sawtooth', .28),
  wave: () => tone(160, 70, .28, 'triangle', .2),
  ui: () => tone(620, 830, .06, 'square', .1),
  victory: () => { tone(523, 523, .14, 'square', .2, 0); tone(659, 659, .14, 'square', .2, .14); tone(784, 784, .32, 'square', .22, .28); },
  defeat: () => { tone(300, 190, .26, 'sawtooth', .2, 0); tone(215, 130, .42, 'sawtooth', .2, .26); },
};
function startMusic() {
  stopMusic();
  if (!actx || muted) return;
  const scale = [220, 262, 294, 330, 392, 440];
  musicTimer = setInterval(() => {
    if (muted || !actx) return;
    const f = scale[randi(0, scale.length - 1)];
    tone(f, f, .3, 'sine', .028);
  }, 430);
}
function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

/* ---------------- 输入 ---------------- */
const keys = {};
/* 键位映射:P1 用 WASD 区,P2 用方向键为核心的紧凑键盘键位(60%-65% 键盘无需小键盘) */
const KEYMAPS = [
  { moveL: 'KeyA', moveR: 'KeyD', attack: 'Space', block: 'KeyB', dash: 'KeyF', charge: 'KeyZ', q: 'KeyQ', w: 'KeyW', r: 'KeyR', transform: 'KeyS' },
  { moveL: 'ArrowLeft', moveR: 'ArrowRight', attack: 'Period', block: 'Comma', dash: 'ArrowDown', charge: 'ArrowUp', q: 'Semicolon', w: 'Quote', r: 'Slash', transform: 'Enter' },
];
function mkInput() {
  return {
    move: 0,
    attack: false, dash: false, q: false, w: false, r: false, transform: false,
    blockHeld: false, chargeHeld: false,
    _clear() { this.attack = this.dash = this.q = this.w = this.r = this.transform = false; },
  };
}
const inputP1 = mkInput();
const inputP2 = mkInput();
const inputs = [inputP1, inputP2];
const touch = {
  joyOn: false, joyId: -1, joyDX: 0, joyOX: 0, joyOY: 0,
  block: false, charge: false,
};
function kd(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; /* 输入框(联机地址等)内不拦截按键 */
  if (e.code === 'Space' || e.code.startsWith('Arrow') || (e.code === 'Enter' && currentBattle)) e.preventDefault();
  keys[e.code] = true;
  for (let p = 0; p < KEYMAPS.length; p++) {
    const m = KEYMAPS[p], inp = inputs[p];
    if (e.code === m.attack) inp.attack = true;
    else if (e.code === m.dash) inp.dash = true;
    else if (e.code === m.q) inp.q = true;
    else if (e.code === m.w) inp.w = true;
    else if (e.code === m.r) inp.r = true;
    else if (e.code === m.transform) inp.transform = true;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
}
function ku(e) { keys[e.code] = false; }
function kbHeld(code) { return !!keys[code]; }
function readInput() {
  const joy = touch.joyOn ? touch.joyDX : 0;
  /* 触屏输入路由:联机从机控制 P2(方向键位),其余情况控制 P1 */
  const tP = (net && net.role === 'client') ? 1 : 0;
  for (let p = 0; p < KEYMAPS.length; p++) {
    const m = KEYMAPS[p], inp = inputs[p];
    inp.move = clamp((kbHeld(m.moveL) ? -1 : 0) + (kbHeld(m.moveR) ? 1 : 0) + (p === tP ? joy : 0), -1, 1);
    inp.blockHeld = kbHeld(m.block) || (p === tP && touch.block);
    inp.chargeHeld = kbHeld(m.charge) || (p === tP && touch.charge);
  }
}

/* ---------------- 数据:英雄 ---------------- */
const HEROES = [
  {
    id: 'sword', name: '龙剑士', title: '均衡之龙', emoji: '🗡️', color: '#ffd34d',
    hp: 150, speed: 232, dmg: 13, range: 88, atkT: 0.42, weapon: 'sword', ranged: false,
    style: { hair: 'goldSpiky', cape: '#d63a2a' },
    desc: '攻守兼备的剑术大师。烈焰斩撕裂一切,龙卷风暴横扫千军!',
    skills: [
      { key: 'Q', name: '烈焰斩', cost: 25, cd: 1.2, type: 'wave', dmg: 30, speed: 540, desc: '斩出炽热的剑气,穿透敌人' },
      { key: 'W', name: '龙卷风暴', cost: 45, cd: 4, type: 'spin', dmg: 13, ticks: 6, desc: '如旋风般连续斩击周围敌人' },
      { key: 'R', name: '巨龙突袭', cost: 70, cd: 6, type: 'dash', dmg: 56, dist: 360, desc: '化作巨龙冲撞前方,势不可挡' },
    ],
  },
  {
    id: 'mage', name: '烈焰法师', title: '烈焰之龙', emoji: '🔥', color: '#ff8a45',
    hp: 112, speed: 216, dmg: 11, range: 400, atkT: 0.5, weapon: 'staff', ranged: true,
    style: { hair: 'flame', scarf: '#ffb02a' },
    desc: '远程毁灭者。火球连发、烈焰风暴、天降陨石,让敌人化为灰烬!',
    skills: [
      { key: 'Q', name: '火球术', cost: 20, cd: 1.0, type: 'bolt', dmg: 18, count: 3, speed: 620, desc: '朝敌人连射三枚火球' },
      { key: 'W', name: '烈焰风暴', cost: 45, cd: 4, type: 'nova', dmg: 26, radius: 190, desc: '灼烧周围所有敌人' },
      { key: 'R', name: '天降陨石', cost: 70, cd: 7, type: 'meteor', dmg: 72, radius: 150, desc: '召唤陨石轰击敌人!', },
    ],
  },
  {
    id: 'assassin', name: '冰霜刺客', title: '寒冰之龙', emoji: '❄️', color: '#7ad7ff',
    hp: 122, speed: 262, dmg: 12, range: 82, atkT: 0.34, weapon: 'daggers', ranged: false,
    style: { mask: true, hood: true, scarf: '#5ad4ff' },
    desc: '迅捷如风的暗影杀手。冰霜让敌人寸步难行,影袭连杀防不胜防!',
    skills: [
      { key: 'Q', name: '冰锥散射', cost: 25, cd: 1.5, type: 'shard', dmg: 14, count: 3, speed: 600, desc: '扇形射出冰锥并减速敌人' },
      { key: 'W', name: '冰霜新星', cost: 40, cd: 4, type: 'nova', dmg: 20, radius: 180, slow: 0.5, desc: '冻结周围敌人的行动' },
      { key: 'R', name: '影袭连杀', cost: 65, cd: 6, type: 'backstab', dmg: 21, hits: 4, desc: '闪至敌后连续刺杀' },
    ],
  },
  {
    id: 'warrior', name: '雷霆战士', title: '雷霆之龙', emoji: '⚡', color: '#ffd94d',
    hp: 185, speed: 218, dmg: 15, range: 96, atkT: 0.46, weapon: 'hammer', ranged: false,
    style: { helm: true, cape: '#3a4a8a' },
    desc: '身披重甲的雷霆之力。雷神护盾护体,万雷天罚审判一切!',
    skills: [
      { key: 'Q', name: '雷霆冲击', cost: 25, cd: 1.5, type: 'bolt', dmg: 22, count: 1, speed: 700, desc: '掷出贯穿敌人的闪电' },
      { key: 'W', name: '雷神护盾', cost: 45, cd: 5, type: 'shield', dmg: 10, dur: 3.5, desc: '雷盾环绕,电击近身之敌' },
      { key: 'R', name: '万雷天罚', cost: 70, cd: 7, type: 'lightning', dmg: 55, strikes: 3, desc: '召唤天雷三连击!', },
    ],
  },
  {
    id: 'light', name: '圣光骑士', title: '圣光之龙', emoji: '✨', color: '#ffe9a8',
    hp: 168, speed: 216, dmg: 13, range: 92, atkT: 0.45, weapon: 'sword', ranged: false,
    style: { hair: 'gold', cape: '#f0e8d0' },
    desc: '沐浴圣光的守护骑士。光环庇护队友,神圣审判净化一切!',
    skills: [
      { key: 'Q', name: '圣光斩', cost: 25, cd: 1.2, type: 'wave', dmg: 30, speed: 580, desc: '斩出圣洁的金色剑气' },
      { key: 'W', name: '守护光环', cost: 45, cd: 5, type: 'aura', dmg: 4, dur: 4, desc: '光环庇护:自身减伤并持续治疗附近队友' },
      { key: 'R', name: '神圣审判', cost: 70, cd: 7, type: 'holy', dmg: 72, radius: 140, desc: '召唤圣光天罚,净化大片区域!', },
    ],
  },
  {
    id: 'hunter', name: '暗影猎手', title: '暗影之龙', emoji: '🏹', color: '#b08aff',
    hp: 118, speed: 252, dmg: 12, range: 360, atkT: 0.4, weapon: 'bow', ranged: true,
    style: { mask: true, hood: true, scarf: '#b06aff' },
    desc: '游走于暗影的远程猎手。飞刀致命,死亡标记无所遁形!',
    skills: [
      { key: 'Q', name: '三连飞刀', cost: 25, cd: 1.5, type: 'shard', dmg: 14, count: 3, speed: 620, desc: '扇形掷出三柄剧毒飞刀' },
      { key: 'W', name: '暗影疾行', cost: 40, cd: 4, type: 'backstab', dmg: 18, hits: 4, desc: '闪至敌后,暗影连击' },
      { key: 'R', name: '死亡标记', cost: 65, cd: 6, type: 'mark', dmg: 42, dur: 4, desc: '标记猎物:期间受击增伤,结束爆发', },
    ],
  },
];

/* ---------------- 数据:敌人 ---------------- */
const ENEMIES = {
  grunt: { id: 'grunt', name: '暗影小兵', emoji: '👺', hp: 55, speed: 190, dmg: 8, range: 72, atkT: 0.55, weapon: 'fist', color: '#9a9ab0', ai: 'melee', style: { hood: true } },
  archer: { id: 'archer', name: '暗影弓手', emoji: '🏹', hp: 45, speed: 205, dmg: 8, range: 420, atkT: 0.55, weapon: 'bow', color: '#8a9a6a', ai: 'ranged', ranged: true, style: { hood: true } },
  tank: { id: 'tank', name: '暗影重甲', emoji: '🛡️', hp: 155, speed: 132, dmg: 12, range: 82, atkT: 0.55, weapon: 'sword', color: '#7a7a8a', ai: 'tank', armor: 0.35, style: { helm: true, shield: true } },
  mage: { id: 'mage', name: '暗影法师', emoji: '🧙', hp: 55, speed: 172, dmg: 11, range: 390, atkT: 0.55, weapon: 'staff', color: '#8a5ab0', ai: 'ranged', ranged: true, style: { hood: true } },
  elite: { id: 'elite', name: '暗影精英', emoji: '💀', hp: 230, speed: 196, dmg: 16, range: 88, atkT: 0.5, weapon: 'sword', color: '#c04a4a', ai: 'melee', armor: 0.2, style: { helm: true, hood: true } },
  dummy: { id: 'dummy', name: '训练木桩', emoji: '🎯', hp: 99999, speed: 0, dmg: 0, range: 1, atkT: 99, weapon: 'fist', color: '#9a7a4a', ai: 'dummy', style: {} },
};
function makeBoss(idx) {
  return {
    id: 'boss', name: '暗影巨龙', emoji: '🐉', hp: 620 + idx * 130, speed: 158, dmg: 20, range: 115, atkT: 0.55,
    weapon: 'dragon', color: '#c04040', ai: 'boss', armor: 0.22, boss: true, scale: 1.65,
    style: { boss: true },
    skills: [
      { key: 'A1', name: '烈焰吐息', cost: 0, cd: 1, type: 'volley', dmg: 14, count: 3, speed: 420 },
      { key: 'A2', name: '震地重击', cost: 0, cd: 1, type: 'slam', dmg: 22, radius: 175 },
      { key: 'A3', name: '巨龙冲撞', cost: 0, cd: 1, type: 'dash', dmg: 30, dist: 420 },
      { key: 'A4', name: '末日火雨', cost: 0, cd: 1, type: 'firestorm', dmg: 18, count: 4 },
      { key: 'A5', name: '狂暴冲撞', cost: 0, cd: 1, type: 'furyDash', dmg: 34, dist: 540 },
    ],
  };
}
/* 英雄查找辅助 */
function heroById(id) { return HEROES.find(h => h.id === id); }

/* 章节主题图标与配色 */
const THEME_EMOJI = { forest: '🌲', volcano: '🌋', frost: '❄️', castle: '🏰', arena: '⚔️', tour: '🏆' };
function themeColor(theme) {
  const c = { forest: '#4a9a5a', volcano: '#c06030', frost: '#4a8ab8', castle: '#7a5ab8', arena: '#b09050', tour: '#8a7ad0' }[theme];
  return c || '#ffd94d';
}
/* 难度配置:敌人强度系数 × 金币系数 */
const DIFFICULTIES = [
  { name: '普通', icon: '🟢', hp: 1, dmg: 1, gold: 1 },
  { name: '困难', icon: '🟠', hp: 1.35, dmg: 1.18, gold: 1.5 },
  { name: '噩梦', icon: '🔴', hp: 1.75, dmg: 1.35, gold: 2 },
];

/* ---------------- 数据:章节 ---------------- */
const CHAPTERS = [
  {
    name: '第一章 · 暗影森林', theme: 'forest', intro: [
      '古老的预言提到,暗影正从森林深处蔓延……',
      '你,最后的龙之传承者,握紧了手中的武器。',
      '踏上征途,寻找黑暗的源头!',
    ],
    waves: [['grunt'], ['grunt', 'grunt'], ['archer', 'grunt', 'grunt'], ['tank', 'archer']],
    boss: true, outro: [
      '森林恢复了平静,但黑暗远未结束……',
      '远处的火山,发出低沉的轰鸣。',
    ],
  },
  {
    name: '第二章 · 烈焰山丘', theme: 'volcano', intro: [
      '火山之下,火焰军团正在集结……',
      '熔岩的炽热灼烧着大地。',
      '击败它们,夺回山丘!',
    ],
    waves: [['grunt', 'grunt'], ['mage', 'grunt', 'grunt'], ['tank', 'mage', 'archer'], ['elite']],
    boss: true, outro: [
      '烈焰熄灭了,真相逐渐浮现……',
      '黑暗的源头,指向北方的冰霜峡谷。',
    ],
  },
  {
    name: '第三章 · 冰霜峡谷', theme: 'frost', intro: [
      '刺骨的寒风吹过峡谷……',
      '冰霜军团封锁了通往城堡的道路。',
      '以龙之力,粉碎寒冰!',
    ],
    waves: [['grunt', 'archer', 'mage'], ['tank', 'tank'], ['elite', 'mage', 'archer'], ['tank', 'elite', 'mage']],
    boss: true, outro: [
      '峡谷的冰墙崩塌了。',
      '黑暗城堡,就在眼前……',
    ],
  },
  {
    name: '第四章 · 黑暗城堡', theme: 'castle', intro: [
      '城堡之上,乌云翻滚。',
      '暗影巨龙正等待着你的到来。',
      '这是最后一战!',
    ],
    waves: [['elite', 'grunt', 'grunt'], ['tank', 'elite', 'mage'], ['elite', 'elite', 'archer', 'mage']],
    boss: true, outro: [
      '黑暗被驱散了!',
      '你成为了真正的龙之英雄!',
      '世界的和平,由你守护!',
    ],
  },
];
const TEAM_NAMES = ['龙之队', '烈焰军团', '冰霜之牙', '雷霆部落', '暗影行者', '钢铁要塞', '疾风游侠', '星辰守卫', '熔岩之心', '寒霜骑士', '风暴之眼', '暗夜猎手', '铁拳兄弟会', '月光教团', '炽天使团', '深渊支配者'];

/* ---------------- 画布 ---------------- */
const cv = $('cv'), ctx = cv.getContext('2d');
let arenaW = 1400;
let camX = 0, shakeT = 0, shakeM = 0;

/* ---------------- 粒子 / 飘字 ---------------- */
const parts = [], floats = [], telegraphs = [];
function spawnPart(o) {
  if (parts.length > 1000) parts.shift();
  parts.push({
    x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, life: o.life || 0.5, max: o.life || 0.5,
    size: o.size || 3, color: o.color || '#fff', type: o.type || 'dot', grav: o.grav || 0,
    rot: o.rot || 0, spin: o.spin || 0, sway: o.sway || 0, drag: o.drag || 0, flicker: !!o.flicker,
  });
}
function burst(x, y, n, color, speed, type, life) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(speed * 0.3, speed);
    spawnPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.3, color, type: type || 'dot', life: life || rand(0.3, 0.6), grav: type === 'dot' ? 500 : 0, size: rand(2, 5) });
  }
}
/* ---- 特效组合 ---- */
function hitSpark(x, y, dir, color, big) {
  const n = big ? 11 : 6;
  for (let i = 0; i < n; i++) {
    const a = dir + rand(-1.0, 1.0);
    const sp = rand(120, big ? 400 : 260);
    spawnPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: rand(0.18, 0.4), size: big ? rand(2.5, 4) : rand(1.5, 3), color, type: 'spark', grav: 700 });
  }
  netFx({ t: 'hit', x, y, dir, color, crit: !!big });
}
function flashAt(x, y, color, size) {
  spawnPart({ x, y, life: 0.18, size: size || 12, color: color || '#fff', type: 'flash' });
}
function ringAt(x, y, color, size, life) {
  spawnPart({ x, y, life: life || 0.35, size: size || 60, color, type: 'ring' });
  netFx({ t: 'ring', x, y, color, r: size || 60 });
}
function iceBurst(x, y, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(80, 260);
    spawnPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.3, 0.6), size: rand(2, 4), color: ['#bfeaff', '#8ad7ff', '#e8f8ff', '#5ab8ff'][randi(0, 3)], type: 'ice', grav: 500, rot: Math.random() * TAU, spin: rand(-8, 8) });
  }
  netFx({ t: 'ice', x, y });
}
function fireBoom(x, y, scale) {
  flashAt(x, y, '#fff8d0', 16 * scale);
  ringAt(x, y, '#ff9a2a', 70 * scale, 0.4);
  ringAt(x, y, '#ffd94d', 42 * scale, 0.3);
  for (let i = 0; i < 14 * scale; i++) {
    const a = Math.random() * TAU, sp = rand(60, 320 * scale);
    spawnPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: rand(0.25, 0.55), size: rand(2, 5), color: Math.random() < 0.5 ? '#ff8a2a' : '#ffd94d', type: 'ember', grav: 300 });
  }
  for (let i = 0; i < 8 * scale; i++) {
    spawnPart({ x, y, vx: rand(-60, 60), vy: rand(-90, -20), life: rand(0.5, 1.1), size: rand(6, 12), color: 'rgba(80,60,50,.5)', type: 'smoke', grav: -60 });
  }
  netFx({ t: 'boom', x, y, scale });
}
function boltAt(x, y, color, n) {
  for (let i = 0; i < (n || 1); i++) {
    spawnPart({ x: x + rand(-22, 22), y: y + rand(-22, 22), vx: rand(-140, 140), vy: rand(-140, 140), life: 0.16, size: rand(18, 30), color: color || '#ffe86a', type: 'bolt' });
  }
}
function starBurst(x, y, n, colors) {
  const cs = colors || ['#ffd94d', '#fff3c4'];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rand(40, 190);
    spawnPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: rand(0.4, 0.9), size: rand(2, 4), color: cs[randi(0, cs.length - 1)], type: 'star', grav: 60, rot: Math.random() * TAU, spin: rand(-6, 6) });
  }
  netFx({ t: 'star', x, y });
}
function addFloat(x, y, text, color, size) {
  floats.push({ x, y, text, color: color || '#fff', size: size || 16, life: 0.9, max: 0.9, vy: -60 });
  netFx({ t: 'float', x, y, text, color: color || '#fff', size: size || 16 });
}
function addTelegraph(x, y, t, r, color) {
  telegraphs.push({ x, y, t, dur: t, r, color: color || '#ff4a4a' });
  netFx({ t: 'tele', x, y, dur: t, r, color: color || '#ff4a4a' });
}
/* 局域网联机:事件收集(主机广播给从机;带上限防结算期无限累积) */
function netFx(ev) {
  if (!currentBattle) return;
  const q = currentBattle.netFx;
  if (q.length > 400) q.shift();
  q.push(ev);
}
/* 全局特效更新(主机 Battle 与联机从机共用) */
function globalFxTick(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.grav * dt;
    if (p.drag) { const d = Math.pow(1 - p.drag, dt * 60); p.vx *= d; p.vy *= d; }
    p.rot += p.spin * dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
  for (let i = floats.length - 1; i >= 0; i--) {
    const ft = floats[i];
    ft.life -= dt; ft.y += ft.vy * dt; ft.vy *= 0.92;
    if (ft.life <= 0) floats.splice(i, 1);
  }
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    telegraphs[i].t -= dt;
    if (telegraphs[i].t <= 0) telegraphs.splice(i, 1);
  }
}


/* ---------------- 弹幕 ---------------- */
const projs = [];
class Proj {
  constructor(o) {
    this.x = o.x; this.y = o.y; this.vx = o.vx; this.vy = o.vy;
    this.r = o.r || 8; this.dmg = o.dmg; this.team = o.team; this.owner = o.owner;
    this.kind = o.kind || 'fireball'; this.life = o.life || 2.5; this.grav = o.grav || 0;
    this.pierce = o.pierce || 0; this.spin = o.spin || 0; this.rot = Math.atan2(this.vy, this.vx);
  }
  update(dt, battle) {
    this.life -= dt; this.vy += this.grav * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rot += this.spin * dt;
    const trail = Math.random() < dt * 46;
    if (trail) {
      const c = this.kind === 'ice' ? '#8ad7ff' : this.kind === 'arrow' ? '#cfc8b0' : this.kind === 'wave' ? this.ownerHeroColor() : this.kind === 'bolt' ? '#ffe86a' : '#ff8a3a';
      spawnPart({ x: this.x, y: this.y, vx: -this.vx * 0.12, vy: -this.vy * 0.12, life: 0.28, size: this.r * 0.9, color: c, type: 'trail', drag: 0.3 });
      if (this.kind === 'fireball' && Math.random() < 0.5) {
        spawnPart({ x: this.x, y: this.y, vx: rand(-15, 15), vy: rand(-30, -5), life: rand(0.2, 0.4), size: rand(1.5, 3), color: '#ff8a2a', type: 'ember', flicker: true });
      }
    }
    if (this.y > GROUND_Y - 4) {
      if (this.kind === 'meteor') {
        battle.aoe(this.x, GROUND_Y - 20, this.r * 6, this.dmg, this.owner, { kb: 16, shake: 1.2 });
        fireBoom(this.x, GROUND_Y - 16, 1.4);
        starBurst(this.x, GROUND_Y - 16, 8, ['#ff9a2a', '#ffd94d', '#fff3c4']);
      } else if (this.kind === 'fireball') {
        burst(this.x, this.y - 4, 5, '#ff8a2a', 140, 'dot', 0.3);
      } else if (this.kind === 'ice') {
        iceBurst(this.x, this.y - 4, 4);
      }
      this.life = 0;
    }
    if (this.x < -60 || this.x > arenaW + 60) this.life = 0;
    for (const f of battle.fighters) {
      if (f.team === this.team || f.koT > 0) continue;
      if (f.invulnT > 0) continue;
      const dx = Math.abs(f.x - this.x);
      const dy = Math.abs((f.y - 55) - this.y);
      if (dx < this.r + 16 * f.scale && dy < 62 * f.scale) {
        battle.dealHit(this.owner, f, this.dmg, { kb: this.kind === 'arrow' ? 2 : 5, dir: Math.sign(this.vx) || 1, slow: this.kind === 'ice' ? 0.45 : 0 });
        if (this.pierce > 0) this.pierce--;
        else { this.life = 0; break; }
      }
    }
  }
  ownerHeroColor() {
    const h = this.owner && this.owner.hero;
    return h ? h.color : '#ffd34d';
  }
  draw() {
    ctx.save();
    ctx.translate(this.x - camX, this.y);
    if (this.kind === 'arrow') {
      ctx.rotate(this.rot);
      ctx.strokeStyle = '#e8e0c8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#c0b8a0'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(4, -4); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill();
    } else if (this.kind === 'wave') {
      ctx.rotate(this.rot);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      g.addColorStop(0, '#fff8d8'); g.addColorStop(0.4, this.ownerHeroColor()); g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 26, -0.9, 0.9); ctx.arc(0, 0, 6, 0.9, -0.9, true); ctx.closePath(); ctx.fill();
    } else if (this.kind === 'ice') {
      ctx.rotate(this.rot);
      ctx.fillStyle = '#bfeaff';
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -6); ctx.lineTo(-3, 0); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5ab8ff'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (this.kind === 'shard') {
      /* 暗影猎手飞刀:紫色旋转飞刃 */
      ctx.rotate(this.rot);
      ctx.fillStyle = '#b08aff';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -5); ctx.lineTo(-4, 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#6a3ad0'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#e8dcff';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(8, -2.5); ctx.lineTo(8, 2.5); ctx.closePath(); ctx.fill();
    } else if (this.kind === 'bolt') {
      ctx.fillStyle = '#fff8c0';
      ctx.beginPath(); ctx.arc(0, 0, this.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffe86a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, this.r * 0.6, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffe86a';
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + this.rot;
        ctx.beginPath(); ctx.arc(Math.cos(a) * this.r * 1.7, Math.sin(a) * this.r * 1.7, 2.5, 0, TAU); ctx.fill();
      }
    } else if (this.kind === 'meteor') {
      const g = ctx.createRadialGradient(0, -8, 2, 0, 0, this.r);
      g.addColorStop(0, '#fff0c0'); g.addColorStop(0.5, '#ff8a2a'); g.addColorStop(1, '#c03a10');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -8, this.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,140,40,.5)';
      ctx.beginPath(); ctx.arc(0, -8, this.r * 1.5, 0, TAU); ctx.fill();
    } else {
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, this.r * 2.2);
      g.addColorStop(0, '#fff8e0');
      g.addColorStop(0.35, this.kind === 'ice' ? '#8ad7ff' : '#ffb45a');
      g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, this.r * 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = this.kind === 'ice' ? '#d8f2ff' : '#fff';
      ctx.beginPath(); ctx.arc(0, 0, this.r * 0.8, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

/* ---------------- 战斗者 ---------------- */
class Fighter {
  constructor(hero, team, opts) {
    this.hero = hero; this.team = team;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || hero.name;
    this.def = opts.def || null;
    this.boss = !!(this.def && this.def.boss);
    this.scale = (this.def && this.def.scale) || 1;
    this.maxHp = Math.round((opts.hpMult || 1) * hero.hp);
    this.hp = this.maxHp;
    this.qi = opts.qi || 0;
    this.x = opts.x || (team === 0 ? 180 : arenaW - 180);
    this.y = GROUND_Y;
    this.vel = { x: 0 };
    this.facing = team === 0 ? 1 : -1;
    this.state = 'idle'; this.stateT = 0; this.t = 0;
    this.walkPhase = 0;
    this.invulnT = 0; this.dashCd = 0; this.slowT = 0; this.shieldT = 0;
    this.attackN = 0; this.hitApplied = false; this.hitSet = new Set(); this.comboBuf = false;
    this.chargeP = 0; this.aiMove = 0; this.blockHold = 0; this.aiT = 0;
    this.skillCds = {}; this.sk = null;
    this.skillList = (hero.skills || []).slice();
    for (const s of this.skillList) this.skillCds[s.key] = 0;
    this.transformT = 0; this.transforming = false; this.maxTransformT = 10;
    this.koT = 0; this.kills = 0; this.dmgDealt = 0; this.dmgTaken = 0;
    this.bossTimer = 1.2; this.bossCycle = 0;
    this.enemy = team === 1;
    this.style = hero.style || {};
    this.trails = [];
    this.hitFlash = 0;
    this.koFall = 0;
    this.playerIdx = opts.playerIdx || 0;
    this.pvp = !!opts.pvp;
    /* 守护光环 / 死亡标记 / 装备属性 */
    this.auraT = 0; this.auraTickT = 0;
    this.markT = 0; this.markOwner = null;
    this.critBonus = 0; this.lifesteal = 0; this.slowOnHit = 0; this.gearArmor = 0;
    this.rageOn = false;
  }
  get alive() { return this.hp > 0 && this.koT <= 0; }
  transformMul() { return this.transforming ? 1.5 : 1; }

  update(dt, battle) {
    this.t += dt; this.stateT += dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      this.shieldTickT = (this.shieldTickT || 0) - dt;
      if (this.shieldTickT <= 0) {
        this.shieldTickT = 0.5;
        const sk = this.skillList.find(s => s.type === 'shield');
        if (sk) battle.aoe(this.x, this.y - 40, 110, sk.dmg, this, { kb: 3, elec: true });
      }
    }
    /* 守护光环:持续治疗自己与附近队友 */
    if (this.auraT > 0) {
      this.auraT -= dt;
      this.auraTickT -= dt;
      if (this.auraTickT <= 0) {
        this.auraTickT = 0.5;
        this.hp = Math.min(this.maxHp, this.hp + 4);
        addFloat(this.x, this.y - 120, '+4', '#7dffa8', 11);
        for (const f of battle.fighters) {
          if (f === this || f.team !== this.team || f.koT > 0) continue;
          if (Math.abs(f.x - this.x) < 200) {
            f.hp = Math.min(f.maxHp, f.hp + 4);
            addFloat(f.x, f.y - 120, '+4', '#7dffa8', 11);
          }
        }
        spawnPart({ x: this.x, y: this.y - 60, life: 0.4, size: 46, color: '#ffe9a8', type: 'ring' });
      }
    }
    /* 死亡标记:倒计时结束爆发 */
    if (this.markT > 0) {
      this.markT -= dt;
      if (this.markT <= 0 && this.alive) {
        const sk = this.skillList && this.skillList.find(s => s.type === 'mark');
        if (sk && this.markOwner) battle.dealHit(this.markOwner, this, sk.dmg, { kb: 6 });
        this.markOwner = null;
      }
    }
    for (const k in this.skillCds) if (this.skillCds[k] > 0) this.skillCds[k] -= dt;
    if (this.transformT > 0) {
      this.transformT -= dt;
      this.hp = Math.min(this.maxHp, this.hp + 5 * dt);
      if (this.transformT <= 0) this.endTransform();
    }
    if (!this.transforming && this.state !== 'ko') this.qi = Math.min(100, this.qi + 0.8 * dt);
    /* 龙形态 aura 粒子 */
    if ((this.transforming || this.boss) && Math.random() < dt * 16) {
      spawnPart({ x: this.x + rand(-30, 30) * this.scale, y: this.y + rand(-110, -20) * this.scale, vx: rand(-12, 12), vy: rand(-40, -10), life: rand(0.4, 0.8), size: rand(2, 4) * this.scale, color: this.boss ? '#ff5a5a' : '#ffd94d', type: 'dot' });
    }
    if (this.state === 'charge' && Math.random() < dt * 26) {
      spawnPart({ x: this.x + rand(-16, 16), y: this.y - rand(20, 80), vx: rand(-20, 20), vy: rand(-30, 10), life: 0.3, size: rand(2, 4), color: '#ffd94d', type: 'dot' });
    }
    /* 受击闪白 */
    if (this.hitFlash > 0) this.hitFlash -= dt;
    /* 倒地动画计时 */
    if (this.koFall > 0) this.koFall -= dt;
    /* 残影(冲刺 / 变身移动) */
    if ((this.state === 'dash' || (this.transforming && Math.abs(this.vel.x) > 60)) && Math.random() < dt * 40) {
      this.trails.push({ x: this.x, y: this.y, facing: this.facing, scale: this.scale, life: 0.3 });
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].life -= dt * 1.6;
      if (this.trails[i].life <= 0) this.trails.splice(i, 1);
    }
    /* KO */
    if (this.koT > 0) {
      this.koT -= dt;
      this.vel.x *= 0.9;
      return;
    }
    if (this.state === 'hit') {
      this.vel.x *= Math.pow(0.002, dt);
      if (this.stateT > 0.16) this.state = 'idle';
    } else if (this.state === 'blockbroken') {
      if (this.stateT > 0.85) this.state = 'idle';
    } else if (this.state === 'transform') {
      if (this.stateT > 0.9) { this.transforming = true; this.state = 'idle'; SFX.transform(); }
    }
    /* 输入 / AI */
    if (this.isPlayer) {
      this.act(battle, battle.playerInputs[this.playerIdx]);
    } else {
      this.aiThink(dt, battle);
    }
    /* 状态行为 */
    switch (this.state) {
      case 'idle': case 'run': this.behIdleRun(dt, battle); break;
      case 'attack': this.behAttack(dt, battle); break;
      case 'block': this.behBlock(dt, battle); break;
      case 'dash': this.behDash(dt); break;
      case 'charge': this.behCharge(dt, battle); break;
      case 'skill': this.behSkill(dt, battle); break;
    }
    /* 物理 */
    this.x += this.vel.x * dt;
    this.x = clamp(this.x, 34 * this.scale, arenaW - 34 * this.scale);
    this.vel.x *= Math.pow(0.002, dt);
    if (Math.abs(this.vel.x) > 12) this.facing = Math.sign(this.vel.x);
  }

  act(battle, inp) {
    if (!inp) return;
    const st = this.state;
    if (st === 'attack' || st === 'skill') {
      if (inp.attack && st === 'attack' && !this.comboBuf) this.comboBuf = true;
      /* 技能/变身可取消攻击(格斗游戏手感:连招中无缝接技能) */
      if (st === 'attack') {
        if (inp.q) this.useSkillByKey('Q', battle);
        else if (inp.w) this.useSkillByKey('W', battle);
        else if (inp.r) this.useSkillByKey('R', battle);
        else if (inp.transform) this.startTransform();
      }
      return;
    }
    if (st === 'block') {
      if (inp.attack) { this.startAttack(0, battle); return; }
      if (inp.dash) { this.startDash(); return; }
      return;
    }
    if (st === 'dash' || st === 'charge' || st === 'transform' || st === 'hit' || st === 'blockbroken') return;
    if (inp.attack) this.startAttack(0, battle);
    else if (inp.blockHeld) { this.state = 'block'; this.blockHold = 0; }
    else if (inp.dash) this.startDash();
    else if (inp.chargeHeld) this.startCharge();
    else {
      if (inp.q) this.useSkillByKey('Q', battle);
      else if (inp.w) this.useSkillByKey('W', battle);
      else if (inp.r) this.useSkillByKey('R', battle);
      else if (inp.transform) this.startTransform();
    }
  }

  aiThink(dt, battle) {
    this.aiT -= dt;
    if (this.aiT > 0) return;
    this.aiT = 0.17 + Math.random() * 0.13;
    /* 训练木桩:站着不动 */
    if (this.def && this.def.ai === 'dummy') { this.aiMove = 0; return; }
    if (this.state !== 'idle' && this.state !== 'run') { this.aiMove = 0; return; }
    const foes = battle.aliveOf(1 - this.team);
    if (!foes.length) { this.aiMove = 0; return; }
    let t = null, bd = 1e9;
    for (const f of foes) { const d = Math.abs(f.x - this.x); if (d < bd) { bd = d; t = f; } }
    const dir = Math.sign(t.x - this.x);
    if (this.boss) { this.bossThink(battle, t, bd, dir); return; }
    const r = Math.random();
    let threat = false;
    for (const f of foes) {
      if ((f.state === 'attack' || f.state === 'skill') && f.stateT < 0.3 &&
        Math.abs(f.x - this.x) < (f.hero.range + 80) && f.facing === Math.sign(this.x - f.x)) threat = true;
    }
    if (threat && r < (this.def && this.def.ai === 'tank' ? 0.4 : 0.22)) { this.state = 'block'; this.blockHold = 0.4 + Math.random() * 0.3; this.aiMove = 0; return; }
    const ranged = !!this.hero.ranged;
    const inMelee = bd < this.hero.range * 0.92;
    const avail = this.skillList.filter(s => this.qi >= s.cost && this.skillCds[s.key] <= 0);
    if (ranged) {
      if (bd < 250) {
        this.aiMove = -dir;
        if (Math.random() < 0.15 && this.dashCd <= 0) this.startDash(-dir);
      } else if (bd < this.hero.range * 0.95) {
        if (r < 0.42) this.startAttack(0, battle);
        else if (avail.length && r < 0.64) this.useSkill(avail[randi(0, avail.length - 1)], battle);
        else if (r < 0.72 && this.dashCd <= 0) this.startDash(-dir);
        else this.aiMove = 0;
      } else { this.aiMove = dir; }
    } else {
      if (inMelee) {
        if (r < 0.5) this.startAttack(0, battle);
        else if (avail.length && r < 0.68) this.useSkill(avail[randi(0, avail.length - 1)], battle);
        else if (r < 0.78 && this.dashCd <= 0) this.startDash(dir);
        else if (r < 0.86 && this.def && this.def.ai === 'tank') this.startCharge();
        else this.aiMove = Math.random() < 0.5 ? dir : 0;
      } else if (bd < 1000) this.aiMove = dir;
      else this.aiMove = 0;
    }
  }

  bossThink(battle, t, bd, dir) {
    /* 狂暴阶段:血量低于 50% */
    const rage = this.hp / this.maxHp < 0.5;
    if (rage && !this.rageOn) {
      this.rageOn = true;
      battle.announce('⚠️ 暗影巨龙 狂暴了!');
      SFX.transform();
      ringAt(this.x, this.y - 60, '#ff2a2a', 130, 0.6);
      flashAt(this.x, this.y - 60, '#ff2a2a', 26);
      for (let i = 0; i < 34; i++) {
        spawnPart({ x: this.x + rand(-60, 60), y: this.y - rand(0, 130), vx: rand(-90, 90), vy: rand(-240, -40), life: rand(0.5, 1.1), size: rand(2, 5), color: Math.random() < 0.5 ? '#ff5a2a' : '#ff2a2a', type: 'ember', grav: -80 });
      }
      for (let i = 0; i < 10; i++) {
        spawnPart({ x: this.x + rand(-50, 50), y: this.y - 10, vx: rand(-30, 30), vy: rand(-60, -20), life: rand(0.6, 1.2), size: rand(8, 14), color: 'rgba(120,40,30,.5)', type: 'smoke', grav: -70 });
      }
    }
    this.bossTimer -= this.aiT * (rage ? 1.7 : 1);
    if (this.bossTimer > 0) {
      if (bd > this.hero.range * 0.8) this.aiMove = dir; else this.aiMove = 0;
      if (bd < this.hero.range * 0.85 && Math.random() < (rage ? 0.5 : 0.3)) this.startAttack(0, battle);
      return;
    }
    /* 狂暴阶段:末日火雨 + 狂暴冲撞 混入招式表,出手更快 */
    const acts = rage ? ['A4', 'A1', 'A5', 'A2', 'A4'] : ['A1', 'A2', 'A3'];
    const act = acts[this.bossCycle % acts.length];
    this.bossCycle++;
    this.bossTimer = rage ? 1.3 + Math.random() * 0.6 : 2.1 + Math.random() * 0.9;
    const sk = this.skillList.find(s => s.key === act);
    if (sk) this.useSkill(sk, battle);
  }

  /* ---------- 行为 ---------- */
  behIdleRun(dt, battle) {
    let mv = 0;
    if (this.isPlayer) mv = battle.playerInputs[this.playerIdx] ? battle.playerInputs[this.playerIdx].move : 0;
    else mv = this.aiMove;
    const sp = this.hero.speed * (this.transforming ? 1.3 : 1) * (this.slowT > 0 ? 0.5 : 1);
    this.vel.x = mv * sp;
    if (mv !== 0) { if (this.state === 'idle') this.state = 'run'; this.walkPhase += dt * (5 + this.hero.speed / 42); }
    else if (this.state === 'run') this.state = 'idle';
    /* 奔跑脚步尘土 */
    if (this.state === 'run' && Math.random() < dt * 20) {
      spawnPart({ x: this.x - this.facing * 12, y: this.y - 2, vx: -this.facing * rand(20, 70), vy: rand(-46, -12), life: rand(0.22, 0.45), size: rand(2, 4), color: 'rgba(165,145,115,.4)', type: 'dot', grav: -40 });
    }
  }
  behBlock(dt, battle) {
    if (this.isPlayer) {
      const inp = battle.playerInputs[this.playerIdx];
      if (!inp.blockHeld || inp.dash) { this.state = 'idle'; if (inp.dash) this.startDash(); return; }
    } else {
      this.blockHold -= dt;
      if (this.blockHold <= 0) { this.state = 'idle'; return; }
    }
    /* 格挡时可缓慢移动(玩家用移动键,AI 用 aiMove) */
    const mv = this.isPlayer ? (battle.playerInputs[this.playerIdx] ? battle.playerInputs[this.playerIdx].move : 0) : this.aiMove;
    this.vel.x = mv * this.hero.speed * 0.35;
    this.walkPhase += dt * 4;
  }
  behDash(dt) {
    if (this.stateT >= 0.22) { this.state = 'idle'; return; }
    const sp = (this.hero.speed * 3.1) * (this.transforming ? 1.25 : 1);
    this.vel.x = this.facing * sp;
    if (Math.random() < dt * 60) {
      /* 风线 + 流光拖尾 */
      spawnPart({ x: this.x - this.facing * 14, y: this.y - rand(20, 90), vx: -this.facing * 320, vy: rand(-15, 15), life: 0.22, size: rand(4, 7), color: 'rgba(150,200,255,.6)', type: 'trail' });
      spawnPart({ x: this.x - this.facing * 10, y: this.y - rand(20, 90), vx: -this.facing * rand(60, 160), vy: rand(-20, 20), life: 0.3, size: rand(3, 6), color: 'rgba(150,200,255,.8)', type: 'dot' });
    }
    if (this.stateT > 0.05 && Math.random() < dt * 30) {
      spawnPart({ x: this.x - this.facing * 30, y: this.y - 4, vx: -this.facing * rand(30, 80), vy: rand(-50, -10), life: 0.4, size: rand(3, 6), color: 'rgba(180,170,150,.4)', type: 'smoke', grav: -50 });
    }
  }
  behCharge(dt, battle) {
    this.chargeP = Math.min(1, this.chargeP + dt * 0.95);
    if (this.isPlayer) {
      const inp = battle.playerInputs[this.playerIdx];
      if (inp && !inp.chargeHeld) { this.releaseCharge(); return; }
    } else {
      this.chargeHold -= dt;
      if (this.chargeHold <= 0) { this.releaseCharge(); return; }
    }
    this.vel.x = 0;
    /* 能量向角色汇聚 */
    if (Math.random() < dt * 22) {
      const a = Math.random() * TAU;
      const r0 = rand(32, 64);
      spawnPart({ x: this.x + Math.cos(a) * r0, y: this.y - 60 + Math.sin(a) * r0 * 0.55, vx: -Math.cos(a) * 170, vy: -Math.sin(a) * 110, life: 0.28, size: rand(1.5, 3), color: '#ffd94d', type: 'dot', flicker: true });
    }
    if (this.chargeP >= 0.99 && Math.random() < dt * 14) {
      flashAt(this.x + rand(-20, 20), this.y - rand(30, 90), '#fff3c4', 8);
    }
  }
  behAttack(dt, battle) {
    const at = this.hero.atkT, wp = 0.1, ac = 0.12;
    if (this.stateT >= wp && this.stateT < wp + ac && !this.hitApplied) {
      this.hitApplied = true;
      this.resolveMelee(battle);
    }
    if (this.stateT >= at) {
      if (this.comboBuf && this.attackN < 2) {
        this.attackN++; this.stateT = 0; this.hitApplied = false; this.hitSet = new Set(); this.comboBuf = false;
        SFX.ui();
      } else { this.attackN = 0; this.state = 'idle'; }
    }
  }
  behSkill(dt, battle) {
    const S = this.sk; if (!S) { this.state = 'idle'; return; }
    S.t = this.stateT;
    const T = S.def.type, t = S.t;
    const fire = (time, fn) => { const k = 'f' + time; if (t >= time && !S.fired[k]) { S.fired[k] = true; fn(); } };
    switch (T) {
      case 'wave':
        fire(0.22, () => {
          const sk = S.def;
          battle.addProj({ x: this.x + this.facing * 40, y: this.y - 62, vx: this.facing * sk.speed, vy: 0, r: 14, dmg: sk.dmg, team: this.team, owner: this, kind: 'wave', pierce: 1, spin: 6 });
          SFX.wave();
        });
        if (t > 0.62) this.endSkill();
        break;
      case 'spin': {
        if (t > 0.8) { this.endSkill(); break; }
        const sk = S.def;
        this.vel.x = this.aiMove * this.hero.speed * 0.5;
        const int = 0.8 / sk.ticks;
        for (let i = 0; i < sk.ticks; i++) fire(i * int, () => {
          battle.aoe(this.x, this.y - 50, 118, sk.dmg, this, { kb: 6, ring: false, spark: true });
          burst(this.x, this.y - 60, 6, '#ffd94d', 180, 'dot', 0.3);
        });
        break;
      }
      case 'dash': {
        const sk = S.def;
        if (t > 0.45) { this.endSkill(); break; }
        this.vel.x = this.facing * (sk.dist / 0.4);
        this.invulnT = Math.max(this.invulnT, 0.1);
        if (Math.random() < dt * 70) {
          spawnPart({ x: this.x - this.facing * 20, y: this.y - rand(20, 90), vx: -this.facing * 300, vy: 0, life: 0.25, size: rand(4, 7), color: this.hero.color, type: 'trail' });
        }
        if (t > 0.08) {
          for (const f of battle.aliveOf(1 - this.team)) {
            if (this.hitSet.has(f)) continue;
            if (Math.abs(f.x - this.x) < f.scale * 18 + 30 && Math.sign(f.x - this.x) === this.facing) {
              this.hitSet.add(f);
              battle.dealHit(this, f, sk.dmg, { kb: 14, dir: this.facing });
            }
          }
        }
        break;
      }
      case 'bolt': {
        const sk = S.def;
        const n = sk.count || 1;
        const aim = S.aim;
        for (let i = 0; i < n; i++) fire(0.15 + i * 0.08, () => {
          const a = aim + (i - (n - 1) / 2) * 0.12;
          battle.addProj({ x: this.x + Math.cos(a) * 40, y: this.y - 60, vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed, r: 7, dmg: sk.dmg, team: this.team, owner: this, kind: this.hero.id === 'warrior' ? 'bolt' : 'fireball' });
          SFX.shoot();
        });
        if (t > 0.5 + n * 0.08) this.endSkill();
        break;
      }
      case 'nova': {
        fire(0.3, () => {
          const sk = S.def;
          battle.aoe(this.x, this.y - 50, sk.radius, sk.dmg, this, { kb: 11, shake: 0.8, slow: sk.slow || 0, fire: this.hero.id === 'mage', ice: this.hero.id === 'assassin' });
          SFX.nova();
        });
        if (t > 0.7) this.endSkill();
        break;
      }
      case 'meteor': {
        const sk = S.def, P = S.point;
        fire(0.35, () => addTelegraph(P.x, P.y - 10, 0.8, sk.radius, '#ff7a3a'));
        fire(1.05, () => {
          battle.addProj({ x: P.x, y: P.y - 330, vx: 0, vy: 620, r: 16, dmg: sk.dmg, team: this.team, owner: this, kind: 'meteor', life: 1 });
          SFX.nova();
        });
        if (t > 1.3) this.endSkill();
        break;
      }
      case 'shard': {
        const sk = S.def;
        const aim = S.aim;
        for (let i = 0; i < sk.count; i++) fire(0.2 + i * 0.06, () => {
          const a = aim + (i - (sk.count - 1) / 2) * 0.26;
          battle.addProj({ x: this.x + Math.cos(a) * 34, y: this.y - 58, vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed, r: 6, dmg: sk.dmg, team: this.team, owner: this, kind: this.hero.id === 'hunter' ? 'shard' : 'ice' });
          SFX.shoot();
        });
        if (t > 0.55) this.endSkill();
        break;
      }
      case 'shield':
        if (t > 0.25) this.endSkill();
        break;
      case 'lightning': {
        const sk = S.def;
        const pts = S.points || [];
        if (!pts.length) { this.endSkill(); break; }
        fire(0.3, () => pts.forEach(px => addTelegraph(px, GROUND_Y - 10, 0.42, 80, '#ffe86a')));
        for (let i = 0; i < sk.strikes; i++) fire(0.72 + i * 0.5, () => {
          battle.aoe(pts[i], GROUND_Y - 20, 85, sk.dmg, this, { kb: 9, shake: 0.6, elec: true });
          flashAt(pts[i], GROUND_Y - 20, '#fff8c0', 16);
          SFX.nova();
        });
        if (t > 1.9) this.endSkill();
        break;
      }
      case 'backstab': {
        const sk = S.def;
        fire(0.1, () => {
          const F = S.foe;
          if (F && F.alive) {
            this.x = F.x - F.facing * 34;
            this.facing = F.facing;
            burst(this.x, this.y - 60, 12, '#8ad7ff', 200, 'dot', 0.35);
            SFX.dash();
          }
        });
        const hitT = [0.22, 0.38, 0.54, 0.7];
        for (let i = 0; i < hitT.length; i++) fire(hitT[i], () => {
          const F = S.foe;
          if (F && F.alive && Math.abs(F.x - this.x) < 120) {
            battle.dealHit(this, F, sk.dmg * (i === hitT.length - 1 ? 1.6 : 1), { kb: 3 });
            burst(F.x, F.y - 70, 5, '#bfeaff', 160, 'dot', 0.3);
          }
        });
        if (t > 0.95) this.endSkill();
        break;
      }
      case 'volley': {
        const sk = S.def;
        fire(0.35, () => {
          const aim = S.aim;
          for (let i = 0; i < sk.count; i++) {
            const a = aim + (i - (sk.count - 1) / 2) * 0.32;
            battle.addProj({ x: this.x + this.facing * 60 * this.scale, y: this.y - 80 * this.scale, vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed, r: 10 * this.scale, dmg: sk.dmg, team: this.team, owner: this, kind: 'fireball' });
          }
          SFX.nova();
        });
        if (t > 0.75) this.endSkill();
        break;
      }
      case 'firestorm': {
        /* 狂暴 Boss:末日火雨——目标周围落下多颗陨石(落点预计算,预警与命中一致) */
        const sk = S.def;
        const pts = (S.points || []).map(px => ({ x: px, y: GROUND_Y - 20 }));
        if (!pts.length) { this.endSkill(); break; }
        fire(0.3, () => {
          pts.forEach(P => addTelegraph(P.x, P.y - 10, 1.0, 90, '#ff4a2a'));
          SFX.transform();
        });
        for (let i = 0; i < pts.length; i++) {
          fire(0.9 + i * 0.28, () => {
            battle.addProj({ x: pts[i].x, y: pts[i].y - 340, vx: 0, vy: 640, r: 14, dmg: sk.dmg, team: this.team, owner: this, kind: 'meteor', life: 1 });
            SFX.nova();
          });
        }
        if (t > 1.9) this.endSkill();
        break;
      }
      case 'furyDash': {
        /* 狂暴 Boss:连续两段冲撞 */
        const sk = S.def;
        const dashOnce = () => {
          this.invulnT = Math.max(this.invulnT, 0.1);
          SFX.dash();
        };
        fire(0.1, () => { dashOnce(); });
        if (t > 0.1 && t < 0.35) this.vel.x = this.facing * (sk.dist / 0.25);
        fire(0.5, () => { dashOnce(); });
        if (t > 0.5 && t < 0.75) this.vel.x = this.facing * (sk.dist / 0.25);
        if (t > 0.1 && t < 0.75) {
          if (Math.random() < dt * 60) {
            spawnPart({ x: this.x - this.facing * 24, y: this.y - rand(20, 100), vx: -this.facing * 300, vy: 0, life: 0.25, size: rand(4, 8), color: '#ff5a2a', type: 'trail' });
          }
          for (const f of battle.aliveOf(1 - this.team)) {
            if (this.hitSet.has(f)) continue;
            if (Math.abs(f.x - this.x) < f.scale * 18 + 36 && Math.sign(f.x - this.x) === this.facing) {
              this.hitSet.add(f);
              battle.dealHit(this, f, sk.dmg, { kb: 16, dir: this.facing, shake: 0.7 });
            }
          }
        }
        if (t > 0.85) this.endSkill();
        break;
      }
      case 'slam': {
        const sk = S.def;
        fire(0.4, () => {
          battle.aoe(this.x, this.y - 60, sk.radius, sk.dmg, this, { kb: 16, shake: 1.3, ring: true, fire: true });
          burst(this.x, this.y - 40, 26, '#ff8a3a', 320, 'dot', 0.5);
          SFX.nova();
        });
        if (t > 0.85) this.endSkill();
        break;
      }
      case 'chargeSlash': {
        const cp = S.chargeP || 0;
        if (t > 0.04 && t < 0.22) this.vel.x = this.facing * 430;
        if (t >= 0.05 && !S.fired.hit) {
          S.fired.hit = true;
          const rng = this.hero.range * (1 + 0.55 * cp);
          for (const f of battle.aliveOf(1 - this.team)) {
            const dx = f.x - this.x;
            if (Math.abs(dx) < rng + f.scale * 14 && Math.sign(dx) === this.facing) {
              battle.dealHit(this, f, S.def.dmg, { kb: 12 + 9 * cp, dir: this.facing, breakBlock: S.def.breakBlock, shake: 0.6 });
            }
          }
          burst(this.x + this.facing * rng * 0.55, this.y - 60, 16, '#ffd94d', 280, 'dot', 0.4);
          SFX.chargeFull();
          if (cp >= 0.99) {
            battle.addProj({ x: this.x + this.facing * 60, y: this.y - 60, vx: this.facing * 520, vy: 0, r: 13, dmg: Math.round(this.hero.dmg * 1.6), team: this.team, owner: this, kind: 'wave', pierce: 1, spin: 6 });
          }
        }
        if (t > 0.3) this.endSkill();
        break;
      }
      case 'aura': {
        /* 圣光骑士 W:开启守护光环(持续效果在 update 中处理) */
        if (t > 0.3) this.endSkill();
        break;
      }
      case 'holy': {
        /* 圣光骑士 R:神圣审判——金色光柱 */
        const sk = S.def, P = S.point;
        fire(0.35, () => addTelegraph(P.x, P.y - 10, 0.8, sk.radius, '#ffe9a8'));
        fire(1.05, () => {
          battle.aoe(P.x, GROUND_Y - 20, sk.radius, sk.dmg, this, { kb: 12, shake: 1.1, elec: true });
          flashAt(P.x, GROUND_Y - 20, '#fff8d0', 20);
          ringAt(P.x, GROUND_Y - 20, '#ffe9a8', sk.radius * 1.5, 0.4);
          starBurst(P.x, GROUND_Y - 20, 12, ['#ffe9a8', '#fff3c4', '#fff']);
          for (let i = 0; i < 16; i++) {
            spawnPart({ x: P.x + rand(-40, 40), y: GROUND_Y - rand(0, 20), vx: rand(-10, 10), vy: rand(-260, -120), life: rand(0.5, 0.9), size: rand(2, 4), color: '#ffe9a8', type: 'ember', grav: -60 });
          }
          SFX.nova();
        });
        if (t > 1.35) this.endSkill();
        break;
      }
      case 'mark': {
        /* 暗影猎手 R:死亡标记 */
        fire(0.25, () => {
          const F = S.foe;
          if (F && F.alive) {
            F.markT = S.def.dur;
            F.markOwner = this;
            addFloat(F.x, F.y - 140, '☠ 死亡标记', '#b08aff', 16);
            spawnPart({ x: F.x, y: F.y - 60, life: 0.6, size: 30, color: '#b08aff', type: 'ring' });
            SFX.skill();
          }
        });
        if (t > 0.5) this.endSkill();
        break;
      }
      default: this.endSkill();
    }
  }
  endSkill() { this.state = 'idle'; this.sk = null; }

  /* ---------- 动作 ---------- */
  startAttack(n, battle) {
    if (this.state === 'ko' || this.state === 'dash') return;
    if (this.state === 'skill') return;
    if (this.state === 'charge') return;
    this.state = 'attack'; this.stateT = 0;
    this.attackN = n; this.hitApplied = false; this.hitSet = new Set();
    this.comboBuf = false;
    /* 攻击时自动面向最近的敌人,避免背对敌人永远挥空 */
    const t = this.nearestFoe(battle);
    if (t && Math.abs(t.x - this.x) < this.hero.range * 1.7) {
      this.facing = Math.sign(t.x - this.x) || this.facing;
    }
    /* 远程英雄:距离远则远程射击 */
    if (this.hero.ranged) {
      this.rangedShot = !!(t && Math.abs(t.x - this.x) > 130);
    }
  }
  nearestFoe(battle) {
    if (!battle) return null;
    let t = null, bd = 1e9;
    const foes = battle.aliveOf(1 - this.team);
    if (!foes) return null;
    for (const f of foes) { const d = Math.abs(f.x - this.x); if (d < bd) { bd = d; t = f; } }
    return t;
  }
  resolveMelee(battle) {
    if (this.rangedShot) {
      const t = this.nearestFoe(battle) || null;
      const aim = t ? Math.atan2((t.y - 60) - (this.y - 60), t.x - this.x) : 0;
      battle.addProj({ x: this.x + Math.cos(aim) * 40, y: this.y - 60, vx: Math.cos(aim) * 560, vy: Math.sin(aim) * 560, r: 7, dmg: Math.round(this.hero.dmg * 0.75), team: this.team, owner: this, kind: 'fireball' });
      SFX.shoot();
      return;
    }
    const dmgMul = [1, 1.15, 1.7][this.attackN] || 1;
    const kb = [2, 4, 7][this.attackN] || 4;
    const rng = this.hero.range * (this.attackN === 2 ? 1.2 : 1);
    for (const f of battle.aliveOf(1 - this.team)) {
      if (this.hitSet.has(f)) continue;
      const dx = f.x - this.x;
      if (Math.abs(dx) < rng + f.scale * 14 && Math.sign(dx) === this.facing) {
        this.hitSet.add(f);
        battle.dealHit(this, f, Math.round(this.hero.dmg * dmgMul), { kb, dir: this.facing, shake: this.attackN === 2 ? 0.4 : 0 });
        if (this.attackN === 2 && this.transforming) {
          battle.addProj({ x: f.x, y: this.y - 60, vx: this.facing * 480, vy: 0, r: 10, dmg: Math.round(this.hero.dmg * 0.9), team: this.team, owner: this, kind: 'wave', pierce: 1, spin: 6 });
        }
      }
    }
  }
  startDash(dir) {
    if (this.dashCd > 0 || this.state === 'dash' || this.state === 'ko') return;
    if (this.state === 'skill') return;
    this.state = 'dash'; this.stateT = 0;
    if (dir !== undefined) this.facing = dir;
    this.dashCd = 0.75;
    this.invulnT = Math.max(this.invulnT, 0.24);
    SFX.dash();
  }
  startCharge() {
    if (this.state === 'ko' || this.state === 'skill' || this.state === 'dash') return;
    this.state = 'charge'; this.stateT = 0; this.chargeP = 0;
    if (!this.isPlayer) this.chargeHold = 0.5 + Math.random() * 0.7;
    SFX.charge();
  }
  releaseCharge() {
    const p = this.chargeP;
    this.state = 'skill';
    this.stateT = 0;
    this.sk = {
      def: { type: 'chargeSlash', dmg: Math.round(this.hero.dmg * (1 + 2.1 * p)), breakBlock: p > 0.55 },
      t: 0, fired: {}, aim: 0, chargeP: p,
    };
    this.chargeP = 0;
  }
  useSkillByKey(key, battle) {
    const sk = this.skillList.find(s => s.key === key);
    if (sk) this.useSkill(sk, battle);
  }
  useSkill(sk, battle) {
    if (!sk) return;
    if (this.state === 'ko' || this.state === 'skill' || this.state === 'dash') return;
    if (this.qi < sk.cost || this.skillCds[sk.key] > 0) return;
    this.qi -= sk.cost;
    this.skillCds[sk.key] = sk.cd;
    this.state = 'skill'; this.stateT = 0;
    this.hitSet = new Set(); /* 冲撞类技能按次记录命中,防残留 */
    this.sk = { def: sk, t: 0, fired: {}, aim: 0, foe: null, point: null, points: null };
    /* 计算瞄准(必须传入 battle,否则无法找到目标) */
    const t = this.nearestFoe(battle);
    if (t) {
      this.sk.aim = Math.atan2((t.y - 60) - (this.y - 60), t.x - this.x);
      this.facing = Math.sign(t.x - this.x) || this.facing;
      this.sk.foe = t;
      if (sk.type === 'meteor' || sk.type === 'holy') this.sk.point = { x: clamp(t.x + (t.vel.x || 0) * 0.8, 60, arenaW - 60), y: GROUND_Y - 20 };
      if (sk.type === 'lightning') {
        this.sk.points = [];
        for (let i = 0; i < sk.strikes; i++) this.sk.points.push(clamp(t.x + (t.vel.x || 0) * (0.4 + i * 0.5), 60, arenaW - 60));
      }
      if (sk.type === 'firestorm') {
        this.sk.points = [];
        for (let i = 0; i < sk.count; i++) this.sk.points.push(clamp(t.x + rand(-190, 190), 60, arenaW - 60));
      }
    } else {
      this.sk.aim = 0;
      if (sk.type === 'meteor' || sk.type === 'holy') this.sk.point = { x: clamp(this.x + this.facing * 320, 60, arenaW - 60), y: GROUND_Y - 20 };
      if (sk.type === 'lightning') {
        this.sk.points = [];
        for (let i = 0; i < sk.strikes; i++) this.sk.points.push(clamp(this.x + this.facing * 260, 60, arenaW - 60));
      }
      if (sk.type === 'firestorm') {
        this.sk.points = [];
        for (let i = 0; i < sk.count; i++) this.sk.points.push(clamp(this.x + this.facing * 260 + rand(-190, 190), 60, arenaW - 60));
      }
    }
    if (sk.type === 'shield') {
      this.shieldT = sk.dur; this.shieldTickT = 0;
      ringAt(this.x, this.y - 60, '#ffe86a', 50, 0.4);
      starBurst(this.x, this.y - 60, 10, ['#ffe86a', '#fff']);
    }
    /* 大招 CG:只给视觉冲击型技能;吐息/死亡标记等普通循环技能不遮屏 */
    if (currentBattle) {
      const bigSkill = ['meteor', 'holy', 'dash', 'backstab', 'lightning', 'spin', 'firestorm', 'furyDash'].includes(sk.type);
      if (this.isPlayer && sk.key === 'R' && bigSkill) {
        currentBattle.startCG(sk.name, this.hero.color, this.x, this.y - 60);
      } else if (this.boss && ['slam', 'firestorm', 'furyDash'].includes(sk.type)) {
        currentBattle.startCG(sk.name, '#ff2a2a', this.x, this.y - 60);
      }
      netFx({ t: 'skill', x: this.x, y: this.y - 60, name: sk.name, color: this.hero.color });
      netFx({ t: 'sfx', n: 'skill' });
    }
    addFloat(this.x, this.y - 130 * this.scale, sk.name, '#ffd94d', 15);
    SFX.skill();
  }
  startTransform() {
    if (this.transforming || this.state === 'transform' || this.qi < 100 || this.state === 'ko') return;
    this.qi = 100;
    this.state = 'transform'; this.stateT = 0;
    this.invulnT = Math.max(this.invulnT, 1.0);
    this.transformT = this.maxTransformT;
    if (this.isPlayer) this.transformCount = (this.transformCount || 0) + 1;
    if (currentBattle) {
      currentBattle.startCG('🐉 龙之变身!', '#ffd94d', this.x, this.y - 60);
      netFx({ t: 'tf', x: this.x, y: this.y - 60, on: true });
      netFx({ t: 'sfx', n: 'transform' });
    }
    /* 金焰爆发:冲击环 + 闪光 + 星尘 + 冲天火星 */
    const fx = this.x, fy = this.y - 60;
    flashAt(fx, fy, '#fff8d0', 20);
    ringAt(fx, fy, '#ffd94d', 90, 0.5);
    ringAt(fx, fy, '#ffe86a', 55, 0.35);
    starBurst(fx, fy, 18);
    for (let i = 0; i < 22; i++) {
      spawnPart({ x: fx + rand(-22, 22), y: fy + rand(-40, 30), vx: rand(-50, 50), vy: rand(-260, -90), life: rand(0.5, 1.1), size: rand(2, 4.5), color: Math.random() < 0.5 ? '#ffd94d' : '#fff3c4', type: 'ember', grav: -80 });
    }
    for (let i = 0; i < 10; i++) {
      spawnPart({ x: fx + rand(-30, 30), y: fy, vx: rand(-40, 40), vy: rand(-40, -10), life: rand(0.7, 1.3), size: rand(6, 11), color: 'rgba(120,100,60,.4)', type: 'smoke', grav: -70 });
    }
    SFX.transform();
  }
  endTransform() {
    this.transforming = false;
    this.transformT = 0;
    this.qi = 0;
    /* 金焰散落 */
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, sp = rand(50, 200);
      spawnPart({ x: this.x, y: this.y - 60, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90, life: rand(0.4, 0.8), size: rand(2, 4), color: '#ffd94d', type: 'ember', grav: 260 });
    }
    netFx({ t: 'tf', x: this.x, y: this.y - 60, on: false });
  }
  die(att) {
    if (this.koT > 0) return;
    /* 训练木桩永不倒下,血量回满 */
    if (this.def && this.def.ai === 'dummy') {
      this.hp = this.maxHp;
      return;
    }
    this.koT = 9999; /* 本作所有模式均不复活(noRespawn) */
    this.koFall = 0.28;
    this.state = 'ko';
    this.vel.x = 0;
    /* 击倒爆发:彩色碎屑 + 烟雾 + 闪光 */
    const fx = this.x, fy = this.y - 50;
    flashAt(fx, fy, '#ffffff', 13);
    burst(fx, fy, 26, this.hero.color, 260, 'dot', 0.7);
    burst(fx, fy, 12, '#fff', 180, 'dot', 0.4);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, sp = rand(60, 240);
      spawnPart({ x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: rand(0.4, 0.8), size: rand(2, 4.5), color: this.hero.color, type: 'shard', grav: 620, rot: Math.random() * TAU, spin: rand(-10, 10) });
    }
    for (let i = 0; i < 6; i++) {
      spawnPart({ x: fx + rand(-16, 16), y: fy + rand(-20, 10), vx: rand(-25, 25), vy: rand(-50, -15), life: rand(0.6, 1.1), size: rand(6, 11), color: 'rgba(90,80,70,.45)', type: 'smoke', grav: -60 });
    }
    if (att && att.team !== this.team) att.kills++;
    netFx({ t: 'ko', x: fx, y: fy, color: this.hero.color });
    netFx({ t: 'sfx', n: 'ko' });
  }

  /* ---------- 绘制 ---------- */
  draw() {
    const f = this, s = f.scale;
    const x = f.x - camX, y = f.y;
    /* 影子 */
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 6, 26 * s, 6 * s, 0, 0, TAU);
    ctx.fill();
    /* 敌人脚下红光 / 变身金光 */
    const footGlow = (f.enemy && !f.pvp) ? 'rgba(255,40,40,' : (f.transforming ? 'rgba(255,200,60,' : null);
    if (footGlow) {
      const a = (f.enemy && !f.pvp) ? 0.22 : 0.3;
      const fg = ctx.createRadialGradient(x, GROUND_Y, 2, x, GROUND_Y, 34 * s);
      fg.addColorStop(0, footGlow + a + ')');
      fg.addColorStop(1, footGlow + '0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(x, GROUND_Y, 34 * s, 0, TAU); ctx.fill();
    }
    /* 护甲光环(装备护甲时) */
    if (f.gearArmor > 0) {
      const ag = ctx.createRadialGradient(x, GROUND_Y, 2, x, GROUND_Y, 30 * s);
      ag.addColorStop(0, 'rgba(122,180,255,.28)');
      ag.addColorStop(1, 'rgba(122,180,255,0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(x, GROUND_Y, 30 * s, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(122,180,255,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, GROUND_Y, 18 * s, 0, TAU); ctx.stroke();
    }
    /* 冲刺/变身残影 */
    for (const tr of f.trails) {
      if (tr.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, tr.life * 2.2) * 0.4;
      this.drawGhost(tr.x - camX, tr.y, tr.facing, tr.scale, f.transforming ? '#ffd94d' : f.hero.color);
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(x, y);
    /* 倒地动画:旋转插值倒地 */
    const koRot = f.state === 'ko';
    const fall = koRot ? clamp(1 - f.koFall / 0.28, 0, 1) : 0;
    if (koRot) ctx.rotate(-Math.PI / 2 * fall);
    if (f.facing < 0 && !koRot) ctx.scale(-1, 1);
    ctx.scale(s, s);
    const baseHex = f.transforming ? '#ffd94d' : f.hero.color;
    let base = baseHex;
    if (f.hitFlash > 0) base = mixC(baseHex, '#ffffff', Math.min(1, f.hitFlash / 0.14) * 0.85);
    const bodyC = (f.enemy && !f.pvp) ? shade(base, -0.16) : base;
    const darkC = shade(baseHex, -0.55);
    const lightC = shade(baseHex, 0.3);
    const skinC = f.state === 'ko' ? '#c9bca8' : (f.transforming ? '#ffe9a8' : ((f.enemy && !f.pvp) ? '#e8b0a0' : '#ffe9c9'));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    /* ================= 姿态系统(预备/发力/收势/全身协同) ================= */
    const sw = Math.sin(f.walkPhase);
    const st = f.state;
    let lean = 0.06, bob = 0, squat = 0, shiver = 0, headTilt = 0;
    let armA = 0.75, armB = -1.15, legSwing = 0, legLift = 0, arch = 4;
    switch (st) {
      case 'idle': {
        /* 战斗架势:微蹲 + 双手半举 + 呼吸 + 重心微晃 */
        bob = Math.sin(f.t * 2.2) * 1.3;
        armA = 0.78 + Math.sin(f.t * 2.2) * 0.05;
        armB = -1.18 - Math.sin(f.t * 2.2) * 0.04;
        arch = 6;
        break;
      }
      case 'run': {
        /* 奔跑:弹跳起伏 + 大步摆腿 + 摆臂 + 弓背 */
        lean = 0.26;
        bob = Math.abs(sw) * 4.5;
        legSwing = sw * 26;
        legLift = 9;
        armA = 1.0 * sw - 0.1;
        armB = -1.0 * sw + 0.1;
        arch = 9;
        break;
      }
      case 'attack': {
        const at = f.hero.atkT;
        const p = f.stateT / at;
        const n = f.attackN;
        const PRE = 0.14, SWING = 0.42;
        if (f.rangedShot) {
          /* 远程射击:抬手前指 */
          armA = lerp(-1.1, -1.6, Math.min(1, p / 0.2));
          armB = -1.2;
          lean = 0.12;
          break;
        }
        if (n === 0) {
          /* 第一击:水平横扫 */
          let swing;
          if (p < PRE) { swing = lerp(-1.1, -2.4, p / PRE); lean = lerp(-0.02, -0.1, p / PRE); legSwing = lerp(0, -10, p / PRE); }
          else if (p < SWING) { const q = (p - PRE) / (SWING - PRE); swing = lerp(-2.4, -0.45, q); lean = lerp(-0.1, 0.28, q); legSwing = lerp(-10, 16, q); headTilt = -0.14 * q; }
          else { const q = (p - SWING) / (1 - SWING); swing = lerp(-0.45, -1.25, q); lean = lerp(0.28, 0.1, q); legSwing = lerp(16, 0, q); headTilt = -0.14 * (1 - q); }
          armA = swing;
          armB = 0.7; /* 副手护胸 */
        } else if (n === 1) {
          /* 第二击:反手斜撩(自下而上) */
          let swing;
          if (p < PRE) { swing = lerp(-0.5, -0.95, p / PRE); lean = 0.06; legSwing = lerp(0, 8, p / PRE); }
          else if (p < SWING) { const q = (p - PRE) / (SWING - PRE); swing = lerp(-0.95, -2.65, q); lean = lerp(0.06, -0.06, q); legSwing = lerp(8, -12, q); headTilt = 0.1 * q; }
          else { const q = (p - SWING) / (1 - SWING); swing = lerp(-2.65, -1.7, q); lean = lerp(-0.06, 0.08, q); legSwing = lerp(-12, 0, q); headTilt = 0.1 * (1 - q); }
          armA = swing;
          armB = -0.4; /* 副手自然辅助 */
        } else {
          /* 第三击:双手重劈 */
          let swing, swingB;
          if (p < PRE) { swing = lerp(-1.3, -2.9, p / PRE); swingB = lerp(-1.1, -2.6, p / PRE); lean = lerp(-0.02, -0.08, p / PRE); }
          else if (p < SWING) { const q = (p - PRE) / (SWING - PRE); swing = lerp(-2.9, -1.2, q); swingB = lerp(-2.6, -1.0, q); lean = lerp(-0.08, 0.34, q); headTilt = -0.2 * q; }
          else { const q = (p - SWING) / (1 - SWING); swing = lerp(-1.2, -1.6, q); swingB = lerp(-1.0, -1.3, q); lean = lerp(0.34, 0.14, q); headTilt = -0.2 * (1 - q); }
          armA = swing;
          armB = swingB; /* 副手同握剑柄,随主手 */
          squat = 5;
          arch = 10;
        }
        break;
      }
      case 'block': {
        squat = 5;
        lean = 0.1;
        armA = 0.95; armB = 0.95;
        headTilt = 0.06;
        break;
      }
      case 'blockbroken': {
        squat = 4;
        shiver = 0.5;
        armA = 0.3; armB = -0.2;
        lean = 0.05;
        break;
      }
      case 'charge': {
        squat = 13;
        lean = 0.24;
        shiver = f.chargeP;
        armA = -2.5; armB = -0.5;
        headTilt = 0.08;
        arch = 8;
        break;
      }
      case 'dash': {
        lean = 0.6;
        bob = 2;
        legSwing = 24; legLift = 6;
        armA = -2.4; armB = -2.2;
        headTilt = -0.22;
        break;
      }
      case 'hit': {
        /* 受击击飞:后仰 + 双臂飞起 + 腿前伸 */
        lean = -0.5;
        bob = 3;
        legSwing = 17;
        armA = -2.5; armB = 2.4;
        headTilt = 0.4;
        break;
      }
      case 'ko': {
        armA = 2.0; armB = -1.8;
        legSwing = 0;
        break;
      }
      case 'skill': {
        const ty = f.sk ? f.sk.def.type : '';
        if (['meteor', 'lightning', 'volley', 'slam', 'bolt', 'nova', 'shard'].includes(ty)) {
          /* 施法:双臂上举,身体微仰 */
          armA = -2.9; armB = -1.4;
          lean = -0.14; headTilt = 0.22;
        } else if (ty === 'spin') {
          armA = 1.6; armB = 1.6; lean = 0.14;
        } else if (ty === 'dash') {
          lean = 0.55; armA = -2.4; armB = -2.2; legSwing = 22; headTilt = -0.2;
        } else {
          armA = -2.2; armB = 0.4; lean = 0.16;
        }
        break;
      }
      case 'transform': {
        /* 变身:双臂张开仰天长啸 + 能量震颤 */
        armA = 2.9 + Math.sin(f.t * 10) * 0.18;
        armB = -2.9 - Math.sin(f.t * 10) * 0.18;
        lean = -0.12;
        headTilt = -0.3;
        bob = Math.sin(f.t * 14) * 1.6;
        break;
      }
    }
    /* 蓄力/破防颤抖(抖动位移) */
    const shx = shiver ? (Math.random() - 0.5) * shiver * 3 : 0;
    const shy = shiver ? (Math.random() - 0.5) * shiver * 2 : 0;
    /* 骨架位置 */
    const hipY = -46 + squat + bob + shy;
    const neck = { x: shx + lean * 7, y: -74 + bob + shy };
    const hip = { x: shx, y: hipY };
    const sh = { x: neck.x + 2, y: -68 + bob + shy };
    /* 头随姿态转动 */
    const headRef = { x: neck.x + Math.sin(headTilt) * 2, y: neck.y - 14 + Math.cos(headTilt) * 2 };
    /* 披风 / 围巾(后层) */
    this.drawBack(sh);
    /* 龙翼(变身/巨龙) */
    if (f.transforming || f.boss) {
      const flap = Math.sin(f.t * 9) * 0.3;
      for (const sd of [-1, 1]) {
        ctx.fillStyle = f.boss ? 'rgba(190,28,28,.85)' : 'rgba(255,190,50,.9)';
        ctx.strokeStyle = f.boss ? '#701010' : '#c87800';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sd * 4, -72);
        ctx.quadraticCurveTo(sd * 40, -96 - flap * 20, sd * 62, -60 + flap * 12);
        ctx.lineTo(sd * 44, -58 + flap * 4);
        ctx.quadraticCurveTo(sd * 34, -70 - flap * 8, sd * 12, -56);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = f.boss ? 'rgba(255,120,90,.6)' : 'rgba(255,240,180,.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sd * 8, -68);
        ctx.quadraticCurveTo(sd * 36, -80 - flap * 14, sd * 58, -60 + flap * 10);
        ctx.stroke();
      }
    }
    /* 光环 */
    if (f.transforming || f.boss) {
      const pulse = 1 + Math.sin(f.t * (f.rageOn ? 14 : 6)) * (f.rageOn ? 0.16 : 0.08);
      const g = ctx.createRadialGradient(0, -60, 4, 0, -60, 56 * pulse);
      g.addColorStop(0, f.rageOn ? 'rgba(255,20,20,.55)' : (f.boss ? 'rgba(255,60,60,.30)' : 'rgba(255,217,77,.34)'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -60, 56 * pulse, 0, TAU); ctx.fill();
      if (f.rageOn && Math.random() < 0.5) {
        spawnPart({ x: rand(-46, 46), y: rand(-110, -20), vx: rand(-15, 15), vy: rand(-60, -20), life: rand(0.3, 0.6), size: rand(2, 4), color: Math.random() < 0.5 ? '#ff5a2a' : '#ff2a2a', type: 'ember', flicker: true });
      }
    }
    /* 蓄力蓄能圈 + 电弧 */
    if (f.state === 'charge') {
      const r0 = 14 + 34 * f.chargeP;
      const g = ctx.createRadialGradient(0, -60, 2, 0, -60, r0);
      g.addColorStop(0, 'rgba(255,217,77,.5)'); g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -60, r0, 0, TAU); ctx.fill();
      if (f.chargeP > 0.35) {
        ctx.strokeStyle = 'rgba(255,225,110,.85)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const a0 = f.t * 8 + i * TAU / 3, rr = r0 + 4;
          const a1 = a0 + 0.9 + Math.sin(f.t * 21 + i * 2) * 0.5;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a0) * rr * 0.5, -60 + Math.sin(a0) * rr * 0.5);
          ctx.quadraticCurveTo(Math.cos((a0 + a1) / 2) * rr * 1.1, -60 + Math.sin((a0 + a1) / 2) * rr * 1.1, Math.cos(a1) * rr, -60 + Math.sin(a1) * rr);
          ctx.stroke();
        }
      }
    }
    /* 尾巴(巨龙) */
    if (f.boss) {
      const wag = Math.sin(f.t * 4) * 7;
      ctx.strokeStyle = darkC; ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.quadraticCurveTo(26, -30, 42 + wag, -14 + wag * 0.4);
      ctx.stroke();
      ctx.strokeStyle = bodyC; ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.quadraticCurveTo(26, -30, 42 + wag, -14 + wag * 0.4);
      ctx.stroke();
      ctx.fillStyle = bodyC;
      ctx.beginPath(); ctx.arc(42 + wag, -14 + wag * 0.4, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = darkC; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(42 + wag, -14 + wag * 0.4, 8, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ff5a2a';
      ctx.beginPath(); ctx.moveTo(46 + wag, -18 + wag * 0.4); ctx.lineTo(58 + wag, -14 + wag * 0.4); ctx.lineTo(46 + wag, -10 + wag * 0.4); ctx.closePath(); ctx.fill();
    }
    /* 腿(后腿先画) */
    const footA = { x: hip.x + (st === 'ko' ? 0 : legSwing), y: 0 };
    const footB = { x: hip.x - legSwing * 0.75, y: 0 };
    this.limbLeg(hip, footA, 1, legLift, bodyC, darkC);
    /* 躯干(外轮廓+渐变内芯+肩垫+腰带,弓背) */
    this.torso(neck, hip, arch, bodyC, darkC, lightC);
    /* 头(发型/面具/头盔/眼睛,随姿态转动) */
    this.head(f, headRef, bodyC, darkC, skinC);
    this.limbLeg(hip, footB, -1, legLift * 0.6, bodyC, darkC);
    /* 手臂(副手先画) */
    this.limbArm(sh, armB, bodyC, darkC);
    this.limbArm(sh, armA, bodyC, darkC);
    /* 武器 */
    const hand = { x: sh.x, y: sh.y };
    hand.x += Math.cos(armA) * 22; hand.y += Math.sin(armA) * 22;
    this.weapon(hand, armA);
    /* 重甲盾牌 */
    if (f.style && f.style.shield) {
      const bx = sh.x + Math.cos(0.9) * 26, by = sh.y + Math.sin(0.9) * 26;
      ctx.fillStyle = '#5a5a6a';
      ctx.beginPath(); ctx.arc(bx, by, 13, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#8a8a9a';
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a3a4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - 13, by); ctx.lineTo(bx + 13, by); ctx.stroke();
    }
    /* 攻击弧光 */
    if (f.state === 'attack' && f.stateT >= 0.08 && f.stateT <= 0.24) {
      const prog = (f.stateT - 0.08) / 0.16;
      ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - prog * 0.5)})`;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 36, armA - 0.7, armA + 0.5); ctx.stroke();
      ctx.strokeStyle = `rgba(255,215,80,${0.45 * (1 - prog)})`;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 36, armA - 0.55, armA + 0.35); ctx.stroke();
    }
    /* 格挡能量盾 */
    if (f.state === 'block') {
      ctx.strokeStyle = 'rgba(122,215,255,.95)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(27, -68, 21, -1.15, 1.15); ctx.stroke();
      ctx.strokeStyle = 'rgba(122,215,255,.4)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(27, -68, 27, -1.05, 1.05); ctx.stroke();
      ctx.strokeStyle = 'rgba(122,215,255,.28)'; ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.arc(27, -68, 21, i * 0.45 - 0.22, i * 0.45 + 0.22); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(122,215,255,.12)';
      ctx.beginPath(); ctx.arc(27, -68, 21, -1.15, 1.15); ctx.closePath(); ctx.fill();
    }
    /* 雷神护盾光球 */
    if (f.shieldT > 0) {
      const a = f.t * 4;
      for (let i = 0; i < 3; i++) {
        const aa = a + i * TAU / 3;
        const ox = Math.cos(aa) * 34, oy = -60 + Math.sin(aa) * 16;
        const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, 9);
        g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#ffe86a'); g.addColorStop(1, 'rgba(255,232,106,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(ox, oy, 9, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,232,106,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -60, 42, 0, TAU); ctx.stroke();
    }
    /* 守护光环 */
    if (f.auraT > 0) {
      ctx.strokeStyle = 'rgba(255,233,168,.55)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, -60, 40, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,233,168,.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, -60, 47 + Math.sin(f.t * 5) * 3, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    /* 血条 / 气条(训练木桩不显示) */
    if (this.def && this.def.ai === 'dummy') return;
    const bw = 46 * s;
    const bx = x - bw / 2, by = y - 128 * s - 16;
    if (f.koT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `bold ${13 * s}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('✖', x, by + 4);
      if (this.koT < 5) {
        ctx.fillStyle = '#ffd94d';
        ctx.font = `bold 15px sans-serif`;
        ctx.fillText(Math.ceil(this.koT), x, by - 6);
      }
      return;
    }
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
    ctx.fillStyle = f.pvp ? '#1a3a8a' : (f.enemy ? '#8a2020' : '#2a8a3a');
    ctx.fillRect(bx, by, bw, 6);
    ctx.fillStyle = f.pvp ? '#5a9aff' : (f.enemy ? '#ff4a4a' : '#5aff7a');
    ctx.fillRect(bx, by, bw * clamp(this.hp / this.maxHp, 0, 1), 6);
    if (this.qi > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(bx - 1, by + 7, bw + 2, 4);
      ctx.fillStyle = this.qi >= 100 ? '#ffd94d' : '#2aa8ff';
      ctx.fillRect(bx, by + 8, bw * clamp(this.qi / 100, 0, 1), 2);
    }
    /* 死亡标记:头顶紫色骷髅标记 */
    if (this.markT > 0) {
      ctx.fillStyle = '#b08aff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, by - 16);
      ctx.lineTo(x - 7, by - 27);
      ctx.lineTo(x + 7, by - 27);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, by - 21, 2, 0, TAU); ctx.fill();
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.markT.toFixed(1), x, by - 31);
    }
  }
  /* 残影剪影 */
  drawGhost(x, y, facing, scale, color) {
    ctx.save();
    ctx.translate(x, y);
    if (facing < 0) ctx.scale(-1, 1);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(2, -92, 10, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(2, -78); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(-10, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(12, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -68); ctx.lineTo(-16, -56); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -68); ctx.lineTo(18, -50); ctx.stroke();
    ctx.restore();
  }
  /* 披风 / 围巾 */
  drawBack(sh) {
    const st = this.style || {};
    const flap = Math.sin(this.t * 7);
    if (st.cape) {
      ctx.fillStyle = st.cape;
      ctx.beginPath();
      ctx.moveTo(sh.x - 2, sh.y + 2);
      ctx.quadraticCurveTo(sh.x - 26, sh.y + 16 + flap * 5, sh.x - 22, -10 + flap * 9);
      ctx.quadraticCurveTo(sh.x - 9, -28 + flap * 3, sh.x - 4, sh.y - 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = shade(st.cape, -0.5); ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (st.scarf) {
      const w1 = Math.sin(this.t * 8) * 5;
      ctx.strokeStyle = st.scarf; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sh.x - 3, sh.y - 2);
      ctx.quadraticCurveTo(sh.x - 17, sh.y + 5 + w1, sh.x - 27, sh.y - 5 + w1 * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sh.x - 3, sh.y - 2);
      ctx.quadraticCurveTo(sh.x - 15, sh.y + 11 - w1, sh.x - 23, sh.y + 7 - w1 * 2);
      ctx.stroke();
    }
  }
  /* 躯干:弓背曲线 + 外轮廓 + 渐变内芯 + 肩垫 + 腰带 */
  torso(neck, hip, arch, bodyC, darkC, lightC) {
    const mx = (hip.x + neck.x) / 2, my = (hip.y + neck.y) / 2;
    const cx = mx - arch, cy = my - 2;
    ctx.strokeStyle = darkC; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.quadraticCurveTo(cx, cy, neck.x, neck.y); ctx.stroke();
    const g = ctx.createLinearGradient(0, neck.y, 0, hip.y);
    g.addColorStop(0, lightC);
    g.addColorStop(0.55, bodyC);
    g.addColorStop(1, shade(bodyC, -0.22));
    ctx.strokeStyle = g; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.quadraticCurveTo(cx, cy, neck.x, neck.y); ctx.stroke();
    /* 肩垫 */
    ctx.fillStyle = lightC;
    ctx.beginPath(); ctx.arc(neck.x + 1, neck.y + 1, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = darkC; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(neck.x + 1, neck.y + 1, 5, 0, TAU); ctx.stroke();
    /* 腰带 */
    ctx.fillStyle = shade(bodyC, -0.35);
    ctx.fillRect(hip.x - 5, hip.y - 4, 10, 7);
    ctx.fillStyle = '#ffd94d';
    ctx.fillRect(hip.x - 1.5, hip.y - 3.5, 3, 6);
  }
  /* 腿:轮廓 + 内芯 + 抬膝 + 靴子 */
  limbLeg(hip, foot, dir, lift, bodyC, darkC) {
    const kx = (hip.x + foot.x) / 2 + dir * (5 + lift * 0.5);
    const ky = (hip.y + foot.y) / 2 - 5 - lift * 0.6;
    ctx.strokeStyle = darkC; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(kx, ky); ctx.lineTo(foot.x, foot.y); ctx.stroke();
    ctx.strokeStyle = bodyC; ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(kx, ky); ctx.lineTo(foot.x, foot.y); ctx.stroke();
    ctx.fillStyle = shade(bodyC, -0.42);
    ctx.beginPath(); ctx.ellipse(foot.x + dir * 2, foot.y - 2, 6, 4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = darkC; ctx.lineWidth = 1.5; ctx.stroke();
  }
  /* 手臂:轮廓 + 内芯 + 肘部弯曲 + 手套 */
  limbArm(sh, ang, bodyC, darkC) {
    const hx = sh.x + Math.cos(ang) * 21, hy = sh.y + Math.sin(ang) * 21;
    /* 肘部:向臂的垂直方向微弯 */
    const mx = (sh.x + hx) / 2, my = (sh.y + hy) / 2;
    const px = -(hy - sh.y), py = (hx - sh.x);
    const pl = Math.hypot(px, py) || 1;
    const ex = mx + px / pl * 3.5, ey = my + py / pl * 3.5;
    ctx.strokeStyle = darkC; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.quadraticCurveTo(ex, ey, hx, hy); ctx.stroke();
    ctx.strokeStyle = bodyC; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.quadraticCurveTo(ex, ey, hx, hy); ctx.stroke();
    ctx.fillStyle = shade(bodyC, -0.35);
    ctx.beginPath(); ctx.arc(hx, hy, 3.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = darkC; ctx.lineWidth = 1.5; ctx.stroke();
  }
  /* 头部:肤色 + 发型/面具/头盔 + 眼睛 */
  head(f, neck, bodyC, darkC, skinC) {
    const st = f.style || {};
    const hx = neck.x, hy = neck.y - 14;
    const R = 11;
    /* 头 */
    ctx.fillStyle = skinC;
    ctx.beginPath(); ctx.arc(hx, hy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = darkC; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(hx, hy, R, 0, TAU); ctx.stroke();
    /* 面具(下半脸) */
    if (st.mask) {
      ctx.fillStyle = '#eef4ff';
      ctx.beginPath(); ctx.arc(hx + 1, hy + 2.5, R - 1, Math.PI * 0.12, Math.PI * 0.88); ctx.fill();
      ctx.strokeStyle = darkC; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hx + 1, hy + 2.5, R - 1, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
    }
    /* 兜帽 */
    if (st.hood) {
      ctx.fillStyle = shade(bodyC, -0.38);
      ctx.strokeStyle = darkC; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - R - 2, hy - R + 3);
      ctx.quadraticCurveTo(hx, hy - R - 6, hx + R + 2, hy - R + 3);
      ctx.quadraticCurveTo(hx + R + 3, hy - 4, hx + R - 1, hy - 7);
      ctx.quadraticCurveTo(hx + 2, hy + 1, hx - R + 1, hy - 7);
      ctx.quadraticCurveTo(hx - R - 3, hy - 4, hx - R - 2, hy - R + 3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    /* 发型 */
    const hair = f.transforming ? 'gold' : st.hair;
    if (hair === 'goldSpiky' || hair === 'gold') {
      ctx.fillStyle = f.transforming ? '#ffe86a' : '#ffd94d';
      ctx.strokeStyle = shade(f.transforming ? '#ffe86a' : '#ffd94d', -0.45); ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx - R + 1, hy - 4);
      ctx.quadraticCurveTo(hx - R - 2, hy - R - 4, hx - R + 3, hy - R - 2);
      ctx.lineTo(hx - 3, hy - R - 5);
      ctx.lineTo(hx + 1, hy - R - 1);
      ctx.lineTo(hx + 5, hy - R - 6);
      ctx.lineTo(hx + 9, hy - R - 2);
      ctx.lineTo(hx + R + 1, hy - R + 2);
      ctx.quadraticCurveTo(hx + R + 2, hy - 3, hx + R - 3, hy - 5);
      ctx.quadraticCurveTo(hx + 2, hy + 1, hx - R + 1, hy - 3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (hair === 'goldSpiky' && !f.transforming) {
        /* 红色头带 + 飘带 */
        ctx.strokeStyle = '#d03030'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(hx - R + 2, hy - 3); ctx.lineTo(hx + R - 2, hy - 4); ctx.stroke();
        ctx.lineWidth = 2.5;
        const rb = Math.sin(f.t * 9) * 4;
        ctx.beginPath(); ctx.moveTo(hx - R + 2, hy - 3); ctx.quadraticCurveTo(hx - R - 8, hy + 2 + rb, hx - R - 14, hy + 10 + rb); ctx.stroke();
      }
    } else if (hair === 'flame') {
      const fl = Math.sin(f.t * 12) * 1.5;
      ctx.fillStyle = '#ff8a2a';
      ctx.strokeStyle = '#c04810'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx - R + 2, hy - 4);
      ctx.quadraticCurveTo(hx - R - 1, hy - R - 3 + fl, hx - 4, hy - R - 4 + fl * 1.5);
      ctx.lineTo(hx - 1, hy - R - 1);
      ctx.lineTo(hx + 2, hy - R - 6 + fl);
      ctx.lineTo(hx + 5, hy - R - 2);
      ctx.lineTo(hx + 8, hy - R - 5 + fl);
      ctx.lineTo(hx + R, hy - R + 1);
      ctx.quadraticCurveTo(hx + R + 3, hy - 3, hx + R - 3, hy - 5);
      ctx.quadraticCurveTo(hx + 2, hy + 1, hx - R + 1, hy - 3);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd94d';
      ctx.beginPath(); ctx.arc(hx - 2, hy - R - 3 + fl, 3.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + 6, hy - R - 3 + fl, 2.4, 0, TAU); ctx.fill();
    } else if (hair === 'helm') {
      /* 金属头盔 */
      ctx.fillStyle = '#b8c4d8';
      ctx.beginPath(); ctx.arc(hx, hy, R + 1.5, Math.PI * 0.88, Math.PI * 2.12); ctx.fill();
      ctx.strokeStyle = darkC; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#9aa8c0';
      ctx.fillRect(hx + 3.5, hy - 2, 2.5, 7);
      ctx.strokeStyle = '#e8c040'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx - 4, hy - R + 1); ctx.lineTo(hx - 9, hy - R - 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx + 4, hy - R + 1); ctx.lineTo(hx + 9, hy - R - 9); ctx.stroke();
    }
    /* 龙角(变身/巨龙) */
    if (f.transforming || f.boss) {
      ctx.fillStyle = f.boss ? '#ff8a5a' : '#ffd94d';
      ctx.strokeStyle = f.boss ? '#a04020' : '#c87800'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx - 6, hy - 7); ctx.lineTo(hx - 10, hy - 20); ctx.lineTo(hx - 1, hy - 10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx + 6, hy - 7); ctx.lineTo(hx + 10, hy - 20); ctx.lineTo(hx + 1, hy - 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    /* 眼睛 */
    const eyeX = hx + 4.5, eyeY = hy - 1;
    if (f.state === 'ko') {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hx - 6, hy - 5); ctx.lineTo(hx - 1, hy + 1);
      ctx.moveTo(hx - 1, hy - 5); ctx.lineTo(hx - 6, hy + 1);
      ctx.stroke();
    } else if (f.state === 'block' || f.state === 'charge') {
      ctx.strokeStyle = darkC; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(eyeX - 3.5, eyeY); ctx.quadraticCurveTo(eyeX, eyeY + 2.5, eyeX + 3.5, eyeY); ctx.stroke();
    } else {
      const glow = f.transforming || f.boss;
      if (f.enemy && !f.pvp) {
        const eg = ctx.createRadialGradient(eyeX, eyeY, 1, eyeX, eyeY, 8);
        eg.addColorStop(0, 'rgba(255,30,30,.55)'); eg.addColorStop(1, 'rgba(255,30,30,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(eyeX, eyeY, 8, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(eyeX, eyeY, 4, 4.6, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = darkC; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = (f.enemy && !f.pvp) ? '#ff2222' : (glow ? '#ffb800' : (f.pvp ? '#1c5cff' : '#1c5cff'));
      ctx.beginPath(); ctx.arc(eyeX + 0.8, eyeY + 0.5, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath(); ctx.arc(eyeX + 0.2, eyeY - 1.2, 0.9, 0, TAU); ctx.fill();
      /* 眉毛 */
      const fierce = (f.state === 'attack' || f.state === 'skill' || f.state === 'charge' || f.state === 'hit') ? -0.4 : 0;
      ctx.strokeStyle = darkC; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(eyeX - 4, eyeY - 6.5 + fierce * 4);
      ctx.lineTo(eyeX + 4, eyeY - 6.5 - fierce * 4);
      ctx.stroke();
    }
  }
  weapon(hand, ang) {
    const kind = this.hero.weapon;
    const wc = this.weaponColor || this.hero.color;
    const glow = this.transforming;
    const tip = (len) => ({ x: hand.x + Math.cos(ang) * len, y: hand.y + Math.sin(ang) * len });
    if (kind === 'sword') {
      const t = tip(30);
      ctx.strokeStyle = '#5a6a8a'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      const bg = ctx.createLinearGradient(hand.x, hand.y, t.x, t.y);
      bg.addColorStop(0, '#cfd8ff'); bg.addColorStop(1, '#ffffff');
      ctx.strokeStyle = bg; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      /* 护手 */
      ctx.strokeStyle = wc; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(hand.x - Math.cos(ang) * 9, hand.y - Math.sin(ang) * 9); ctx.lineTo(hand.x + Math.cos(ang) * 3, hand.y + Math.sin(ang) * 3); ctx.stroke();
      /* 剑格 */
      const gx = hand.x + Math.cos(ang) * 5, gy = hand.y + Math.sin(ang) * 5;
      ctx.strokeStyle = wc; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gx - Math.cos(ang + 1.57) * 7, gy - Math.sin(ang + 1.57) * 7);
      ctx.lineTo(gx + Math.cos(ang + 1.57) * 7, gy + Math.sin(ang + 1.57) * 7);
      ctx.stroke();
      /* 剑柄尾珠 */
      ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(hand.x - Math.cos(ang) * 10, hand.y - Math.sin(ang) * 10, 2.5, 0, TAU); ctx.fill();
      if (glow) {
        ctx.strokeStyle = 'rgba(255,220,90,.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hand.x + 1, hand.y + 1); ctx.lineTo(t.x + 1, t.y + 1); ctx.stroke();
      }
    } else if (kind === 'staff') {
      ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hand.x + Math.cos(ang) * 30, hand.y + Math.sin(ang) * 30); ctx.stroke();
      ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hand.x + Math.cos(ang) * 30, hand.y + Math.sin(ang) * 30); ctx.stroke();
      const ox = hand.x + Math.cos(ang) * 32, oy = hand.y + Math.sin(ang) * 32;
      const pulse = 1 + Math.sin(this.t * 7) * 0.15;
      const g = ctx.createRadialGradient(ox, oy, 1, ox, oy, 11 * pulse);
      g.addColorStop(0, '#fff'); g.addColorStop(0.4, wc); g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(ox, oy, 11 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ox, oy, 3.5, 0, TAU); ctx.fill();
    } else if (kind === 'daggers') {
      ctx.strokeStyle = '#5a6a8a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hand.x + Math.cos(ang + 0.5) * 22, hand.y + Math.sin(ang + 0.5) * 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hand.x - 3, hand.y + 3); ctx.lineTo(hand.x + Math.cos(ang - 0.5) * 20, hand.y + Math.sin(ang - 0.5) * 20); ctx.stroke();
      ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hand.x + Math.cos(ang + 0.5) * 22, hand.y + Math.sin(ang + 0.5) * 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hand.x - 3, hand.y + 3); ctx.lineTo(hand.x + Math.cos(ang - 0.5) * 20, hand.y + Math.sin(ang - 0.5) * 20); ctx.stroke();
      ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(hand.x + Math.cos(ang + 0.5) * 22, hand.y + Math.sin(ang + 0.5) * 22, 2.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(hand.x + Math.cos(ang - 0.5) * 20, hand.y + Math.sin(ang - 0.5) * 20, 2.2, 0, TAU); ctx.fill();
    } else if (kind === 'hammer') {
      ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hand.x + Math.cos(ang) * 24, hand.y + Math.sin(ang) * 24); ctx.stroke();
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(hand.x + Math.cos(ang) * 24, hand.y + Math.sin(ang) * 24); ctx.stroke();
      const hx = hand.x + Math.cos(ang) * 27, hy = hand.y + Math.sin(ang) * 27;
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
      ctx.fillStyle = '#5a5a6a';
      ctx.fillRect(-15, -8, 30, 16);
      ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 2; ctx.strokeRect(-15, -8, 30, 16);
      ctx.fillStyle = '#ffe86a';
      ctx.fillRect(-9, -5, 18, 10);
      ctx.strokeStyle = '#ffd94d'; ctx.lineWidth = 1.5; ctx.strokeRect(-9, -5, 18, 10);
      if (glow) {
        ctx.strokeStyle = 'rgba(255,232,106,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-15, 0); ctx.quadraticCurveTo(0, -4 + Math.sin(this.t * 12) * 2, 15, 0); ctx.stroke();
      }
      ctx.restore();
    } else if (kind === 'bow') {
      ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(hand.x, hand.y, 22, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hand.x, hand.y, 22, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = 'rgba(240,240,240,.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hand.x + Math.cos(-1.2) * 22, hand.y + Math.sin(-1.2) * 22); ctx.lineTo(hand.x + Math.cos(1.2) * 22, hand.y + Math.sin(1.2) * 22); ctx.stroke();
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath(); ctx.arc(hand.x + Math.cos(-1.2) * 22, hand.y + Math.sin(-1.2) * 22, 2.5, 0, TAU); ctx.fill();
    } else if (kind === 'dragon') {
      ctx.strokeStyle = '#7a2a1a'; ctx.lineWidth = 6;
      for (let i = 0; i < 3; i++) {
        const a = ang + (i - 1) * 0.35;
        ctx.beginPath();
        ctx.moveTo(hand.x, hand.y);
        ctx.lineTo(hand.x + Math.cos(a) * 36, hand.y + Math.sin(a) * 36);
        ctx.stroke();
      }
      ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 3.5;
      for (let i = 0; i < 3; i++) {
        const a = ang + (i - 1) * 0.35;
        ctx.beginPath();
        ctx.moveTo(hand.x, hand.y);
        ctx.lineTo(hand.x + Math.cos(a) * 36, hand.y + Math.sin(a) * 36);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const a = ang + (i - 1) * 0.35;
        ctx.beginPath(); ctx.arc(hand.x + Math.cos(a) * 36, hand.y + Math.sin(a) * 36, 3, 0, TAU); ctx.fill();
      }
    } else if (kind === 'fist') {
      ctx.fillStyle = shade(this.hero.color, -0.3);
      ctx.beginPath(); ctx.arc(hand.x, hand.y, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
}
/* ---------------- 战斗场景 ---------------- */
const THEMES = {
  forest: { sky: ['#101c2e', '#2e4a5e'], sun: '#ffd97a', far: '#23384a', near: '#16283a', ground: '#2c4a2e', line: '#4a7a4a', deco: 'tree' },
  volcano: { sky: ['#2a1410', '#571f12'], sun: '#ff6a2a', far: '#3a1a10', near: '#281208', ground: '#3a2a1e', line: '#7a4a2a', deco: 'rock' },
  frost: { sky: ['#0e1c33', '#23476e'], sun: '#bfe8ff', far: '#18304f', near: '#10203a', ground: '#2c3a52', line: '#6a8ab0', deco: 'ice' },
  castle: { sky: ['#140d24', '#2c1a4a'], sun: '#b06aff', far: '#1c1238', near: '#120c26', ground: '#2a2240', line: '#6a5a90', deco: 'torch' },
  arena: { sky: ['#1c1610', '#3d2f18'], sun: '#ffd97a', far: '#2c2418', near: '#201a10', ground: '#4a3a24', line: '#8a6a3a', deco: 'pillar' },
  tour: { sky: ['#10122a', '#262a52'], sun: '#ffd94d', far: '#1a1c3c', near: '#12142c', ground: '#3a3060', line: '#8a7ad0', deco: 'pillar' },
};
function decoDraw(type, x, theme) {
  ctx.save();
  ctx.translate(x - camX * 0.85, GROUND_Y);
  if (type === 'tree') {
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-5, -34, 10, 34);
    ctx.fillStyle = '#2c6a3a';
    ctx.beginPath(); ctx.arc(0, -46, 18, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-14, -38, 13, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(14, -38, 13, 0, TAU); ctx.fill();
  } else if (type === 'rock') {
    ctx.fillStyle = '#4a3a34';
    ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-10, -22); ctx.lineTo(8, -30); ctx.lineTo(20, -6); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  } else if (type === 'ice') {
    ctx.fillStyle = 'rgba(140,200,255,.5)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-16, -30); ctx.lineTo(-6, -46); ctx.lineTo(14, -20); ctx.closePath(); ctx.fill();
  } else if (type === 'torch') {
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-3, -40, 6, 40);
    const g = ctx.createRadialGradient(0, -50, 2, 0, -50, 14);
    g.addColorStop(0, '#fff8c0'); g.addColorStop(0.5, '#ff9a2a'); g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -50, 14, 0, TAU); ctx.fill();
  } else if (type === 'pillar') {
    ctx.fillStyle = theme === 'tour' ? '#4a3a7a' : '#6a5a3a';
    ctx.fillRect(-14, -70, 28, 70);
    ctx.fillStyle = theme === 'tour' ? '#6a5aaa' : '#8a7a4a';
    ctx.fillRect(-18, -80, 36, 12);
    ctx.fillRect(-18, -6, 36, 6);
  }
  ctx.restore();
}
function drawBackground(theme) {
  const T = THEMES[theme] || THEMES.arena;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, T.sky[0]); g.addColorStop(1, T.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  /* 太阳/月亮 */
  const sx = W * 0.78 - camX * 0.02, sy = 84;
  const sg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 60);
  sg.addColorStop(0, T.sun); sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(sx, sy, 60, 0, TAU); ctx.fill();
  ctx.fillStyle = T.sun;
  ctx.beginPath(); ctx.arc(sx, sy, 22, 0, TAU); ctx.fill();
  /* 远山 */
  ctx.fillStyle = T.far;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let px = 0; px <= W; px += 8) {
    const wx = px + camX * 0.15;
    const hgt = 70 + Math.sin(wx * 0.004) * 34 + Math.sin(wx * 0.011) * 16;
    ctx.lineTo(px, GROUND_Y - hgt);
  }
  ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();
  /* 近山 */
  ctx.fillStyle = T.near;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let px = 0; px <= W; px += 8) {
    const wx = px + camX * 0.4;
    const hgt = 34 + Math.sin(wx * 0.007 + 2) * 18 + Math.sin(wx * 0.02) * 8;
    ctx.lineTo(px, GROUND_Y - hgt);
  }
  ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();
  /* 地面 */
  ctx.fillStyle = T.ground;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = T.line;
  ctx.fillRect(0, GROUND_Y, W, 3);
  /* 装饰 */
  for (let i = 0; i < 8; i++) decoDraw(T.deco, i * 260 + 60 + (i % 3) * 40, T);
  /* 战斗边界 */
  if (arenaW > W) {
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    if (camX < 4) ctx.fillRect(0, 0, 4, H);
    if (camX > arenaW - W - 4) ctx.fillRect(W - 4, 0, 4, H);
  }
}

class Battle {
  constructor(cfg) {
    this.cfg = cfg; /* 保留完整配置(调试/测试接口,如 battle.cfg.waveInfo) */
    this.mode = cfg.mode;
    this.theme = cfg.theme || 'arena';
    this.arenaW = cfg.arenaW || 1400;
    arenaW = this.arenaW;
    this.fighters = [];
    this.time = 0;
    this.ended = false;
    this.win = false;
    this.playerCombo = 0;
    this.comboT = 0;
    this.announceT = 0;
    this.announceSeq = [];
    this.onEnd = cfg.onEnd || function () { };
    this.waveInfo = cfg.waveInfo || '';
    this.isBossWave = !!cfg.bossWave;
    this.cg = null; /* 大招 CG 演出 */
    this.netFx = []; /* 局域网联机:待广播事件 */
    /* 队伍 */
    this.player = null;
    this.p2 = null;
    this.playerInputs = [null, null];
    const allies = cfg.allies || [];
    const enemies = cfg.enemies || [];
    const heroOf = heroById;
    const mkHero = (h, team, opts) => {
      const f = new Fighter(h, team, opts);
      f.skillList = h.skills.slice();
      for (const s of f.skillList) f.skillCds[s.key] = 0;
      /* 装备属性挂载 */
      if (h.gear) {
        f.critBonus = h.gear.crit || 0;
        f.lifesteal = h.gear.lifesteal || 0;
        f.slowOnHit = h.gear.slowOnHit || 0;
        f.gearArmor = h.gear.armor || 0;
        f.weaponColor = h.gear.color || null;
        if (h.gear.startQi) f.qi = Math.min(100, Math.max(f.qi || 0, h.gear.startQi));
        if (h.gear.transformTime) f.maxTransformT = 10 + h.gear.transformTime;
      }
      return f;
    };
    if (cfg.heroId) {
      const h = applyGear(heroUpgraded(heroOf(cfg.heroId)));
      this.player = mkHero(h, 0, { isPlayer: true, name: h.name, hpMult: cfg.playerMult || 1 });
      this.player.playerIdx = 0;
      this.fighters.push(this.player);
      this.playerInputs[0] = { move: 0, attack: false, dash: false, q: false, w: false, r: false, transform: false, blockHeld: false, chargeHeld: false };
    }
    /* 双人对战:P2 玩家(保留英雄本色,非暗影) */
    if (cfg.p2HeroId) {
      const h = applyGear(heroUpgraded(heroOf(cfg.p2HeroId)));
      this.p2 = mkHero(h, 1, { isPlayer: true, name: h.name, hpMult: cfg.playerMult || 1, x: this.arenaW - 200, pvp: true, playerIdx: 1 });
      this.p2.enemy = false;
      this.fighters.push(this.p2);
      this.playerInputs[1] = { move: 0, attack: false, dash: false, q: false, w: false, r: false, transform: false, blockHeld: false, chargeHeld: false };
    }
    for (const a of allies) {
      const base = typeof a === 'string' ? heroOf(a) : a;
      if (!base) continue;
      const h = applyGear(heroUpgraded(base));
      const f = mkHero(h, 0, { name: '盟友·' + h.name, hpMult: (cfg.playerMult || 1) * 0.92, x: 240 + this.fighters.length * 90 });
      this.fighters.push(f);
    }
    let ex = 0;
    for (const e of enemies) {
      let h, def = null;
      if (typeof e === 'string') {
        def = ENEMIES[e] || makeBoss(0);
        if (e === 'boss') def = makeBoss(cfg.bossIdx || 0);
        h = { name: def.name, speed: def.speed, dmg: def.dmg * (cfg.enemyDmgMult || 1), range: def.range, atkT: def.atkT, weapon: def.weapon, color: def.color, ranged: !!def.ranged, hp: def.hp, skills: def.skills, style: def.style };
      } else {
        h = { ...e };
        h.style = { hood: true }; /* 敌方英雄统一披暗影兜帽,与玩家区分 */
      }
      const f = new Fighter(h, 1, {
        name: def ? def.name : ('暗影·' + e.name),
        hpMult: def ? (cfg.enemyHpMult || 1) : (cfg.enemyHpMult || 1) * 1.04,
        def, x: this.arenaW - 200 - ex * 90,
      });
      f.enemy = true;
      this.fighters.push(f);
      ex++;
    }
    this.spawnFX();
    this.announceSeq = cfg.announceSeq || ['战斗开始!'];
  }
  aliveOf(team) { return this.fighters.filter(f => f.team === team && f.koT <= 0); }
  addProj(o) { projs.push(new Proj(o)); }
  startCG(name, color, x, y) {
    this.cg = { name, color, x, y, t: 1.1, dur: 1.1 };
    netFx({ t: 'cg', name, color, x, y });
  }
  spawnFX() {
    for (const f of this.fighters) {
      burst(f.x, f.y - 50, 16, f.pvp ? '#5a9aff' : (f.enemy ? '#ff5a5a' : '#7dffa8'), 240, 'dot', 0.6);
      if (f.isPlayer) f.invulnT = Math.max(f.invulnT, 0.8);
    }
  }
  dealHit(att, tgt, raw, o) {
    if (tgt.koT > 0 || tgt.invulnT > 0) return;
    o = o || {};
    let dmg = raw * (att ? att.transformMul() : 1);
    let crit = Math.random() < (0.12 + (att ? att.critBonus : 0));
    if (crit) dmg *= 1.6;
    /* 死亡标记:被标记者受到额外伤害 */
    if (tgt.markT > 0 && att) dmg *= 1.35;
    let blocked = false, broke = false;
    if (tgt.state === 'block') {
      if (o.breakBlock || (att && att.transforming)) {
        tgt.state = 'blockbroken'; tgt.stateT = 0; broke = true; dmg *= 0.4;
        addFloat(tgt.x, tgt.y - 130, '破防!', '#ff6a6a', 17);
        flashAt(tgt.x, tgt.y - 66, '#ffd94d', 14);
        for (let i = 0; i < 8; i++) {
          spawnPart({ x: tgt.x + rand(-16, 16), y: tgt.y - rand(40, 90), vx: rand(-160, 160), vy: rand(-220, -40), life: rand(0.35, 0.7), size: rand(2, 4), color: '#ffd94d', type: 'shard', grav: 600, rot: Math.random() * TAU, spin: rand(-9, 9) });
        }
      } else { blocked = true; dmg *= 0.22; }
      ringAt(tgt.x + (o.dir || 1) * 18, tgt.y - 66, 'rgba(122,215,255,.8)', 26, 0.3);
      hitSpark(tgt.x + (o.dir || 1) * 22, tgt.y - 66, (o.dir || 1) > 0 ? 0 : Math.PI, '#9ad8ff', false);
      SFX.block();
    }
    if (tgt.def && tgt.def.armor) dmg *= 1 - tgt.def.armor;
    if (tgt.shieldT > 0) dmg *= 0.75;
    if (tgt.auraT > 0) dmg *= 0.75; /* 守护光环减伤 */
    if (tgt.gearArmor > 0) dmg *= 1 - tgt.gearArmor;
    dmg = Math.max(1, Math.round(dmg));
    tgt.hp -= dmg;
    tgt.hitFlash = 0.14;
    tgt.dmgTaken += dmg;
    if (att) {
      att.dmgDealt += dmg;
      att.qi = Math.min(100, att.qi + (crit ? 8 : 5));
      /* 吸血 */
      if (att.lifesteal > 0 && att.alive) {
        const heal = Math.max(1, Math.round(dmg * att.lifesteal));
        att.hp = Math.min(att.maxHp, att.hp + heal);
        addFloat(att.x, att.y - 120, '+' + heal, '#ff6a8a', 12);
      }
    }
    if (!tgt.transforming) tgt.qi = Math.min(100, tgt.qi + 3);
    /* 击退与硬直 */
    const dir = o.dir !== undefined ? o.dir : (att ? (Math.sign(tgt.x - att.x) || att.facing || 1) : 1);
    tgt.vel.x = dir * (110 + (o.kb || 4) * 30);
    if (tgt.state !== 'block' && !broke) {
      tgt.state = 'hit'; tgt.stateT = 0;
    }
    if (o.slow) tgt.slowT = Math.max(tgt.slowT, 1.5);
    if (att && att.slowOnHit) tgt.slowT = Math.max(tgt.slowT, 1.5);
    /* 特效:火花 + 闪光(暴击加大)+ 冲击环 */
    const col = tgt.hero.color;
    const hx = tgt.x + dir * 14, hy = tgt.y - 62;
    hitSpark(hx, hy, dir, blocked ? '#9ad8ff' : (crit ? '#ffe86a' : col), crit);
    flashAt(hx, hy, crit ? '#ffe86a' : '#ffffff', crit ? 15 : 8);
    if (crit) ringAt(hx, hy, '#ffe86a', 40, 0.28);
    if (o.shake) { shakeT = Math.max(shakeT, 0.18); shakeM = Math.max(shakeM, o.shake); netFx({ t: 'shake', mag: o.shake }); }
    if (att && att.isPlayer) {
      this.playerCombo++;
      this.comboT = 1.2;
    }
    addFloat(tgt.x, tgt.y - 138 * tgt.scale, String(dmg), blocked ? '#9ad8ff' : (crit ? '#ffe86a' : '#fff'), crit ? 22 : 15);
    if (blocked) addFloat(tgt.x, tgt.y - 112, '格挡', '#9ad8ff', 11);
    if (crit) { SFX.crit(); netFx({ t: 'sfx', n: 'crit' }); }
    else if (blocked) { SFX.block(); netFx({ t: 'sfx', n: 'block' }); }
    else { SFX.hit(); netFx({ t: 'sfx', n: 'hit' }); }
    if (tgt.hp <= 0) tgt.die(att);
  }
  aoe(x, y, r, dmg, owner, o) {
    o = o || {};
    for (const f of this.aliveOf(1 - owner.team)) {
      const dx = f.x - x, dy = (f.y - 50) - y;
      if (dx * dx + dy * dy < (r + f.scale * 14) * (r + f.scale * 14)) {
        this.dealHit(owner, f, dmg, { kb: o.kb || 8, dir: Math.sign(f.x - owner.x) || 1, shake: o.shake || 0, slow: o.slow || 0 });
      }
    }
    burst(x, y, 14, o.color || owner.hero.color, 240, 'dot', 0.4);
    if (o.ring !== false) {
      ringAt(x, y, o.color || owner.hero.color, r * 1.7, 0.35);
    }
    if (o.fire) fireBoom(x, y, 0.8);
    if (o.ice) iceBurst(x, y, 10);
    if (o.elec) boltAt(x, y, '#ffe86a', 3);
    if (o.spark) hitSpark(x, y, 0, '#ffd94d', true);
  }
  announce(text) {
    netFx({ t: 'msg', text });
    const el = $('announce');
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
  update(dt) {
    if (this.ended) {
      /* 结算期间:粒子/飘字/预告继续飘动 */
      this.updateFx(dt);
      return;
    }
    this.time += dt;
    /* 连击计时 */
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.playerCombo = 0;
      const cEl = $('combo');
      if (this.playerCombo >= 2) {
        cEl.textContent = '🔥 ' + this.playerCombo + ' 连击!';
        cEl.classList.remove('pop');
        void cEl.offsetWidth;
        cEl.classList.add('pop');
      }
    }
    /* 公告序列 */
    if (this.announceSeq.length) {
      this.announceT -= dt;
      if (this.announceT <= 0) {
        this.announce(this.announceSeq.shift());
        this.announceT = 2.2;
      }
    }
    for (const f of this.fighters) f.update(dt, this);
    /* 战斗者软碰撞:互相推开,防止重叠滑行 */
    const fs = this.fighters.filter(f => f.koT <= 0);
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i], b = fs[j];
        const min = 17 * (a.scale + b.scale);
        const dx = b.x - a.x;
        if (Math.abs(dx) < min) {
          const push = (min - Math.abs(dx)) / 2;
          const dir = dx === 0 ? (a.facing || 1) : Math.sign(dx);
          if (a.state !== 'dash') a.x -= dir * push;
          if (b.state !== 'dash') b.x += dir * push;
        }
      }
    }
    for (const f of this.fighters) f.x = clamp(f.x, 34 * f.scale, arenaW - 34 * f.scale);
    for (let i = projs.length - 1; i >= 0; i--) {
      projs[i].update(dt, this);
      if (projs[i].life <= 0) projs.splice(i, 1);
    }
    this.updateFx(dt);
    /* 主题环境粒子:落叶/灰烬/飘雪/沙尘 */
    if (Math.random() < dt * 6) {
      const ex = camX + Math.random() * W;
      switch (this.theme) {
        case 'forest':
          spawnPart({ x: ex, y: -10, vx: rand(-22, 22), vy: rand(30, 60), life: rand(4, 7), size: rand(2.5, 4), color: Math.random() < 0.5 ? '#5a9a4a' : '#7ab86a', type: 'leaf', grav: 12, rot: Math.random() * TAU, spin: rand(-3, 3), sway: 14 });
          break;
        case 'volcano':
          spawnPart({ x: ex, y: -10, vx: rand(-15, 15), vy: rand(20, 45), life: rand(3, 6), size: rand(2, 4), color: 'rgba(60,45,40,.55)', type: 'ash', sway: 6 });
          if (Math.random() < 0.3) spawnPart({ x: ex, y: -10, vx: rand(-10, 10), vy: rand(-40, -10), life: rand(1, 2), size: rand(1.5, 3), color: '#ff8a2a', type: 'ember', flicker: true });
          break;
        case 'frost':
          spawnPart({ x: ex, y: -10, vx: rand(-15, 15), vy: rand(35, 70), life: rand(4, 7), size: rand(1.5, 3), color: 'rgba(220,240,255,.85)', type: 'snow', sway: 10 });
          break;
        case 'castle':
          spawnPart({ x: ex, y: -10, vx: rand(-12, 12), vy: rand(15, 35), life: rand(3, 5), size: rand(2, 4), color: 'rgba(140,110,190,.4)', type: 'ash', sway: 8 });
          break;
        case 'tour':
          if (Math.random() < 0.5) spawnPart({ x: ex, y: -10, vx: rand(-8, 8), vy: rand(20, 40), life: rand(2, 4), size: rand(1.5, 2.5), color: Math.random() < 0.5 ? '#ffd94d' : '#ffe9a8', type: 'star', rot: Math.random() * TAU, spin: rand(-4, 4) });
          break;
        default:
          if (Math.random() < 0.4) spawnPart({ x: ex, y: -10, vx: rand(-20, 20), vy: rand(25, 50), life: rand(2, 4), size: rand(1.5, 3), color: 'rgba(190,160,110,.35)', type: 'ash', sway: 8 });
      }
    }
    /* 相机:双人模式跟随两玩家中点,保证双方都可见 */
    let want;
    if (this.p2 && this.p2.alive) {
      const a = this.player.x, b = this.p2.x;
      const mn = Math.min(a, b), mx = Math.max(a, b);
      want = (a + b) / 2 - W / 2;
      want = clamp(want, mn - 140, mx + 140 - W);
      want = clamp(want, 0, Math.max(0, this.arenaW - W));
    } else {
      const target = this.player ? this.player.x : (this.fighters.length ? this.fighters[0].x : W / 2);
      want = clamp(target - W * 0.42, 0, Math.max(0, this.arenaW - W));
    }
    camX = lerp(camX, want, Math.min(1, dt * 5));
    if (shakeT > 0) shakeT -= dt;
    /* 大招 CG 计时 */
    if (this.cg) {
      this.cg.t -= dt;
      if (this.cg.t <= 0) this.cg = null;
    }
    /* 胜负判定 */
    this.checkEnd();
  }
  updateFx(dt) { globalFxTick(dt); } /* 保留方法别名,内部复用全局特效更新 */
  checkEnd() {
    if (this.ended) return;
    const foes = this.aliveOf(1);
    const allies = this.aliveOf(0);
    if (foes.length === 0) {
      this.endBattle(true);
    } else if (allies.length === 0) {
      this.endBattle(false);
    }
  }
  endBattle(win) {
    if (this.ended) return;
    this.ended = true;
    this.win = win;
    this.endFired = false;
    setTimeout(() => this.fireEnd(), 900);
  }
  fireEnd() {
    if (this.endFired) return;
    if (currentBattle !== this) return;
    this.endFired = true;
    /* 收尾:清连击文本,解除残留变身特效(否则结束画面上还飘着金焰) */
    this.comboT = 0; this.playerCombo = 0;
    const cEl = $('combo'); if (cEl) cEl.textContent = '';
    for (const f of this.fighters) {
      if (f.transforming) { f.transforming = false; f.transformT = 0; }
    }
    if (this.win) SFX.victory(); else SFX.defeat();
    /* 结算特效:胜利金色喷泉烟花 / 失败灰蓝飘尘 */
    if (this.win) {
      for (let i = 0; i < 44; i++) {
        spawnPart({
          x: camX + rand(80, W - 80), y: GROUND_Y + 10,
          vx: rand(-36, 36), vy: rand(-430, -260),
          life: rand(0.9, 1.6), size: rand(2.5, 4.5),
          color: ['#ffd94d', '#fff3c4', '#ff9a00', '#ffe86a', '#fff'][randi(0, 4)],
          type: 'star', grav: 460, rot: Math.random() * TAU, spin: rand(-5, 5),
        });
      }
      for (let i = 0; i < 16; i++) {
        ringAt(camX + Math.random() * W, GROUND_Y - Math.random() * 130, Math.random() < 0.5 ? '#ffd94d' : '#ffe86a', rand(28, 60), 0.5);
      }
      starBurst(camX + W * 0.3, GROUND_Y - 120, 14);
      starBurst(camX + W * 0.7, GROUND_Y - 140, 14);
    } else {
      for (let i = 0; i < 28; i++) {
        spawnPart({ x: camX + Math.random() * W, y: Math.random() * H * 0.5, vx: rand(-12, 12), vy: rand(10, 32), life: rand(2, 3.5), size: rand(2, 4), color: 'rgba(120,130,160,.4)', type: 'ash', sway: 8 });
      }
      for (let i = 0; i < 10; i++) {
        spawnPart({ x: camX + Math.random() * W, y: GROUND_Y - Math.random() * 100, vx: rand(-20, 20), vy: rand(-60, -20), life: rand(0.6, 1.2), size: rand(1.5, 3), color: 'rgba(150,160,190,.5)', type: 'ember', grav: 40 });
      }
    }
    /* 战斗统计(成就) */
    const pDmg = this.player ? this.player.dmgDealt : 0;
    save.stats.kills = (save.stats.kills || 0) + (this.player ? this.player.kills : 0);
    save.stats.maxDmg = Math.max(save.stats.maxDmg || 0, Math.round(pDmg));
    save.stats.maxCombo = Math.max(save.stats.maxCombo || 0, this.playerCombo);
    save.stats.transforms = (save.stats.transforms || 0) + (this.player ? (this.player.transformCount || 0) : 0);
    if (this.mode === 'pvp') save.stats.pvpGames = (save.stats.pvpGames || 0) + 1;
    writeSave();
    checkAchievements();
    trackDailyProgress(this);
    this.onEnd(this.win, {
      time: this.time,
      dmg: Math.round(pDmg),
      kills: this.player ? this.player.kills : 0,
      combo: this.playerCombo,
      hp: this.player ? this.player.hp : 0,
    });
  }
  draw() {
    drawBackground(this.theme);
    /* 相机震动 */
    ctx.save();
    if (shakeT > 0) {
      ctx.translate(rand(-shakeM, shakeM) * 9, rand(-shakeM, shakeM) * 6);
    }
    /* 预告 */
    for (const tg of telegraphs) {
      const p = 1 - tg.t / tg.dur;
      ctx.strokeStyle = tg.color;
      ctx.globalAlpha = 0.45 + Math.sin(p * 20) * 0.3;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(tg.x - camX, tg.y, tg.r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(tg.x - camX, tg.y, tg.r * p, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const sorted = this.fighters.slice().sort((a, b) => a.y - b.y);
    for (const f of sorted) f.draw();
    for (const p of projs) p.draw();
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a * (p.flicker ? (0.55 + Math.sin(p.life * 28) * 0.45) : 1);
      const sx = p.sway ? p.x - camX + Math.sin(p.life * 5 + p.y * 0.03) * p.sway : p.x - camX;
      switch (p.type) {
        case 'ring': {
          const pr = p.size * (1 - a) * 2.2;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 4 * a;
          ctx.beginPath(); ctx.arc(sx, p.y, Math.max(2, pr), 0, TAU); ctx.stroke();
          break;
        }
        case 'dot': {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, p.y, Math.max(0.5, p.size * a), 0, TAU); ctx.fill();
          break;
        }
        case 'spark': {
          const l = p.size * 3.2 * a;
          const v = Math.hypot(p.vx, p.vy) || 1;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.8 * a);
          ctx.beginPath();
          ctx.moveTo(sx - p.vx / v * l, p.y - p.vy / v * l);
          ctx.lineTo(sx + p.vx / v * l * 0.6, p.y + p.vy / v * l * 0.6);
          ctx.stroke();
          break;
        }
        case 'flash': {
          const s = p.size * (0.5 + a * 0.5);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5 * a + 0.5;
          ctx.beginPath();
          ctx.moveTo(sx - s, p.y); ctx.lineTo(sx + s, p.y);
          ctx.moveTo(sx, p.y - s); ctx.lineTo(sx, p.y + s);
          ctx.stroke();
          break;
        }
        case 'ember': {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, p.y, Math.max(0.5, p.size * a), 0, TAU); ctx.fill();
          const g = ctx.createRadialGradient(sx, p.y, 0.5, sx, p.y, p.size * 2.2);
          g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(255,140,40,0)');
          ctx.globalAlpha *= 0.35;
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sx, p.y, p.size * 2.2, 0, TAU); ctx.fill();
          break;
        }
        case 'ice': {
          ctx.save();
          ctx.translate(sx, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(p.size * 1.4, 0); ctx.lineTo(0, -p.size * 0.8); ctx.lineTo(-p.size * 1.1, 0); ctx.lineTo(0, p.size * 0.8);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case 'star': {
          ctx.save();
          ctx.translate(sx, p.y); ctx.rotate(p.rot);
          const s = p.size * a;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 === 0 ? s * 1.6 : s * 0.6;
            const ang = i * Math.PI / 4;
            if (i === 0) ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
            else ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
          }
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case 'smoke': {
          const r = p.size * (1 + (1 - a) * 1.6);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, p.y, Math.max(0.5, r), 0, TAU); ctx.fill();
          break;
        }
        case 'trail': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.9 * a);
          ctx.beginPath();
          ctx.moveTo(sx - p.vx * 0.06, p.y - p.vy * 0.06);
          ctx.lineTo(sx, p.y);
          ctx.stroke();
          break;
        }
        case 'shard': {
          ctx.save();
          ctx.translate(sx, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(p.size * 1.3, 0); ctx.lineTo(p.size * 0.4, -p.size * 0.7); ctx.lineTo(-p.size * 0.9, 0); ctx.lineTo(p.size * 0.2, p.size * 0.8);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case 'leaf': {
          ctx.save();
          ctx.translate(sx, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, TAU); ctx.fill();
          ctx.restore();
          break;
        }
        case 'snow': {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, p.y, Math.max(0.5, p.size * a), 0, TAU); ctx.fill();
          break;
        }
        case 'ash': {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, p.y, Math.max(0.4, p.size * a * 0.8), 0, TAU); ctx.fill();
          break;
        }
        case 'bolt': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 * a;
          let cx = sx, cy = p.y;
          ctx.beginPath(); ctx.moveTo(cx, cy);
          for (let i = 0; i < 3; i++) {
            cx += p.vx * 0.16 + rand(-9, 9);
            cy += p.vy * 0.16 + rand(-9, 9);
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
          break;
        }
        default: {
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx, p.y, p.size * a, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    for (const ft of floats) {
      ctx.globalAlpha = clamp(ft.life / ft.max, 0, 1);
      ctx.fillStyle = ft.color;
      ctx.font = `bold ${ft.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, ft.x - camX, ft.y);
      ctx.fillText(ft.text, ft.x - camX, ft.y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    /* 暗角 */
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    /* ===== 大招 CG 演出 ===== */
    if (this.cg) {
      const cg = this.cg;
      const p = 1 - cg.t / cg.dur;
      const env = Math.sin(Math.min(1, p * 2.4) * Math.PI);
      /* 暗色覆盖 */
      ctx.fillStyle = `rgba(4,4,14,${0.5 * env})`;
      ctx.fillRect(0, 0, W, H);
      /* 角色位置放射光晕 */
      const sx = cg.x - camX;
      const rad = 100 + Math.sin(p * 10) * 10;
      const g = ctx.createRadialGradient(sx, cg.y, 10, sx, cg.y, rad);
      g.addColorStop(0, cg.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.4 * env;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, cg.y, rad, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      /* 角色放大剪影 */
      if (this.player) {
        this.player.drawGhost(sx, cg.y + 12, this.player.facing, 2.1 + p * 0.5, cg.color);
      }
      /* 技能名大字 */
      ctx.font = `900 ${40 + Math.sin(p * 9) * 5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.lineWidth = 7;
      const ty = 96 + p * 14;
      ctx.strokeText(cg.name, W / 2, ty);
      ctx.fillStyle = cg.color;
      ctx.fillText(cg.name, W / 2, ty);
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillText('— DRAGON ULTIMATE —', W / 2, ty + 26);
      /* 冲击环 */
      ctx.strokeStyle = cg.color;
      ctx.lineWidth = 3.5 * (1 - p * 0.6);
      ctx.beginPath(); ctx.arc(W / 2, H / 2 + 80, 50 + p * 330, 0, TAU); ctx.stroke();
      /* 星尘 */
      if (Math.random() < 0.6) {
        starBurst(W / 2 + rand(-140, 140), H / 2 + rand(-60, 80), 3, [cg.color, '#fff']);
      }
    }
  }
}

/* ---------------- 全局状态 ---------------- */
let currentBattle = null;
let lastCfg = null;
let heroSel = HEROES[0].id;
let paused = false;
let save = { story: 0, tourBest: 0, vsWins: 0, econ: { gold: 0, up: {} }, diff: { 0: 0, 1: 0, 2: 0, 3: 0 }, stats: {}, achs: {}, survBest: 0, gear: { weapon: 0, armor: 0, trinket: 0, owned: {} }, daily: { date: '', tasks: [], done: [] } };

/* ================ 用户登录系统 ================
   本地账号:用户名 + 密码(加盐哈希),每个账号独立存档。
   单机 localStorage 保护(非安全级),用于多用户隔离与存档私有。 */
let authUser = null; /* 当前登录用户名 */
function saveKey() { return 'sdb_save' + (authUser ? '_' + authUser : ''); }
function usersDB() {
  try { const u = JSON.parse(localStorage.getItem('sdb_users') || '{}'); return (u && typeof u === 'object' && !Array.isArray(u)) ? u : {}; } catch (e) { return {}; }
}
function writeUsers(u) { try { localStorage.setItem('sdb_users', JSON.stringify(u)); } catch (e) { } }
function hashPw(pw, salt) {
  /* 加盐双哈希(FNV-1a 变体,纯 JS 同步,不依赖 WebCrypto) */
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = salt + '|' + pw + '|龙之战';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).slice(0, 32);
}
function authRegister(user, pw, pw2) {
  const name = (user || '').trim();
  if (!/^[\w\u4e00-\u9fa5]{2,12}$/.test(name)) return { ok: false, reason: 'badname', msg: '用户名需 2-12 位(中文/字母/数字/下划线)' };
  if (!pw || pw.length < 4) return { ok: false, reason: 'shortpw', msg: '密码至少 4 位' };
  if (pw2 !== undefined && pw !== pw2) return { ok: false, reason: 'mismatch', msg: '两次密码不一致' };
  const users = usersDB();
  if (users[name]) return { ok: false, reason: 'exists', msg: '该用户名已存在,请直接登录' };
  const salt = Math.random().toString(36).slice(2, 10);
  users[name] = { salt, hash: hashPw(pw, salt), created: Date.now() };
  writeUsers(users);
  /* 首次注册:把旧版本地存档迁移到新账号,老玩家进度不丢失 */
  try {
    const legacy = localStorage.getItem('sdb_save');
    if (legacy && !localStorage.getItem('sdb_save_' + name)) {
      localStorage.setItem('sdb_save_' + name, legacy);
      localStorage.removeItem('sdb_save');
    }
  } catch (e) { }
  authUser = name;
  try { localStorage.setItem('sdb_session', name); } catch (e) { }
  loadSave();
  return { ok: true };
}
function authLogin(user, pw) {
  const name = (user || '').trim();
  const u = usersDB()[name];
  if (!u) return { ok: false, reason: 'nouser', msg: '用户不存在,请先注册' };
  if (!pw || u.hash !== hashPw(pw, u.salt)) return { ok: false, reason: 'badpw', msg: '密码错误' };
  authUser = name;
  try { localStorage.setItem('sdb_session', name); } catch (e) { }
  loadSave();
  return { ok: true };
}
function authLogout() {
  authUser = null;
  try { localStorage.removeItem('sdb_session'); } catch (e) { }
  loadSave(); /* 回到默认存档视图 */
  const ub = $('userBadge'); if (ub) ub.textContent = '👤 未登录';
  refreshGoldUI();
  showScreen('scrLogin');
  SFX.ui();
}
function authEnterMain() {
  const ub = $('userBadge'); if (ub) ub.textContent = '👤 ' + authUser;
  refreshGoldUI();
  showScreen('scrMain');
}
function authTryLogin() {
  const r = authLogin($('authUser').value, $('authPw').value);
  const el = $('authErr');
  if (r.ok) { el.textContent = '✅ 欢迎回来,' + authUser + '!'; el.className = 'ok'; authEnterMain(); SFX.victory(); }
  else { el.textContent = '❌ ' + r.msg; el.className = ''; SFX.defeat(); }
}
function authTryRegister() {
  const r = authRegister($('authUser').value, $('authPw').value, $('authPw2').value);
  const el = $('authErr');
  if (r.ok) { el.textContent = '✅ 账号创建成功,欢迎 ' + authUser + '!'; el.className = 'ok'; authEnterMain(); SFX.victory(); }
  else { el.textContent = '❌ ' + r.msg; el.className = ''; SFX.defeat(); }
}
/* 存档净化:任何非法/损坏数据都不会让游戏崩溃 */
function sanObj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
function sanNum(v, d) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : d; }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(saveKey()) || '{}');
    if (s && typeof s === 'object') {
      save.story = sanNum(s.story, 0);
      save.tourBest = sanNum(s.tourBest, 0);
      save.vsWins = sanNum(s.vsWins, 0);
      save.survBest = sanNum(s.survBest, 0);
      const e = sanObj(s.econ);
      save.econ = {
        gold: sanNum(e && e.gold, 0),
        up: sanObj(e && e.up) || {},
      };
      const d = sanObj(s.diff);
      save.diff = { 0: 0, 1: 0, 2: 0, 3: 0 };
      if (d) for (let i = 0; i < 4; i++) save.diff[i] = Math.min(2, sanNum(d[i], 0));
      save.stats = sanObj(s.stats) || {};
      save.achs = sanObj(s.achs) || {};
      const g = sanObj(s.gear);
      save.gear = { weapon: 0, armor: 0, trinket: 0, owned: { weapon: [true], armor: [true], trinket: [true] } };
      if (g) {
        GEAR_SLOTS.forEach(sl => {
          const v = g[sl.key];
          if (typeof v === 'number' && isFinite(v) && v >= 0 && v < GEAR[sl.key].length) save.gear[sl.key] = Math.floor(v);
        });
        const ow = sanObj(g.owned);
        if (ow) {
          GEAR_SLOTS.forEach(sl => {
            if (Array.isArray(ow[sl.key])) save.gear.owned[sl.key] = ow[sl.key].map(Boolean);
          });
        }
      }
      const day = sanObj(s.daily);
      save.daily = { date: '', tasks: [], done: [] };
      if (day) {
        save.daily.date = (typeof day.date === 'string') ? day.date : '';
        save.daily.tasks = Array.isArray(day.tasks)
          ? day.tasks.filter(t => t && typeof t.id === 'string' && typeof t.need === 'number') : [];
        save.daily.done = Array.isArray(day.done) ? day.done.filter(x => typeof x === 'string') : [];
      }
    }
  } catch (e) { }
}
function writeSave() {
  try { localStorage.setItem(saveKey(), JSON.stringify(save)); } catch (e) { }
}

/* ================ 装备系统 ================ */
const GEAR = {
  weapon: [
    { name: '训练木剑', icon: '🗡️', price: 0, desc: '训练用木剑,聊胜于无' },
    { name: '精钢剑', icon: '⚔️', price: 150, atk: 0.08, desc: '攻击 +8%' },
    { name: '烈焰剑', icon: '🔥', price: 400, atk: 0.12, crit: 0.05, desc: '攻击 +12%,暴击 +5%', color: '#ff7a3a' },
    { name: '寒冰剑', icon: '❄️', price: 600, atk: 0.10, slowOnHit: 1, desc: '攻击 +10%,命中减速敌人', color: '#7ad7ff' },
    { name: '龙牙剑', icon: '🐲', price: 1200, atk: 0.18, crit: 0.10, desc: '攻击 +18%,暴击 +10%', color: '#ffd94d' },
  ],
  armor: [
    { name: '皮甲', icon: '🥋', price: 0, desc: '轻便的皮甲' },
    { name: '锁子甲', icon: '⛓️', price: 150, hp: 0.10, desc: '生命 +10%' },
    { name: '秘银甲', icon: '🛡️', price: 400, hp: 0.15, armor: 0.05, desc: '生命 +15%,减伤 5%' },
    { name: '龙鳞甲', icon: '🐉', price: 700, hp: 0.20, armor: 0.10, desc: '生命 +20%,减伤 10%' },
    { name: '圣光甲', icon: '✨', price: 1200, hp: 0.25, armor: 0.12, desc: '生命 +25%,减伤 12%' },
  ],
  trinket: [
    { name: '草鞋', icon: '👟', price: 0, desc: '一双普通的草鞋' },
    { name: '疾风靴', icon: '💨', price: 150, spd: 0.08, desc: '速度 +8%' },
    { name: '气魄珠', icon: '🔮', price: 400, startQi: 30, desc: '战斗开局 +30 气力' },
    { name: '吸血戒指', icon: '🩸', price: 700, lifesteal: 0.05, desc: '攻击吸血 5%' },
    { name: '龙魂坠', icon: '💎', price: 1200, startQi: 100, transformTime: 2, desc: '开局气满,变身时间 +2 秒' },
  ],
};
const GEAR_SLOTS = [
  { key: 'weapon', name: '武器', icon: '⚔️' },
  { key: 'armor', name: '护甲', icon: '🛡️' },
  { key: 'trinket', name: '饰品', icon: '💎' },
];
function gearOwned(slot, idx) {
  const arr = save.gear.owned[slot];
  return Array.isArray(arr) && !!arr[idx];
}
function gearEquipped(slot) {
  /* 防存档损坏:非法槽位索引一律回退到 0 号 */
  const list = GEAR[slot];
  const v = save.gear[slot];
  return typeof v === 'number' && isFinite(v) && v >= 0 && v < list.length ? Math.floor(v) : 0;
}
function applyGear(hero) {
  const h = { ...hero };
  const w = GEAR.weapon[gearEquipped('weapon')];
  const a = GEAR.armor[gearEquipped('armor')];
  const t = GEAR.trinket[gearEquipped('trinket')];
  if (w.atk) h.dmg = Math.round(h.dmg * (1 + w.atk));
  if (a.hp) h.hp = Math.round(h.hp * (1 + a.hp));
  if (t.spd) h.speed = Math.round(h.speed * (1 + t.spd));
  h.gear = {
    crit: (w.crit || 0) + (a.crit || 0) + (t.crit || 0),
    lifesteal: (w.lifesteal || 0) + (a.lifesteal || 0) + (t.lifesteal || 0),
    slowOnHit: (w.slowOnHit || 0) + (t.slowOnHit || 0),
    armor: (w.armor || 0) + (a.armor || 0) + (t.armor || 0),
    startQi: (w.startQi || 0) + (t.startQi || 0),
    transformTime: (w.transformTime || 0) + (t.transformTime || 0),
    color: w.color || null,
  };
  return h;
}
function buyGear(slot, idx) {
  const item = GEAR[slot][idx];
  if (!item) return { ok: false, reason: 'none' };
  if (gearOwned(slot, idx)) return { ok: false, reason: 'owned' };
  if (save.econ.gold < item.price) return { ok: false, reason: 'gold' };
  save.econ.gold -= item.price;
  save.gear.owned[slot] = save.gear.owned[slot] || [];
  save.gear.owned[slot][idx] = true;
  save.gear[slot] = idx;
  save.stats.gearBuy = (save.stats.gearBuy || 0) + 1;
  writeSave();
  checkAchievements();
  return { ok: true, item };
}
function equipGear(slot, idx) {
  if (idx !== 0 && !gearOwned(slot, idx)) return { ok: false, reason: 'notOwned' };
  save.gear[slot] = idx;
  writeSave();
  return { ok: true };
}
let gearSlot = 'weapon';
function showGear() {
  refreshGoldUI();
  renderGear();
  showScreen('scrGear');
  SFX.ui();
}
function renderGear() {
  refreshGoldUI(); /* 购买后金币余额实时刷新 */
  const tabs = $('gearTabs');
  tabs.innerHTML = '';
  GEAR_SLOTS.forEach(s => {
    const el = document.createElement('button');
    el.className = 'upTab' + (s.key === gearSlot ? ' sel' : '');
    el.innerHTML = `${s.icon} ${s.name}`;
    el.onclick = () => { gearSlot = s.key; SFX.ui(); renderGear(); };
    tabs.appendChild(el);
  });
  const list = $('gearList');
  list.innerHTML = '';
  const items = GEAR[gearSlot];
  const equipped = gearEquipped(gearSlot);
  items.forEach((it, idx) => {
    const owned = gearOwned(gearSlot, idx);
    const isEq = idx === equipped;
    const row = document.createElement('div');
    row.className = 'gearRow' + (isEq ? ' eq' : '');
    let btnTxt, btnCls = '';
    let btnFn = null;
    if (isEq) { btnTxt = '✓ 装备中'; btnCls = 'max'; }
    else if (owned) { btnTxt = '装备'; btnFn = () => { equipGear(gearSlot, idx); SFX.ui(); renderGear(); }; }
    else {
      btnTxt = it.price > 0 ? `💰 ${it.price}` : '免费';
      if (save.econ.gold < it.price) btnCls = 'poor';
      btnFn = () => {
        const r = buyGear(gearSlot, idx);
        if (r.ok) { SFX.victory(); renderGear(); }
        else SFX.defeat();
      };
    }
    row.innerHTML = `
      <span class="gearIcon">${it.icon}</span>
      <span class="gearInfo"><b>${it.name}</b><br><span class="gearDesc">${it.desc}</span></span>`;
    const btn = document.createElement('button');
    btn.className = 'upBtn ' + btnCls;
    btn.textContent = btnTxt;
    if (btnFn) btn.onclick = btnFn;
    row.appendChild(btn);
    list.appendChild(row);
  });
}

/* ================ 经济系统 ================ */
const UP_MAX = 10;
const UP_STATS = [
  { key: 'hp', name: '生命', icon: '❤️', bonus: 0.05, get: h => h.hp },
  { key: 'atk', name: '攻击', icon: '⚔️', bonus: 0.04, get: h => h.dmg },
  { key: 'spd', name: '速度', icon: '💨', bonus: 0.03, get: h => h.speed },
];
function upCost(lvl) { return Math.round(25 * Math.pow(1.45, lvl) / 5) * 5; } /* 升级到 lvl+1 的费用:25/35/55/75/110/160/230/335/490/705 */
function upLevel(heroId, key) {
  /* 防存档损坏:非法/NaN/负数一律按 0 处理 */
  const v = save.econ.up[heroId] && save.econ.up[heroId][key];
  return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
}
function heroUpgraded(hero) {
  const lvHp = upLevel(hero.id, 'hp'), lvAtk = upLevel(hero.id, 'atk'), lvSpd = upLevel(hero.id, 'spd');
  return {
    ...hero,
    hp: Math.round(hero.hp * (1 + 0.05 * lvHp)),
    dmg: Math.round(hero.dmg * (1 + 0.04 * lvAtk)),
    speed: Math.round(hero.speed * (1 + 0.03 * lvSpd)),
  };
}
function awardGold(n) {
  save.econ.gold += n;
  save.stats.goldEarned = (save.stats.goldEarned || 0) + n;
  writeSave();
  checkAchievements();
  return n;
}
function chapterDiff(idx) {
  /* 防存档损坏:难度只认 0/1/2,非法值回退简单 */
  const d = save.diff[idx];
  return DIFFICULTIES[(typeof d === 'number' && isFinite(d) && d >= 0 && d <= 2) ? Math.floor(d) : 0];
}
function diffGold(n, idx) { return Math.round(n * chapterDiff(idx).gold); }
function buyUpgrade(heroId, key) {
  const lvl = upLevel(heroId, key);
  if (lvl >= UP_MAX) return { ok: false, reason: 'max' };
  const cost = upCost(lvl);
  if (save.econ.gold < cost) return { ok: false, reason: 'gold' };
  save.econ.gold -= cost;
  save.econ.up[heroId] = save.econ.up[heroId] || {};
  save.econ.up[heroId][key] = lvl + 1;
  if (lvl + 1 >= UP_MAX) { save.stats.upgradeMax = (save.stats.upgradeMax || 0) + 1; }
  writeSave();
  checkAchievements();
  return { ok: true, cost };
}
function refreshGoldUI() {
  const amt = save.econ.gold;
  document.querySelectorAll('.goldAmt').forEach(el => { el.textContent = amt; });
}

/* ================ 成就系统 ================ */
const ACHIEVEMENTS = [
  { id: 'story1', icon: '🌲', name: '初入森林', desc: '通关第一章', gold: 60, cond: s => (s.storyCleared || 0) >= 1 },
  { id: 'story2', icon: '🌋', name: '烈焰征服者', desc: '通关第二章', gold: 80, cond: s => (s.storyCleared || 0) >= 2 },
  { id: 'story3', icon: '❄️', name: '寒冰破碎者', desc: '通关第三章', gold: 100, cond: s => (s.storyCleared || 0) >= 3 },
  { id: 'story4', icon: '🏰', name: '龙的传承者', desc: '通关全部章节', gold: 200, cond: s => (s.storyCleared || 0) >= 4 },
  { id: 'nightmare', icon: '🔴', name: '噩梦行者', desc: '在噩梦难度通关任意章节', gold: 150, cond: s => (s.nightmareCleared || 0) >= 1 },
  { id: 'kills100', icon: '⚔️', name: '百人斩', desc: '累计击杀 100 名敌人', gold: 120, cond: s => (s.kills || 0) >= 100 },
  { id: 'kills500', icon: '💀', name: '杀戮机器', desc: '累计击杀 500 名敌人', gold: 300, cond: s => (s.kills || 0) >= 500 },
  { id: 'combo20', icon: '🔥', name: '连击达人', desc: '达成 20 连击', gold: 80, cond: s => (s.maxCombo || 0) >= 20 },
  { id: 'dmg500', icon: '💥', name: '毁灭者', desc: '单场战斗造成 500 伤害', gold: 100, cond: s => (s.maxDmg || 0) >= 500 },
  { id: 'gold2000', icon: '💰', name: '金币猎人', desc: '累计获得 2000 金币', gold: 150, cond: s => (s.goldEarned || 0) >= 2000 },
  { id: 'transform50', icon: '🐉', name: '龙之觉醒', desc: '累计变身 50 次', gold: 120, cond: s => (s.transforms || 0) >= 50 },
  { id: 'upgrade10', icon: '⬆️', name: '强化大师', desc: '任意英雄一项属性升到满级', gold: 100, cond: s => (s.upgradeMax || 0) >= 1 },
  { id: 'gear10', icon: '🛡️', name: '装备收藏家', desc: '购买 10 件装备', gold: 150, cond: s => (s.gearBuy || 0) >= 10 },
  { id: 'vs10', icon: '🏆', name: '常胜将军', desc: '对战模式胜利 10 场', gold: 150, cond: s => (s.vsWins || 0) >= 10 },
  { id: 'tour1', icon: '👑', name: '锦标赛冠军', desc: '夺得锦标赛冠军', gold: 200, cond: s => (s.tourWins || 0) >= 1 },
  { id: 'surv10', icon: '🌊', name: '浪潮冲击', desc: '无尽模式到达第 10 波', gold: 150, cond: s => (s.survBest || 0) >= 10 },
  { id: 'pvp1', icon: '🤜', name: '对决者', desc: '完成一场双人对战', gold: 60, cond: s => (s.pvpGames || 0) >= 1 },
];
function checkAchievements() {
  let gained = false;
  ACHIEVEMENTS.forEach(a => {
    if (save.achs[a.id]) return;
    if (a.cond(save.stats)) {
      save.achs[a.id] = true;
      const gold = awardGold(a.gold);
      writeSave();
      showAchievementToast(a, gold);
      gained = true;
      SFX.victory();
    }
  });
  return gained;
}
function showAchievementToast(a, gold) {
  const el = $('achToast');
  el.innerHTML = `🏆 成就达成 <b>${a.name}</b> ${a.icon}<br><span style="font-size:13px;">${a.desc} · 💰 +${gold}</span>`;
  el.classList.add('show');
  clearTimeout(showAchievementToast._t);
  showAchievementToast._t = setTimeout(() => el.classList.remove('show'), 3600);
}

/* ================ 每日任务 ================ */
const DAILY_POOL = [
  { id: 'win_story', name: '故事胜利', icon: '🗡️', need: 2, gold: 80 },
  { id: 'win_vs', name: '对战胜利', icon: '⚔️', need: 1, gold: 60 },
  { id: 'surv5', name: '无尽到达第 5 波', icon: '🌊', need: 5, gold: 80 },
  { id: 'combo15', name: '达成 15 连击', icon: '🔥', need: 15, gold: 60 },
  { id: 'transform3', name: '变身 3 次', icon: '🐉', need: 3, gold: 60 },
  { id: 'kills20', name: '击杀 20 敌人', icon: '💀', need: 20, gold: 80 },
  { id: 'boss1', name: '击败 BOSS', icon: '🐲', need: 1, gold: 100 },
];
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function refreshDaily() {
  const today = todayStr();
  if (save.daily.date === today && save.daily.tasks && save.daily.tasks.length === 3) return;
  const pool = DAILY_POOL.slice();
  const picked = [];
  while (picked.length < 3 && pool.length) picked.push(pool.splice(randi(0, pool.length - 1), 1)[0]);
  save.daily = { date: today, tasks: picked.map(p => ({ id: p.id, cur: 0, need: p.need })), done: [] };
  writeSave();
}
function trackDailyProgress(battle) {
  refreshDaily();
  const t = save.daily.tasks;
  if (!t || !t.length) return;
  const add = (id, n) => { const tk = t.find(x => x.id === id); if (tk) tk.cur = Math.min(tk.need, tk.cur + (n || 0)); };
  const setMax = (id, v) => { const tk = t.find(x => x.id === id); if (tk) tk.cur = Math.min(tk.need, Math.max(tk.cur, v || 0)); };
  if (battle.mode === 'story') {
    if (battle.win) add('win_story', 1);
    if (battle.win && battle.isBossWave) add('boss1', 1);
  }
  if (battle.mode === 'vs' && battle.win) add('win_vs', 1);
  if (battle.mode === 'surv') setMax('surv5', survState ? survState.wave : 0);
  setMax('combo15', battle.playerCombo);
  add('transform3', battle.player ? (battle.player.transformCount || 0) : 0);
  add('kills20', battle.player ? battle.player.kills : 0);
  writeSave();
}
function claimDaily(i) {
  refreshDaily();
  const t = save.daily.tasks[i];
  if (!t) return { ok: false, reason: 'none' };
  if (save.daily.done[i]) return { ok: false, reason: 'done' };
  const tpl = DAILY_POOL.find(p => p.id === t.id);
  if (!tpl) return { ok: false, reason: 'none' };
  if (t.cur < t.need) return { ok: false, reason: 'unfinished' };
  save.daily.done[i] = true;
  const gold = awardGold(tpl.gold);
  writeSave();
  return { ok: true, gold };
}
function showDaily() {
  refreshDaily();
  refreshGoldUI();
  renderDaily();
  showScreen('scrDaily');
  SFX.ui();
}
function renderDaily() {
  refreshGoldUI(); /* 领取后金币余额实时刷新 */
  $('dailyDate').textContent = '📅 今日任务 · ' + save.daily.date;
  const list = $('dailyList');
  list.innerHTML = '';
  save.daily.tasks.forEach((t, i) => {
    const tpl = DAILY_POOL.find(p => p.id === t.id);
    if (!tpl) return;
    const done = !!save.daily.done[i];
    const complete = t.cur >= t.need;
    const row = document.createElement('div');
    row.className = 'dailyRow' + (complete ? ' ready' : '') + (done ? ' done' : '');
    row.innerHTML = `
      <span class="dIcon">${done ? '✅' : tpl.icon}</span>
      <span class="dInfo"><b>${tpl.name}</b><br><span class="dBar"><i style="width:${Math.min(100, t.cur / t.need * 100)}%"></i></span></span>
      <span class="dProg">${Math.min(t.cur, t.need)}/${t.need}</span>
      <span class="dGold">💰 ${tpl.gold}</span>`;
    const btn = document.createElement('button');
    btn.className = 'upBtn ' + (done ? 'max' : (complete ? '' : 'poor'));
    btn.textContent = done ? '已领取' : (complete ? '领取' : '进行中');
    if (complete && !done) {
      btn.onclick = () => { const r = claimDaily(i); if (r.ok) { SFX.victory(); renderDaily(); } };
    }
    row.appendChild(btn);
    list.appendChild(row);
  });
}
function renderAchievements() {
  const list = $('achList');
  list.innerHTML = '';
  const got = Object.keys(save.achs).length;
  ACHIEVEMENTS.forEach(a => {
    const done = !!save.achs[a.id];
    const row = document.createElement('div');
    row.className = 'achRow' + (done ? ' done' : '');
    row.innerHTML = `
      <span class="achIcon">${done ? a.icon : '🔒'}</span>
      <span class="achInfo"><b>${a.name}</b><br><span class="achDesc">${a.desc}</span></span>
      <span class="achGold">💰 ${a.gold}</span>
      <span class="achSt">${done ? '✅' : '未达成'}</span>`;
    list.appendChild(row);
  });
  $('achCount').textContent = `🏆 成就 ${got}/${ACHIEVEMENTS.length}`;
}
function showAchievements() {
  refreshGoldUI();
  renderAchievements();
  showScreen('scrAch');
  SFX.ui();
}

/* ---------------- 模式流程 ---------------- */
let storyState = null;
let tourState = null;

function startStoryMode(heroId, chapterIdx) {
  storyState = { heroId, chapterIdx, waveIdx: 0, boss: false };
  showStoryIntro();
}
function showStoryIntro() {
  const ch = CHAPTERS[storyState.chapterIdx];
  const lines = ch.intro.slice();
  showStoryScreen(ch.name, lines, () => beginStoryWave());
}
function showStoryOutro(gold) {
  const ch = CHAPTERS[storyState.chapterIdx];
  const lines = ch.outro.slice();
  if (gold) lines.push('💰 通关奖励 +' + gold + ' 金币!');
  save.story = Math.max(save.story, storyState.chapterIdx + 1);
  writeSave();
  showStoryScreen(ch.name + ' · 通关!', lines, () => {
    if (storyState.chapterIdx >= CHAPTERS.length - 1) {
      showResult(true, {
        title: '🎉 你拯救了世界!',
        stats: '你击败了暗影巨龙,成为了传说!<br>通关所有章节!',
        buttons: [{ label: '🏠 返回主菜单', cls: '', fn: toMainMenu }],
      });
    } else {
      showChapterScreen();
    }
  }, true);
}
function beginStoryWave() {
  const ch = CHAPTERS[storyState.chapterIdx];
  const isBoss = storyState.boss;
  const waveIdx = storyState.waveIdx;
  const diff = chapterDiff(storyState.chapterIdx);
  let enemies;
  if (isBoss) {
    enemies = ['boss'];
  } else {
    enemies = ch.waves[waveIdx] || ['grunt'];
  }
  const cfg = {
    mode: 'story', theme: ch.theme, arenaW: 1400,
    heroId: storyState.heroId,
    allies: [],
    enemies,

    playerMult: 1,
    enemyHpMult: (1 + storyState.chapterIdx * 0.35) * diff.hp,
    enemyDmgMult: (1 + storyState.chapterIdx * 0.16) * diff.dmg,
    bossIdx: storyState.chapterIdx,
    bossWave: isBoss,
    playerStartHpPct: (function () { const v = storyState.nextHpPct; storyState.nextHpPct = undefined; return v; })(),
    waveInfo: `${diff.icon} ${ch.name}${isBoss ? ' · 首领战' : ' · 第' + (waveIdx + 1) + '波'}(${diff.name})`,
    announceSeq: isBoss ? ['⚠️ 首领来袭!', '暗影巨龙 登场!'] : ['第 ' + (waveIdx + 1) + ' 波!'],
    onEnd: (win, stats) => {
      if (win) {
        if (isBoss) {
          let gold = awardGold(diffGold(50 + storyState.chapterIdx * 20, storyState.chapterIdx));
          const firstClear = storyState.chapterIdx >= save.story;
          if (firstClear) gold += awardGold(diffGold(50, storyState.chapterIdx));
          save.stats.storyCleared = Math.max(save.stats.storyCleared || 0, storyState.chapterIdx + 1);
          if (save.diff[storyState.chapterIdx] === 2) save.stats.nightmareCleared = (save.stats.nightmareCleared || 0) + 1;
          writeSave();
          showStoryOutro(gold);
        } else {
          const gold = awardGold(diffGold(25 + storyState.chapterIdx * 15, storyState.chapterIdx));
          if (storyState.waveIdx + 1 >= ch.waves.length) {
            storyState.waveIdx = 0; storyState.boss = true;
          } else storyState.waveIdx++;
          /* 波间恢复 35%:延续到下一波 */
          if (currentBattle && currentBattle.player) {
            storyState.nextHpPct = Math.min(1, (currentBattle.player.hp + currentBattle.player.maxHp * 0.35) / currentBattle.player.maxHp);
          }
          showResult(true, {
            title: '✅ 胜利!',
            gold,
            stats: `用时 ${stats.time.toFixed(1)}s · 伤害 ${stats.dmg} · 击杀 ${stats.kills} · 最大连击 ${stats.combo}`,
            buttons: [
              { label: '⚔️ 下一波', cls: '', fn: beginStoryWave },
              { label: '🏠 主菜单', cls: 'dark', fn: toMainMenu },
            ],
          });
        }
      } else {
        const gold = awardGold(5);
        showResult(false, {
          title: '💀 败北…',
          gold,
          stats: `用时 ${stats.time.toFixed(1)}s · 伤害 ${stats.dmg} · 最大连击 ${stats.combo}`,
          buttons: [
            { label: '🔄 重新挑战', cls: '', fn: beginStoryWave },
            { label: '🏠 主菜单', cls: 'dark', fn: toMainMenu },
          ],
        });
      }
    },
  };
  launchBattle(cfg);
}

function startVersusMode(heroId) {
  const others = HEROES.filter(h => h.id !== heroId);
  const pick2 = [];
  const pool = others.slice();
  while (pick2.length < 2 && pool.length) pick2.push(pool.splice(randi(0, pool.length - 1), 1)[0]);
  const ePool = HEROES.slice();
  const ePick = [];
  while (ePick.length < 3 && ePool.length) ePick.push(ePool.splice(randi(0, ePool.length - 1), 1)[0]);
  const eName = TEAM_NAMES[randi(1, TEAM_NAMES.length - 1)];
  const cfg = {
    mode: 'vs', theme: 'arena', arenaW: 1750,
    heroId,
    allies: pick2.map(h => h.id),
    enemies: ePick,
    playerMult: 1,
    enemyHpMult: 1.06,
    enemyDmgMult: 1.04,
    waveInfo: '对战模式 · 3v3',
    announceSeq: ['⚔️ ' + heroName(heroId) + ' 队 VS ' + eName + '!'],
    onEnd: (win, stats) => {
      if (win) {
        save.vsWins++;
        save.stats.vsWins = save.vsWins;
        const gold = awardGold(50);
        writeSave();
        showResult(true, {
          title: '🏆 团队胜利!',
          gold,
          stats: `用时 ${stats.time.toFixed(1)}s · 伤害 ${stats.dmg} · 击杀 ${stats.kills} · 最大连击 ${stats.combo}<br>对战胜利累计 ${save.vsWins} 场`,
          buttons: [
            { label: '⚔️ 再来一局', cls: '', fn: () => startVersusMode(heroId) },
            { label: '🏠 主菜单', cls: 'dark', fn: toMainMenu },
          ],
        });
      } else {
        const gold = awardGold(15);
        showResult(false, {
          title: '💀 团队败北…',
          gold,
          stats: `用时 ${stats.time.toFixed(1)}s · 伤害 ${stats.dmg} · 最大连击 ${stats.combo}`,
          buttons: [
            { label: '🔄 再试一次', cls: '', fn: () => startVersusMode(heroId) },
            { label: '🏠 主菜单', cls: 'dark', fn: toMainMenu },
          ],
        });
      }
    },
  };
  launchBattle(cfg);
}

function startTournamentMode(heroId) {
  tourState = { heroId, round: 0, results: { 0: '胜' }, winners: null };
  simulateBracket();
  showBracket();
}
function simulateBracket() {
  const names = TEAM_NAMES.slice(1); /* 15 支对手 */
  const w = {};
  const win = (a, b) => (Math.random() < 0.5 ? a : b);
  /* 第一轮:玩家 vs names[0],其余对阵模拟 */
  w.m1 = TEAM_NAMES[0];
  w.m2 = win(names[1], names[2]);
  w.m3 = win(names[3], names[4]);
  w.m4 = win(names[5], names[6]);
  w.m5 = win(names[7], names[8]);
  w.m6 = win(names[9], names[10]);
  w.m7 = win(names[11], names[12]);
  w.m8 = win(names[13], names[14]);
  /* 第二轮 */
  w.q1 = TEAM_NAMES[0];
  w.q2 = win(w.m3, w.m4);
  w.q3 = win(w.m5, w.m6);
  w.q4 = win(w.m7, w.m8);
  /* 半决赛 */
  w.s1 = TEAM_NAMES[0];
  w.s2 = win(w.q3, w.q4);
  /* 决赛 */
  w.f1 = TEAM_NAMES[0];
  tourState.winners = w;
}
function tournamentOpponentName(round) {
  const w = tourState.winners;
  if (round === 0) return TEAM_NAMES[1];
  if (round === 1) return w.m2;
  if (round === 2) return w.q2;
  return w.s2;
}
function startTournamentMatch(enemyOverride) {
  const round = tourState.round;
  const oppName = tournamentOpponentName(round);
  const otherHeroes = HEROES.filter(h => h.id !== tourState.heroId);
  const pick2 = [];
  const pool = otherHeroes.slice();
  while (pick2.length < 2 && pool.length) pick2.push(pool.splice(randi(0, pool.length - 1), 1)[0]);
  const ePick = enemyOverride && enemyOverride.length === 3
    ? enemyOverride.map(id => HEROES.find(h => h.id === id) || id).filter(Boolean)
    : (() => {
      const ePool = HEROES.slice();
      const out = [];
      while (out.length < 3 && ePool.length) out.push(ePool.splice(randi(0, ePool.length - 1), 1)[0]);
      return out;
    })();
  const mult = 1 + round * 0.14;
  const cfg = {
    mode: 'tour', theme: 'tour', arenaW: 1750,
    heroId: tourState.heroId,
    allies: pick2.map(h => h.id),
    enemies: ePick,
    playerMult: 1,
    enemyHpMult: mult,
    enemyDmgMult: 1 + round * 0.07,
    playerStartHpPct: (function () { const v = tourState.nextHpPct; tourState.nextHpPct = undefined; return v; })(),
    waveInfo: `锦标赛 · ${round + 1}/4 轮`,
    announceSeq: ['🏆 第 ' + (round + 1) + ' 轮!', '对手: ' + oppName],
    onEnd: (win, stats) => {
      if (win) {
        /* 轮间恢复 50%:延续到下一轮(含盟友) */
        if (currentBattle && currentBattle.player) {
          tourState.nextHpPct = Math.min(1, (currentBattle.player.hp + currentBattle.player.maxHp * 0.5) / currentBattle.player.maxHp);
        }
        if (round >= 3) {
          save.tourBest = Math.max(save.tourBest, 4);
          save.stats.tourWins = (save.stats.tourWins || 0) + 1;
          const gold = awardGold(250);
          writeSave();
          showResult(true, {
            title: '👑 锦标赛冠军!',
            gold,
            stats: `你的队伍击败了所有 15 支劲旅!<br>用时 ${stats.time.toFixed(1)}s · 伤害 ${stats.dmg}`,
            buttons: [{ label: '🏆 荣耀加身!', cls: '', fn: toMainMenu }],
          });
        } else {
          const gold = awardGold(60 + round * 40);
          tourState.round++;
          showBracket();
          showTutorial('💰 晋级奖励 +' + gold + ' 金币!', 3);
        }
      } else {
        save.tourBest = Math.max(save.tourBest, round);
        const gold = awardGold(20);
        writeSave();
        showResult(false, {
          title: '💀 淘汰出局…',
          gold,
          stats: `止步 ${round + 1}/4 轮 · 用时 ${stats.time.toFixed(1)}s`,
          buttons: [{ label: '🏠 主菜单', cls: 'dark', fn: toMainMenu }],
        });
      }
    },
  };
  launchBattle(cfg);
}
/* ---------------- 无尽模式 ---------------- */
let survState = null;
function survFlow() {
  showHeroSelect(() => startSurvivalMode(heroSel), '🌊 选择无尽勇士');
}
function startSurvivalMode(heroId) {
  survState = { heroId, wave: 0 };
  beginSurvivalWave();
}
function genSurvivalEnemies(wave) {
  if (wave % 5 === 0) return ['boss']; /* 每 5 波一个 BOSS 波 */
  const count = Math.min(1 + Math.floor(wave / 2), 6);
  const pool = ['grunt'];
  if (wave >= 2) pool.push('grunt', 'archer', 'mage');
  if (wave >= 3) pool.push('tank');
  if (wave >= 4) pool.push('elite');
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[randi(0, pool.length - 1)]);
  return out;
}
function beginSurvivalWave() {
  const wave = survState.wave + 1;
  const isBoss = wave % 5 === 0;
  const enemies = genSurvivalEnemies(wave);
  const themes = ['arena', 'forest', 'volcano', 'frost', 'castle'];
  const cfg = {
    mode: 'surv', theme: themes[(wave - 1) % themes.length], arenaW: 1400,
    heroId: survState.heroId,
    allies: [], enemies,

    playerMult: 1,
    enemyHpMult: 1 + wave * 0.07,
    enemyDmgMult: 1 + wave * 0.04,
    bossIdx: Math.floor(wave / 5),
    bossWave: isBoss,
    playerStartHpPct: (function () { const v = survState.nextHpPct; survState.nextHpPct = undefined; return v; })(),
    waveInfo: `🌊 无尽模式 · 第 ${wave} 波${isBoss ? ' · BOSS' : ''}`,
    announceSeq: isBoss ? ['⚠️ BOSS 来袭!', '暗影巨龙 登场!'] : [`🌊 第 ${wave} 波!`],
    onEnd: (win, stats) => {
      if (win) {
        const gold = awardGold(10 + wave * 2 + (isBoss ? 30 : 0));
        survState.wave = wave;
        /* 波间恢复 30%:延续到下一波 */
        if (currentBattle && currentBattle.player) {
          survState.nextHpPct = Math.min(1, (currentBattle.player.hp + currentBattle.player.maxHp * 0.3) / currentBattle.player.maxHp);
        }
        showTutorial(`💰 波次奖励 +${gold} 金币 · 已回血 30%`, 3);
        beginSurvivalWave();
      } else {
        save.survBest = Math.max(save.survBest, wave);
        save.stats.survBest = save.survBest;
        writeSave();
        const gold = awardGold(15);
        showResult(false, {
          title: `💀 倒在第 ${wave} 波`,
          gold,
          stats: `最高纪录:第 ${save.survBest} 波 · 用时 ${stats.time.toFixed(1)}s · 伤害 ${stats.dmg}`,
          buttons: [
            { label: '🌊 再次挑战', cls: '', fn: () => startSurvivalMode(survState.heroId) },
            { label: '🔄 换英雄', cls: 'blue', fn: survFlow },
            { label: '🏠 主菜单', cls: 'dark', fn: toMainMenu },
          ],
        });
      }
    },
  };
  launchBattle(cfg);
}

/* ---------------- 训练场 ---------------- */
function trainFlow() {
  showHeroSelect(() => startTrainingMode(heroSel), '🎯 选择训练英雄');
}
function startTrainingMode(heroId) {
  const cfg = {
    mode: 'train', theme: 'arena', arenaW: 1100,
    heroId,
    allies: [], enemies: ['dummy'],

    playerMult: 1,
    waveInfo: '训练场',
    announceSeq: ['🎯 自由训练!', '木桩不会反击,尽情练习连招'],
    onEnd: () => { },
  };
  launchBattle(cfg);
}

function heroName(id) {
  const h = HEROES.find(x => x.id === id);
  return h ? h.name : '英雄';
}

let net = null; /* 局域网联机已移除 */

/* ---------------- 双人本地对战 ---------------- */
let pvpP1Id = null;
function pvpFlow() {
  showHeroSelect(() => {
    pvpP1Id = heroSel;
    showHeroSelect(() => startVersus2P(pvpP1Id, heroSel), '🔵 P2 选择你的英雄');
  }, '🟡 P1 选择你的英雄');
}
function startVersus2P(p1Id, p2Id) {
  const cfg = {
    mode: 'pvp', theme: 'arena', arenaW: 1200,
    heroId: p1Id, p2HeroId: p2Id,
    allies: [], enemies: [],

    playerMult: 1,
    waveInfo: '双人对战 · 1V1',
    announceSeq: ['⚔️ 决斗开始!', 'P1: ' + heroName(p1Id) + ' VS P2: ' + heroName(p2Id)],
    onEnd: (win, stats) => {
      const gold = awardGold(win ? 40 : 10);
      showResult(win, {
        title: win ? '🟡 P1 胜利!' : '🔵 P2 胜利!',
        gold,
        stats: `用时 ${stats.time.toFixed(1)}s · 双方战至最后一刻!`,
        buttons: [
          { label: '⚔️ 再来一局', cls: '', fn: () => startVersus2P(p1Id, p2Id) },
          { label: '🔄 换英雄', cls: 'blue', fn: pvpFlow },
          { label: '🏠 主菜单', cls: 'dark', fn: toMainMenu },
        ],
      });
    },
  };
  launchBattle(cfg);
}

function launchBattle(cfg) {
  paused = false;
  hideAllScreens();
  $('hud').classList.remove('hidden');
  $('hudP2').style.display = cfg.p2HeroId ? 'block' : 'none';
  $('skillBar2').style.display = cfg.p2HeroId ? 'flex' : 'none';
  $('teamRow').style.display = cfg.p2HeroId ? 'none' : 'flex';
  if (isTouch && cfg.mode !== 'pvp') $('touch').classList.remove('hidden');
  else $('touch').classList.add('hidden');
  projs.length = 0; parts.length = 0; floats.length = 0; telegraphs.length = 0;
  lastCfg = cfg;
  currentBattle = new Battle(cfg);
  /* 波间/轮间延续血量:设计意图"上一波残血 + 固定恢复",而非每波满血 */
  if (cfg.playerStartHpPct) {
    for (const f of currentBattle.fighters) {
      if (f.team === 0) f.hp = Math.max(1, f.maxHp * cfg.playerStartHpPct);
    }
  }
  setupHUD(cfg);
  startMusic();
  if (cfg.mode === 'story' && save.story === 0) showTutorial('A/D 移动 · 空格 攻击 · B 格挡 · F 冲刺 · Z 蓄力 · Q/W/R 技能 · S 变身', 6);
  if (cfg.mode === 'pvp') showTutorial('P1: A/D 空格 B F Z Q/W/R S · P2: ←→ . , ↓ ↑ ; \' / Enter', 5);
}

function setupHUD(cfg) {
  const h = HEROES.find(x => x.id === cfg.heroId);
  if (h) {
    $('nameplate').textContent = (cfg.mode === 'pvp' ? '🟡 P1 · ' : '🐉 ') + h.name + (cfg.mode === 'story' ? ' · 孤胆英雄' : '');
    const sks = h.skills;
    const map = { skQ: sks[0], skW: sks[1], skR: sks[2] };
    for (const id in map) {
      const sk = map[id];
      $(id).querySelector('.skName').textContent = sk.name;
      $(id).querySelector('.skCost').textContent = sk.cost;
    }
  }
  /* 双人模式:P2 面板 */
  if (cfg.p2HeroId) {
    const h2 = HEROES.find(x => x.id === cfg.p2HeroId);
    if (h2) {
      $('nameplate2').textContent = '🔵 P2 · ' + h2.name;
      const sks = h2.skills;
      const map = { sk2Q: sks[0], sk2W: sks[1], sk2R: sks[2] };
      for (const id in map) {
        const sk = map[id];
        $(id).querySelector('.skName').textContent = sk.name;
        $(id).querySelector('.skCost').textContent = sk.cost;
      }
    }
  }
  /* 队伍图标 */
  const team = currentBattle.fighters.filter(f => f.team === 0);
  const foes = currentBattle.fighters.filter(f => f.team === 1);
  $('allyIcons').innerHTML = team.map((f, i) => `<div class="dot" id="ad${i}" style="background:${f.hero.color}"></div>`).join('');
  $('enemyIcons').innerHTML = foes.map((f, i) => `<div class="dot" id="ed${i}" style="background:${f.pvp ? '#5a9aff' : '#c04040'}"></div>`).join('');
  $('waveInfo').textContent = cfg.waveInfo;
  if (cfg.mode === 'story') showTutorial('消灭所有敌人!', 3);
  else if (cfg.mode === 'train') showTutorial('木桩不会反击,尽情练习连招!Esc 暂停退出', 4);
  else if (cfg.mode !== 'pvp') showTutorial('与盟友并肩作战,击倒全部敌人!', 3);
}

/* ---------------- 界面 ---------------- */
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('show'));
}
function showScreen(id) { hideAllScreens(); $(id).classList.add('show'); }
function toMainMenu() {
  currentBattle = null;
  stopMusic();
  paused = false;
  $('hud').classList.add('hidden');
  $('touch').classList.add('hidden');
  refreshGoldUI();
  showScreen('scrMain');
}
function showTutorial(text, dur) {
  const el = $('tutorial');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(showTutorial._t);
  showTutorial._t = setTimeout(() => el.classList.remove('on'), (dur || 3) * 1000);
}
function showResult(win, r) {
  const t = $('resTitle');
  t.textContent = r.title;
  t.style.color = win ? '#7dffa8' : '#ff8a7a';
  t.style.textShadow = win ? '0 0 30px rgba(125,255,168,.7)' : '0 0 30px rgba(255,90,90,.7)';
  let stats = r.stats || '';
  if (r.gold) {
    stats += `<br><span style="color:#ffd94d;font-weight:800;font-size:18px;">💰 金币 +${r.gold}</span>`;
  }
  $('resStats').innerHTML = stats;
  refreshGoldUI();
  const bs = $('resBtns');
  bs.innerHTML = '';
  r.buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    el.textContent = b.label;
    el.onclick = b.fn;
    bs.appendChild(el);
  });
  showScreen('scrResult');
}
function showStoryScreen(title, lines, onDone, isOutro) {
  $('storyTitle').textContent = title;
  const box = $('storyText');
  let i = 0;
  box.textContent = lines[0] || '';
  const btn = $('storyBtn');
  btn.textContent = lines.length > 1 ? '继续 ▶' : (isOutro ? '继续征程 ▶' : '开始战斗 ⚔️');
  btn.onclick = () => {
    i++;
    if (i < lines.length) {
      box.textContent = lines[i];
      btn.textContent = i === lines.length - 1 ? (isOutro ? '继续征程 ▶' : '开始战斗 ⚔️') : '继续 ▶';
    } else {
      hideAllScreens();
      onDone();
    }
  };
  showScreen('scrStory');
  SFX.ui();
}
function showChapterScreen() {
  const list = $('chapterList');
  list.innerHTML = '';
  const cleared = Math.min(save.story, CHAPTERS.length);
  /* 顶部总进度条 */
  const prog = document.createElement('div');
  prog.className = 'chapProgress';
  prog.innerHTML = `<span class="cpText">📜 冒险进度 ${cleared}/${CHAPTERS.length}</span><span class="cpBar"><i style="width:${cleared / CHAPTERS.length * 100}%"></i></span><span class="cpGold">💰 ${save.econ.gold}</span>`;
  list.appendChild(prog);
  CHAPTERS.forEach((ch, i) => {
    const unlocked = i <= save.story;
    const done = i < save.story;
    const current = i === save.story;
    const emoji = THEME_EMOJI[ch.theme] || '🗺️';
    const tc = themeColor(ch.theme);
    /* 敌人图鉴(按出现顺序去重) */
    const foes = [];
    ch.waves.forEach(w => w.forEach(e => { if (!foes.includes(e)) foes.push(e); }));
    if (ch.boss) foes.push('boss');
    const foeIcons = foes.map(e => (ENEMIES[e] || makeBoss(0)).emoji).join('');
    /* 波次路线:圆点 -> 圆点 -> ... -> BOSS */
    let route = '';
    ch.waves.forEach((w, wi) => {
      if (wi > 0) route += '<span class="rl"></span>';
      route += `<i class="rp${wi === 0 ? ' on' : ''}" style="border-color:${tc}"></i>`;
    });
    if (ch.boss) {
      route += '<span class="rl"></span>';
      route += '<span class="ccBoss">🐉</span>';
    }
    /* 首通奖励估算:所有波 + Boss + 首通加成(按当前难度) */
    const waveGold = ch.waves.reduce((a) => a + 25 + i * 15, 0);
    const firstGold = diffGold(waveGold + (50 + i * 20) + 50, i);
    const card = document.createElement('div');
    card.className = 'chapCard' + (unlocked ? '' : ' locked') + (current ? ' cur' : '');
    card.style.borderColor = tc;
    /* 难度选择行 */
    let diffRow = '';
    if (unlocked) {
      diffRow = `<div class="ccDiff">难度:${DIFFICULTIES.map((d, di) =>
        `<button class="diffBtn${(save.diff[i] || 0) === di ? ' sel' : ''}" data-d="${di}" style="${(save.diff[i] || 0) === di ? 'border-color:' + ['#5aff7a', '#ffb52e', '#ff5c4d'][di] : ''}">${d.icon} ${d.name}</button>`).join('')}
      <span class="cfLbl" style="margin-left:auto;">奖励 ×${chapterDiff(i).gold}</span></div>`;
    }
    card.innerHTML = `
      <div class="ccHead">
        <span class="ccEmoji">${emoji}</span>
        <span class="ccName">${ch.name}</span>
        <span class="ccBadge ${done ? 'ok' : (current ? 'now' : 'no')}">${done ? '⭐ 已通关' : (current ? '▶ 进行中' : '🔒 未解锁')}</span>
      </div>
      <div class="ccFoes"><span class="cfLbl">敌人</span>${foeIcons}</div>
      ${diffRow}
      <div class="ccRoute">${route}</div>
      <div class="ccReward">💰 首通奖励 ${firstGold} 金币 · 共 ${ch.waves.length} 波 + 首领战</div>
      <button class="btn ${done ? 'dark' : ''} small ccGo" ${unlocked ? '' : 'disabled'}>${done ? '⚔️ 再次挑战' : (current ? '⚔️ 继续征程' : '🔒 未解锁')}</button>`;
    /* 难度切换 */
    if (unlocked) {
      card.querySelectorAll('.diffBtn').forEach(btn => {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          save.diff[i] = +btn.dataset.d;
          writeSave();
          SFX.ui();
          showChapterScreen();
        };
      });
    }
    /* 主按钮:进入英雄选择(注意不能用 querySelector('button'),会选中难度按钮) */
    const btn = card.querySelector('.ccGo');
    if (unlocked && btn) btn.onclick = () => { SFX.ui(); showHeroSelect(() => startStoryMode(heroSel, i)); };
    list.appendChild(card);
  });
  showScreen('scrChapter');
}
function showBracket() {
  const round = tourState.round;
  $('bracketTitle').textContent = '🏆 锦标赛 · 第 ' + (round + 1) + '/4 轮';
  const w = tourState.winners;
  const r1 = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  const r2 = ['q1', 'q2', 'q3', 'q4'];
  const r3 = ['s1', 's2'];
  const r4 = ['f1'];
  const cols = [
    { cells: r1.map(k => w[k]), me: 0 },
    { cells: r2.map(k => w[k]), me: 0 },
    { cells: r3.map(k => w[k]), me: 0 },
    { cells: r4.map(k => w[k]), me: 0 },
  ];
  const box = $('bracketBox');
  box.innerHTML = '';
  cols.forEach((col, ci) => {
    const div = document.createElement('div');
    div.className = 'bcol';
    col.cells.forEach((name) => {
      const cell = document.createElement('div');
      const isMe = name === TEAM_NAMES[0];
      cell.className = 'bcell';
      if (isMe) {
        cell.classList.add('me');
        cell.textContent = '⭐ ' + name;
      } else if (ci > round) {
        cell.classList.add('empty');
        cell.textContent = '???';
      } else if (ci < round) {
        cell.classList.add('lose');
        cell.textContent = '✖ ' + name;
      } else {
        cell.textContent = name;
      }
      div.appendChild(cell);
    });
    box.appendChild(div);
  });
  const btn = $('bracketBtn');
  btn.textContent = round >= 3 ? '🏆 决赛! 开始!' : '⚔️ 下一场战斗!';
  btn.onclick = () => { SFX.ui(); hideAllScreens(); startTournamentMatch(); };
  showScreen('scrBracket');
}
function showHeroSelect(onDone, title) {
  $('heroTitle').textContent = title || '选择你的英雄';
  const cards = $('heroCards');
  cards.innerHTML = '';
  HEROES.forEach(h => {
    const uh = heroUpgraded(h);
    const el = document.createElement('div');
    el.className = 'hcard' + (h.id === heroSel ? ' sel' : '');
    el.innerHTML = `
      <div class="hEmoji">${h.emoji}</div>
      <div class="hName" style="color:${h.color}">${h.name}</div>
      <div class="hTitle">${h.title}</div>
      <div class="hStats">
        <div class="stRow"><span>生命</span><div class="stBar"><i style="width:${uh.hp / 1.9}%"></i></div></div>
        <div class="stRow"><span>速度</span><div class="stBar"><i style="width:${uh.speed / 2.8}%"></i></div></div>
        <div class="stRow"><span>攻击</span><div class="stBar"><i style="width:${uh.dmg / 0.17}%"></i></div></div>
      </div>`;
    el.onclick = () => {
      heroSel = h.id;
      SFX.ui();
      cards.querySelectorAll('.hcard').forEach(c => c.classList.remove('sel'));
      el.classList.add('sel');
      updateHeroDetail();
    };
    cards.appendChild(el);
  });
  updateHeroDetail();
  showScreen('scrHero');
  $('btnHeroStart').onclick = () => { SFX.ui(); hideAllScreens(); onDone(); };
}
function updateHeroDetail() {
  const h = HEROES.find(x => x.id === heroSel);
  $('heroDetail').innerHTML =
    `<b>${h.name}</b> — ${h.desc}<br>技能:${h.skills.map(s => `<b style="color:#ffd94d">${s.key}</b> ${s.name}(${s.cost}气) · ${s.desc}`).join(' ')}`;
}

/* ---------------- 英雄强化界面 ---------------- */
let upHero = HEROES[0].id;
function showUpgrade() {
  refreshGoldUI();
  renderUpgrade();
  showScreen('scrUpgrade');
  SFX.ui();
}
function renderUpgrade() {
  refreshGoldUI();
  const tabs = $('upTabs');
  tabs.innerHTML = '';
  HEROES.forEach(h => {
    const el = document.createElement('button');
    el.className = 'upTab' + (h.id === upHero ? ' sel' : '');
    el.innerHTML = `${h.emoji} ${h.name}`;
    el.onclick = () => { upHero = h.id; SFX.ui(); renderUpgrade(); };
    tabs.appendChild(el);
  });
  const list = $('upList');
  list.innerHTML = '';
  const hero = HEROES.find(h => h.id === upHero);
  const upgraded = heroUpgraded(hero);
  UP_STATS.forEach(st => {
    const lvl = upLevel(upHero, st.key);
    const base = st.get(hero), now = st.get(upgraded);
    const cost = lvl >= UP_MAX ? 0 : upCost(lvl);
    const row = document.createElement('div');
    row.className = 'upRow';
    let pips = '';
    for (let i = 0; i < UP_MAX; i++) pips += `<i class="${i < lvl ? 'on' : ''}"></i>`;
    const btnCls = lvl >= UP_MAX ? 'max' : (save.econ.gold < cost ? 'poor' : '');
    const btnTxt = lvl >= UP_MAX ? '满级' : (save.econ.gold < cost ? `💰 ${cost}` : `⬆ ${cost}`);
    row.innerHTML = `
      <span class="uIcon">${st.icon}</span>
      <span class="uName">${st.name}</span>
      <span class="uVal">${base} → <b>${now}</b><br>+${Math.round(st.bonus * lvl * 100)}% · Lv.${lvl}/10</span>
      <span class="uPips">${pips}</span>`;
    const btn = document.createElement('button');
    btn.className = 'upBtn ' + btnCls;
    btn.textContent = btnTxt;
    if (lvl < UP_MAX) {
      btn.onclick = () => {
        const r = buyUpgrade(upHero, st.key);
        if (r.ok) { SFX.victory(); renderUpgrade(); }
        else SFX.defeat();
      };
    }
    row.appendChild(btn);
    list.appendChild(row);
  });
}

/* ---------------- HUD 刷新 ---------------- */
function hudUpdate() {
  const b = currentBattle;
  if (!b || !b.player) return;
  /* 联机从机视角:主面板显示自己(P2),副面板显示对手(P1) */
  const guestView = !!(net && net.role === 'client');
  const p = guestView ? (b.p2 || b.player) : b.player;
  const p2 = guestView ? b.player : b.p2;
  /* 训练场:DPS 实时统计 */
  if (b.mode === 'train') {
    const dps = b.time > 0.5 ? Math.round(b.player.dmgDealt / b.time) : 0;
    $('waveInfo').textContent = `训练场 · DPS ${dps} · 总伤害 ${Math.round(b.player.dmgDealt)}`;
  }
  $('hpFill').style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
  $('hpText').textContent = Math.max(0, Math.round(p.hp)) + ' / ' + p.maxHp;
  $('qiFill').style.width = clamp(p.qi, 0, 100) + '%';
  $('qiText').textContent = '气 ' + Math.floor(p.qi) + '/100' + (p.transforming ? ' 🐉' : (p.qi >= 100 ? ' ✨' : ''));
  const tr = $('trTimer');
  if (p.transforming && p.transformT > 0) {
    tr.classList.remove('hidden');
    tr.textContent = '🐉 变身中 ' + p.transformT.toFixed(1) + 's';
  } else tr.classList.add('hidden');
  /* 技能按钮 (P1) */
  const h = HEROES.find(x => x.id === lastCfg.heroId);
  if (h) updateSkillButtons(h, p, ['skQ', 'skW', 'skR'], 'skS');
  /* 双人模式:P2 HUD */
  if (p2) {
    $('hpFill2').style.width = clamp(p2.hp / p2.maxHp * 100, 0, 100) + '%';
    $('hpText2').textContent = Math.max(0, Math.round(p2.hp)) + ' / ' + p2.maxHp;
    $('qiFill2').style.width = clamp(p2.qi, 0, 100) + '%';
    $('qiText2').textContent = '气 ' + Math.floor(p2.qi) + '/100' + (p2.transforming ? ' 🐉' : (p2.qi >= 100 ? ' ✨' : ''));
    const tr2 = $('trTimer2');
    if (p2.transforming && p2.transformT > 0) {
      tr2.style.display = 'block';
      tr2.textContent = '🐉 变身中 ' + p2.transformT.toFixed(1) + 's';
    } else tr2.style.display = 'none';
    const h2 = HEROES.find(x => x.id === lastCfg.p2HeroId);
    if (h2) updateSkillButtons(h2, p2, ['sk2Q', 'sk2W', 'sk2R'], 'sk2S');
  }
  /* 队伍图标 */
  const team = b.fighters.filter(f => f.team === 0);
  const foes = b.fighters.filter(f => f.team === 1);
  team.forEach((f, i) => {
    const el = $('ad' + i);
    if (el) el.classList.toggle('dead', f.koT > 0);
  });
  foes.forEach((f, i) => {
    const el = $('ed' + i);
    if (el) el.classList.toggle('dead', f.koT > 0);
  });
}
function updateSkillButtons(hero, fighter, ids, transformId) {
  hero.skills.forEach((sk, i) => {
    const el = $(ids[i]);
    const onCd = fighter.skillCds[sk.key] > 0;
    const can = fighter.qi >= sk.cost && !onCd;
    el.classList.toggle('off', !can);
    el.classList.toggle('flash', can && fighter.qi >= sk.cost);
    const cdEl = el.querySelector('.skCd');
    cdEl.classList.toggle('hidden', !onCd);
    if (onCd) cdEl.textContent = fighter.skillCds[sk.key].toFixed(1);
  });
  const skS = $(transformId);
  const canT = fighter.qi >= 100 && !fighter.transforming;
  skS.classList.toggle('off', !canT && !fighter.transforming);
  skS.classList.toggle('flash', canT);
}

/* ---------------- 暂停 ---------------- */
function togglePause() {
  if (!currentBattle || currentBattle.ended) return;
  paused = !paused;
  if (paused) { showScreen('scrPause'); SFX.ui(); }
  else { hideAllScreens(); SFX.ui(); }
}

/* ---------------- 主循环 ---------------- */
function frame() {
  requestAnimationFrame(frame);
  readInput();
  if (currentBattle && !currentBattle.ended) {
    for (let p = 0; p < currentBattle.playerInputs.length; p++) {
      const inp = inputs[p];
      currentBattle.playerInputs[p] = {
        move: inp.move,
        attack: inp.attack, dash: inp.dash, q: inp.q, w: inp.w, r: inp.r, transform: inp.transform,
        blockHeld: inp.blockHeld, chargeHeld: inp.chargeHeld,
      };
    }
    /* 联机房主:P2 输入只认对端快照输入,本地方向键/空格不注入(防箭头键泄漏驱动 P2) */
    if (net && net.role === 'host' && currentBattle.playerInputs.length > 1) {
      currentBattle.playerInputs[1] = Object.assign(
        { move: 0, attack: false, dash: false, q: false, w: false, r: false, transform: false, blockHeld: false, chargeHeld: false },
        net.lastInput);
    }
  }
  inputs.forEach(i => i._clear());
  if (net && net.role === 'host') {
    if (!paused && currentBattle && !currentBattle.ended) currentBattle.update(1 / 60);
    netHostTick();
  } else if (net && net.role === 'client') {
    if (!paused) netClientTick();
  } else if (!paused && currentBattle && !currentBattle.ended) {
    currentBattle.update(1 / 60);
  }
  if (currentBattle) {
    hudUpdate();
    currentBattle.draw();
  } else {
    drawMenuBackdrop();
  }
}
let menuT = 0;
function drawMenuBackdrop() {
  menuT += 1 / 60;
  drawBackground('castle');
  ctx.save();
  ctx.globalAlpha = 0.35 + Math.sin(menuT * 2) * 0.12;
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd94d';
  ctx.fillText('🐉 龙之力,燃于心中!', W / 2, H / 2 - 40);
  ctx.globalAlpha = 0.5;
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText('选择英雄 · 积攒气力 · 龙之变身 · 击败暗影', W / 2, H / 2 + 10);
  ctx.restore();
}

/* ---------------- 绑定 UI ---------------- */
function bindUI() {
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  /* 用户登录 */
  $('authLoginBtn').onclick = () => authTryLogin();
  $('authRegBtn').onclick = () => authTryRegister();
  $('authUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('authPw').focus(); });
  $('authPw').addEventListener('keydown', e => { if (e.key === 'Enter') authTryLogin(); });
  $('authPw2').addEventListener('keydown', e => { if (e.key === 'Enter') authTryRegister(); });
  $('btnLogout').onclick = () => authLogout();
  $('btnStory').onclick = () => {
    SFX.ui();
    showChapterScreen();
  };
  $('btnVs').onclick = () => { SFX.ui(); showHeroSelect(() => startVersusMode(heroSel)); };
  $('btnPvp').onclick = () => { SFX.ui(); pvpFlow(); };
  $('btnTour').onclick = () => { SFX.ui(); showHeroSelect(() => startTournamentMode(heroSel)); };
  $('btnSurv').onclick = () => { SFX.ui(); survFlow(); };
  $('btnTrain').onclick = () => { SFX.ui(); trainFlow(); };
  $('btnUpgrade').onclick = () => showUpgrade();
  $('btnUpBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnAch').onclick = () => showAchievements();
  $('btnAchBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnGear').onclick = () => showGear();
  $('btnGearBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnDaily').onclick = () => showDaily();
  $('btnDailyBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnHelp').onclick = () => { SFX.ui(); showScreen('scrHelp'); };
  $('btnHelpBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnChapBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnHeroBack').onclick = () => { SFX.ui(); toMainMenu(); };
  $('btnSound').onclick = () => {
    muted = !muted;
    $('btnSound').textContent = muted ? '🔇 声音：关' : '🔊 声音：开';
    if (muted) stopMusic();
    SFX.ui();
  };
  $('btnResume').onclick = () => togglePause();
  $('btnRetry').onclick = () => {
    SFX.ui();
    if (lastCfg) { paused = false; hideAllScreens(); launchBattle(lastCfg); }
  };
  $('btnQuit').onclick = () => { SFX.ui(); toMainMenu(); };
  $('pauseBtn').onclick = () => togglePause();
  /* 触屏 */
  if (isTouch) {
    $('touch').classList.remove('hidden');
    bindTouch();
  }
}
function bindTouch() {
  const joyZone = $('joyZone'), joyBase = $('joyBase'), joyKnob = $('joyKnob');
  joyZone.addEventListener('pointerdown', e => {
    e.preventDefault();
    touch.joyOn = true; touch.joyId = e.pointerId;
    const r = joyZone.getBoundingClientRect();
    touch.joyOX = e.clientX - r.left; touch.joyOY = e.clientY - r.top;
    joyBase.style.display = 'block';
    joyBase.style.left = (touch.joyOX - 55) + 'px';
    joyBase.style.top = (touch.joyOY - 55) + 'px';
    joyKnob.style.left = '50%'; joyKnob.style.top = '50%';
    if (joyZone.setPointerCapture) joyZone.setPointerCapture(e.pointerId);
  });
  joyZone.addEventListener('pointermove', e => {
    if (!touch.joyOn || e.pointerId !== touch.joyId) return;
    const r = joyZone.getBoundingClientRect();
    let dx = e.clientX - r.left - touch.joyOX;
    let dy = e.clientY - r.top - touch.joyOY;
    const len = Math.hypot(dx, dy);
    if (len > 48) { dx = dx / len * 48; dy = dy / len * 48; }
    touch.joyDX = clamp(dx / 48, -1, 1);
    joyKnob.style.left = (50 + dx / 48 * 50) + '%';
    joyKnob.style.top = (50 + dy / 48 * 50) + '%';
  });
  const joyEnd = e => {
    if (e.pointerId !== touch.joyId) return;
    touch.joyOn = false; touch.joyDX = 0;
    joyBase.style.display = 'none';
  };
  joyZone.addEventListener('pointerup', joyEnd);
  joyZone.addEventListener('pointercancel', joyEnd);
  const hold = (id, flag, edge) => {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      /* 触屏输入路由:联机从机控制 P2(与 netSendInput 读取的输入一致) */
      const inp = (net && net.role === 'client') ? inputP2 : inputP1;
      if (edge) inp[edge] = true;
      else touch[flag] = true;
      el.classList.add('hold');
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    });
    const up = () => {
      if (!edge) touch[flag] = false;
      el.classList.remove('hold');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  hold('tA', null, 'attack');
  hold('tF', null, 'dash');
  hold('tQ', null, 'q');
  hold('tW', null, 'w');
  hold('tR', null, 'r');
  hold('tS', null, 'transform');
  hold('tB', 'block');
  hold('tZ', 'charge');
  document.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------------- 启动 ---------------- */
function boot() {
  loadSave(); /* 默认(未登录)视图 */
  bindUI();
  document.addEventListener('pointerdown', initAudio, { once: true });
  window.addEventListener('keydown', initAudio, { once: true });
  requestAnimationFrame(frame);
  /* 会话恢复:上次登录的账号直接进入主菜单 */
  try {
    const s = localStorage.getItem('sdb_session');
    if (s && usersDB()[s]) { authUser = s; loadSave(); }
  } catch (e) { }
  if (authUser) authEnterMain();
  else showScreen('scrLogin');
  /* 演示模式:URL 带 #demo 自动进入对战(便于截图/演示) */
  if (typeof location !== 'undefined' && location.hash.indexOf('demo') >= 0) {
    startVersusMode('sword');
  }
}
if (typeof window !== 'undefined') {
  boot();
}

/* 调试/测试钩子 */
const SDB = {
  boot,
  bindTouch,
  authRegister,
  authLogin,
  authLogout,
  authEnterMain,
  hashPw,
  usersDB,
  saveKey,
  get authUser() { return authUser; },
  input: inputP1,
  inputP1,
  inputP2,
  inputs,
  keys,
  touch,
  KEYMAPS,
  startVersus2P,
  startVersusMode,
  startTournamentMode,
  startStoryMode,
  startSurvivalMode,
  survFlow,
  readInput,
  get net() { return net; },
  set net(v) { net = v; },
  get heroSel() { return heroSel; },
  set heroSel(v) { heroSel = v; },
  get survState() { return survState; },
  startTrainingMode,
  trainFlow,
  showDaily,
  refreshDaily,
  claimDaily,
  trackDailyProgress,
  DAILY_POOL,
  get daily() { return save.daily; },
  showChapterScreen,
  hudUpdate,
  get battle() { return currentBattle; },
  addTelegraph,
  spawnPart,
  burst,
  addFloat,
  hitSpark,
  flashAt,
  ringAt,
  iceBurst,
  fireBoom,
  boltAt,
  starBurst,
  buyUpgrade,
  awardGold,
  heroUpgraded,
  refreshGoldUI,
  showUpgrade,
  showChapterScreen,
  showAchievements,
  showGear,
  buyGear,
  equipGear,
  applyGear,
  GEAR,
  GEAR_SLOTS,
  gearOwned,
  gearEquipped,
  DIFFICULTIES,
  ACHIEVEMENTS,
  checkAchievements,
  HEROES,
  UP_STATS,
  UP_MAX,
  upCost,
  upLevel,
  get save() { return save; },
  tick(seconds, framesPerSec) {
    const dt = 1 / (framesPerSec || 60);
    const n = Math.max(1, Math.round((seconds || 1) * (framesPerSec || 60)));
    for (let i = 0; i < n; i++) {
      readInput();
      if (currentBattle && !currentBattle.ended) {
        for (let p = 0; p < currentBattle.playerInputs.length; p++) {
          const inp = inputs[p];
          currentBattle.playerInputs[p] = {
            move: inp.move, attack: inp.attack, dash: inp.dash,
            q: inp.q, w: inp.w, r: inp.r, transform: inp.transform,
            blockHeld: inp.blockHeld, chargeHeld: inp.chargeHeld,
          };
        }
        currentBattle.update(dt);
      }
      inputs.forEach(i => i._clear());
    }
    if (currentBattle && currentBattle.ended && !currentBattle.endFired) currentBattle.fireEnd();
    return {
      battle: !!currentBattle,
      ended: currentBattle ? currentBattle.ended : false,
      win: currentBattle ? currentBattle.win : false,
      fighters: currentBattle ? currentBattle.fighters.map(f => ({ name: f.name, hp: Math.round(f.hp), state: f.state, team: f.team, ko: f.koT > 0, x: Math.round(f.x), dmg: Math.round(f.dmgDealt) })) : [],
      time: currentBattle ? currentBattle.time : 0,
    };
  },
  startDebugBattle(mode) {
    if (mode === 'story') {
      storyState = { heroId: 'sword', chapterIdx: 0, waveIdx: 0, boss: false };
      beginStoryWave();
    } else {
      const others = HEROES.filter(h => h.id !== 'sword').slice(0, 2);
      const ePick = HEROES.slice(0, 3);
      launchBattle({
        mode: 'vs', theme: 'arena', arenaW: 1750, heroId: 'sword',
        allies: others.map(h => h.id), enemies: ePick, playerMult: 1, enemyHpMult: 1.1, enemyDmgMult: 1.05,
        waveInfo: 'debug', announceSeq: [], onEnd: () => { },
      });
    }
    return !!currentBattle;
  },
  debugChargeTest() {
    if (!currentBattle || currentBattle.ended) this.startDebugBattle('story');
    const b = currentBattle;
    projs.length = 0; parts.length = 0; floats.length = 0; telegraphs.length = 0;
    const p = b.player, e = b.fighters.find(f => f.team === 1);
    if (!p || !e) return -1;
    p.koT = 0; p.state = 'idle'; p.hp = p.maxHp; p.qi = 100;
    e.koT = 0; e.state = 'idle'; e.hp = e.maxHp; e.aiT = 99999;
    p.x = 500; p.facing = 1; e.x = 580;
    p.chargeP = 1;
    p.releaseCharge();
    for (let i = 0; i < 6; i++) b.update(1 / 60);
    return e.maxHp - e.hp;
  },
  debugHeroTest(heroId) {
    launchBattle({
      mode: 'story', theme: 'arena', arenaW: 1400, heroId,
      allies: [], enemies: ['grunt'],
      playerMult: 1, enemyHpMult: 1, enemyDmgMult: 1, bossIdx: 0, bossWave: false,
      waveInfo: 'debug-hero', announceSeq: [], onEnd: () => { },
    });
    return !!currentBattle;
  },
  debugBossTest() {
    storyState = { heroId: 'sword', chapterIdx: 0, waveIdx: 0, boss: true };
    beginStoryWave();
    return !!currentBattle;
  },
  debugTourMatch(heroId, enemyIds) {
    tourState = { heroId, round: 0 };
    simulateBracket();
    startTournamentMatch(enemyIds);
    return !!currentBattle;
  },
};
if (typeof module !== 'undefined' && module.exports) module.exports = SDB;

/* ============================================================
 * save.js — 经济系统：金币 + 永久升级（localStorage 存档）
 * 升级线：engine 引擎 / steer 转向 / jump 跳跃 / lucky 财气（金币倍率）
 * ============================================================ */

const Save = (() => {
  const KEY = 'hexrace_save_v1';
  const MAX_LV = 5;
  const DEFAULT_UPS = { engine: 0, steer: 0, jump: 0, lucky: 0 };
  const UP_NAMES = { engine: '引擎', steer: '转向', jump: '跳跃', lucky: '财气' };
  const UP_DESC = {
    engine: '加速 / 极速',
    steer: '转向 / 抓地',
    jump: '跳跃更高更久',
    lucky: '金币 +25%/级',
  };

  const data = {
    coins: 0, ups: { ...DEFAULT_UPS }, diff: 'normal', map: 'arena', aiCount: null,
    customMap: { ringMax: 14, holes: [] },
  };

  function load() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      data.coins = Math.max(0, Number(d.coins) || 0);
      data.ups = Object.assign({}, DEFAULT_UPS, d.ups || {});
      if (['easy', 'normal', 'hard'].includes(d.diff)) data.diff = d.diff;
      if (['arena', 'small', 'mini', 'mine', 'canyon', 'custom'].includes(d.map)) data.map = d.map;
      if (Number.isInteger(d.aiCount) && d.aiCount >= 1 && d.aiCount <= 10) data.aiCount = d.aiCount;
      if (d.customMap) {
        data.customMap = {
          ringMax: Math.max(6, Math.min(14, Number(d.customMap.ringMax) || 14)),
          holes: Array.isArray(d.customMap.holes) ? d.customMap.holes : [],
        };
      }
    } catch (e) { /* 存档损坏则用默认 */ }
  }
  load();

  function persist() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* 隐私模式等无法写入时忽略 */ }
  }

  function upgradeCost(up) { return (data.ups[up] + 1) * 50; }

  function canUpgrade(up) { return data.ups[up] < MAX_LV; }

  function buy(up) {
    if (!canUpgrade(up)) return false;
    const cost = upgradeCost(up);
    if (data.coins < cost) return false;
    data.coins -= cost;
    data.ups[up] += 1;
    persist();
    return true;
  }

  // 把升级效果应用到玩家车上
  function applyToCar(car) {
    const u = data.ups;
    car.accelMax += u.engine * 1.2;
    car.maxSpeed += u.engine * 0.9;
    car.turnRate += u.steer * 0.18;
    car.grip += u.steer * 0.25;
    car.jumpTimeMax += u.jump * 0.06;
    car.coinMult = 1 + u.lucky * 0.25;
  }

  function addCoins(n) {
    data.coins += Math.max(0, Math.round(n));
    persist();
  }

  function setPref(key, val) {
    data[key] = val;
    persist();
  }

  function saveCustomMap(ringMax, holes) {
    data.customMap = { ringMax, holes };
    persist();
  }

  return { data, MAX_LV, UP_NAMES, UP_DESC, upgradeCost, canUpgrade, buy, applyToCar, addCoins, setPref, saveCustomMap };
})();

if (typeof module !== 'undefined') module.exports = Save;

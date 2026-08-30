/* ============================================================
 * grid.js — 六边形平台（纯逻辑，无渲染依赖）
 * 轴向坐标 (q, r) 布局六边形，状态机：
 *   SOLID(坚实) → WARN(警告) → FALLING(坠落) → GONE(消失) → GROWING(重生) → SOLID
 *   DEAD = 缩圈中被永久摧毁（不恢复）
 * ============================================================ */

const Grid = (() => {
  // ---- 配置 ----
  const SPACING = 3.6;          // 相邻六边形中心距 = SPACING * sqrt(3)
  let RING_MAX = 14;            // 最外圈编号（build 时按地图设定）
  const HEX_R = SPACING;        // 六边形外接圆半径 = 满铺（密铺）标准值
  const TILE_H = 0.55;          // （保留，无渲染用途）
  const WARN_TIME = 1.4;        // 必掉落的时间差：碾到后 1.4 秒格子才掉（快速通过可逃）
  const LAVA_WARN_TIME = 0.5;   // 熔岩模式：踩过的格子 0.5 秒后就掉（地板吃路更凶）
  const FALL_SPEED = 6.5;       // 坠落速度（缓和的下落动画）
  const REGROW_TIME = 1.0;      // 消失后重生等待（快速恢复，洞很快闭合）
  const GROW_TIME = 0.4;        // 生长动画时长

  const ST = { SOLID: 0, WARN: 1, FALLING: 2, GONE: 3, GROWING: 4, DEAD: 5 };

  const SQRT3 = Math.sqrt(3);

  let LAVA = false;             // 熔岩模式：被踩的瓦片永久消失、不再重生

  function hexToWorld(q, r) {
    return { x: SPACING * (SQRT3 * q + SQRT3 * 0.5 * r), z: SPACING * 1.5 * r };
  }
  function worldToHex(x, z) {
    const r = Math.round((2 * z) / (3 * SPACING));
    const q = Math.round(x / (SQRT3 * SPACING) - r / 2);
    return { q, r };
  }
  function ringOf(q, r) { return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)); }

  // ---- 数据 ----
  const tiles = [];
  const tileIndex = new Map();
  const byRing = [];
  let time = 0;

  // 构建平台：cfg = { ringMax, holes: 'none'|'scatter'|'line', lava, safeZone }
  function build(cfg) {
    cfg = cfg || {};
    RING_MAX = cfg.ringMax || 14;
    LAVA = !!cfg.lava;
    tiles.length = 0;
    tileIndex.clear();
    byRing.length = 0;
    time = 0;
    for (let k = 0; k <= RING_MAX; k++) byRing.push([]);
    for (let q = -RING_MAX; q <= RING_MAX; q++) {
      const rMin = Math.max(-RING_MAX, -q - RING_MAX);
      const rMax = Math.min(RING_MAX, -q + RING_MAX);
      for (let r = rMin; r <= rMax; r++) {
        const ring = ringOf(q, r);
        if (ring < 0 || ring > RING_MAX) continue;
        const p = hexToWorld(q, r);
        const idx = tiles.length;
        const shade = 0.60 + 0.10 * (ring / RING_MAX);
        tiles.push({
          q, r, x: p.x, z: p.z, ring,
          state: ST.SOLID, timer: 0, scale: 1,
          perm: false, pendingDelay: -1, shade, parity: (q + r) & 1,
          y: 0, // 坠落深度
          safe: false, // 随机安全区（见下方选择）
        });
        tileIndex.set(q + ',' + r, idx);
        byRing[ring].push(idx);
      }
    }
    // 预置永久空洞（多地图差异）
    const holes = cfg.holes || 'none';
    if (holes === 'scatter') {
      // 雷区：中圈随机约 4.5% 永久空洞
      for (const t of tiles) {
        if (t.ring < 2 || t.ring > RING_MAX - 3) continue;
        if (Math.random() < 0.045) { t.state = ST.DEAD; t.scale = 0; t.perm = true; }
      }
    } else if (holes === 'line') {
      // 裂谷：q+r==0 单条带穿过中心，中央留缺口（|q|<=1 处可通行）
      for (const t of tiles) {
        if (t.ring > RING_MAX - 2) continue;
        const s = -t.q - t.r;
        if (s === 0 && Math.abs(t.q) > 1) { t.state = ST.DEAD; t.scale = 0; t.perm = true; }
      }
    } else if (holes === 'custom') {
      // 自定义地图：由 holeList（[q,r] 数组）指定永久空洞
      const list = cfg.holeList || [];
      for (const [q, r] of list) {
        const key = q + ',' + r;
        if (tileIndex.has(key)) {
          const t = tiles[tileIndex.get(key)];
          t.state = ST.DEAD; t.scale = 0; t.perm = true;
        }
      }
    }

    // 随机安全区：1~3 块 7 格"绿洲"，位置随机、互不重叠
    // （碾过/老化不掉；缩圈到达它们所在圈时才崩塌）
    if (cfg.safeZone !== false) {
      const zoneCount = 1 + ((Math.random() * 3) | 0); // 有时 1 块，有时 2~3 块
      for (let z = 0; z < zoneCount; z++) {
        for (let tries = 0; tries < 20; tries++) {
          const zr = 3 + ((Math.random() * Math.max(1, RING_MAX - 5)) | 0);
          const ringTiles = byRing[zr];
          if (!ringTiles || !ringTiles.length) continue;
          const pick = ringTiles[(Math.random() * ringTiles.length) | 0];
          if (tiles[pick].state !== ST.SOLID) continue;
          const cq = tiles[pick].q, cr = tiles[pick].r;
          // 7 格花朵必须全部实心；且与其他安全区保持间隔（中心距 ≥3，避免边缘贴合成大块）
          let ok = true;
          for (const t of tiles) {
            const dq = t.q - cq, dr = t.r - cr;
            const dd = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
            if (dd <= 1 && t.state !== ST.SOLID) { ok = false; break; }
            if (dd <= 2 && t.safe) { ok = false; break; }
          }
          if (!ok) continue;
          for (const t of tiles) {
            const dq = t.q - cq, dr = t.r - cr;
            if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) <= 1) t.safe = true;
          }
          break;
        }
      }
    }
  }

  function idxAt(x, z) {
    const { q, r } = worldToHex(x, z);
    const key = q + ',' + r;
    if (!tileIndex.has(key)) return -1;
    const i = tileIndex.get(key);
    const t = tiles[i];
    const dx = x - t.x, dz = z - t.z;
    if (dx * dx + dz * dz > (HEX_R * 1.15) * (HEX_R * 1.15)) return -1;
    return i;
  }

  function isSolidIdx(i) {
    if (i < 0) return false;
    const t = tiles[i];
    if (t.state === ST.SOLID || t.state === ST.WARN) return true;
    if (t.state === ST.GROWING && t.scale > 0.7) return true;
    return false;
  }

  function isDangerIdx(i) {
    if (i < 0) return true;
    const t = tiles[i];
    if (t.state === ST.FALLING || t.state === ST.GONE || t.state === ST.DEAD) return true;
    if (t.state === ST.GROWING && t.scale <= 0.7) return true;
    return false;
  }

  function trigger(i) {
    const t = tiles[i];
    if (t.state !== ST.SOLID || t.safe) return; // 安全平台瓦片永不掉落
    t.state = ST.WARN;
    t.timer = LAVA ? LAVA_WARN_TIME : WARN_TIME;
  }

  // 永久摧毁某圈（缩圈，按角度错峰波浪崩塌）。
  // 随机安全区没有特殊保护：缩圈到达它所在圈时，它同样崩塌
  function killRing(ring, force) {
    if (ring <= 0 || ring > RING_MAX) return;
    const list = byRing[ring];
    list.forEach((i) => {
      const t = tiles[i];
      const ang = (Math.atan2(t.z, t.x) + Math.PI) / (Math.PI * 2);
      t.pendingDelay = ang * 0.9 + Math.random() * 0.5 + 0.15;
      t.perm = true;
    });
  }

  function update(dt) {
    time += dt;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];

      if (t.pendingDelay >= 0) {
        t.pendingDelay -= dt;
        if (t.pendingDelay < 0 && t.state !== ST.DEAD) {
          t.pendingDelay = -1;
          t.state = ST.FALLING;
          t.timer = 0;
          t.y = 0;
        } else if (t.pendingDelay < 0) {
          t.pendingDelay = -1;
        }
      }

      switch (t.state) {
        case ST.WARN:
          t.timer -= dt;
          if (t.timer <= 0) {
            t.state = ST.FALLING;
            t.timer = 0;
            t.y = 0;
          }
          break;
        case ST.FALLING:
          t.timer += dt;
          t.y -= FALL_SPEED * dt;
          if (t.timer > 1.3) {  // 快速掉完消失，洞尽快闭合
            if (t.perm || LAVA) { t.state = ST.DEAD; t.scale = 0; } // 熔岩/缩圈：永久消失
            else { t.state = ST.GONE; t.timer = REGROW_TIME; t.scale = 0; }
          }
          break;
        case ST.GONE:
          t.timer -= dt;
          if (t.timer <= 0) {
            t.state = ST.GROWING;
            t.timer = GROW_TIME;
            t.scale = 0.01;
          }
          break;
        case ST.GROWING:
          t.timer -= dt;
          t.scale = 1 - Math.max(0, t.timer / GROW_TIME);
          if (t.timer <= 0) { t.state = ST.SOLID; t.scale = 1; }
          break;
        default: break;
      }
    }
  }

  function nearestSolid(x, z, maxRing) {
    let best = -1, bestD = 1e9;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.ring > maxRing) continue;
      if (t.state !== ST.SOLID && !(t.state === ST.GROWING && t.scale > 0.3)) continue;
      const dx = t.x - x, dz = t.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function nearestSafe(x, z, maxRing, preferInward) {
    let best = -1, bestScore = 1e9;
    const r0 = Math.hypot(x, z);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.ring > maxRing) continue;
      if (t.state !== ST.SOLID && !(t.state === ST.GROWING && t.scale > 0.3)) continue;
      const dx = t.x - x, dz = t.z - z;
      let s = dx * dx + dz * dz;
      if (preferInward) {
        const rt = Math.hypot(t.x, t.z);
        s *= (rt < r0) ? 0.5 : 1.7;
      }
      if (s < bestScore) { bestScore = s; best = i; }
    }
    return best;
  }

  // 附近一定距离/角度/圈带内的坚实瓦片（从最近 6 块随机，AI 目标）
  function pickNearbySolid(x, z, minRing, maxRing, minD, maxD, angSpread, rng) {
    const cands = [];
    const a0 = Math.atan2(z, x);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.ring > maxRing || t.ring < minRing) continue;
      if (t.state !== ST.SOLID && !(t.state === ST.GROWING && t.scale > 0.3)) continue;
      const dx = t.x - x, dz = t.z - z;
      const d = Math.hypot(dx, dz);
      if (d < minD || d > maxD) continue;
      let diff = Math.atan2(dz, dx) - a0;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > angSpread) continue;
      cands.push([i, d]);
    }
    if (!cands.length) return -1;
    cands.sort((a, b) => a[1] - b[1]);
    const pool = Math.min(6, cands.length);
    return cands[(rng() * pool) | 0][0];
  }

  function randomWarnNearby(x, z, maxRing, rng) {
    const cands = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.ring > maxRing) continue;
      if (t.state !== ST.WARN) continue;
      const dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz < 30 * 30) cands.push(i);
    }
    if (!cands.length) return -1;
    return cands[(rng() * cands.length) | 0];
  }

  // 随机老化：一块随机坚实瓦片进入警告
  function randomDecay(outerRing) {
    for (let tries = 0; tries < 20; tries++) {
      const i = (Math.random() * tiles.length) | 0;
      const t = tiles[i];
      if (t.state !== ST.SOLID || t.safe) continue;
      if (t.ring > outerRing) continue;
      trigger(i);
      return;
    }
  }

  // 随机一块坚实瓦片（金币刷点等）
  function randomSolidAnywhere(maxRing, rng) {
    for (let tries = 0; tries < 30; tries++) {
      const i = ((rng || Math.random)() * tiles.length) | 0;
      const t = tiles[i];
      if (t.ring > maxRing) continue;
      if (t.state === ST.SOLID) return i;
    }
    return -1;
  }

  // 剩余坚实瓦片数（熔岩模式 HUD 用）
  function solidCount() {
    let n = 0;
    for (const t of tiles) if (t.state === ST.SOLID) n++;
    return n;
  }

  return {
    SPACING,
    // RING_MAX 是 let，用 getter 实时读取（build 后返回当前地图圈数）
    get RING_MAX() { return RING_MAX; },
    get LAVA() { return LAVA; },
    ST, HEX_R, WARN_TIME, tiles, tileIndex, byRing,
    build, update, idxAt, isSolidIdx, isDangerIdx, trigger, killRing,
    nearestSolid, nearestSafe, pickNearbySolid, randomWarnNearby, randomDecay,
    randomSolidAnywhere, solidCount,
  };
})();

if (typeof module !== 'undefined') module.exports = Grid;

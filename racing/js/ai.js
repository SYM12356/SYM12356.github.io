/* ============================================================
 * ai.js — AI 车手（三种性格 + 模式智能）
 * 保守：绕着圈走、避战求生；激进：找机会冲刺撞人；贪财：专追金币
 * 智能升级：
 *  - 目标选择：严格选实心瓦片、向内圈偏好、避免重复踩刚去过的格子
 *  - 过弯控速：转向误差大时减速（赛道/足球），不会高速冲出去
 *  - 避让升级：预测 0.4 秒后的车位置，能躲迎面车
 *  - 足球：控球者朝球门方向射门，2 个 AI 专职守门
 * ============================================================ */

const AI_PERSONALITY_LABEL = { conservative: '保守', aggressive: '激进', greedy: '贪财' };

// 弹幕吐槽台词池（头顶气泡）
const PHRASES = {
  fall: ['要掉了要掉了！', '啊啊脚下！', '救命啊！', '快跑快跑！'],
  hit: ['哎哟！', '谁啊！', '你等着！', '痛死了！', '别撞我！'],
  goal: ['嘿嘿，进了！', '漂亮！', '再来一球！', '我是球王！'],
  infect: ['不要啊！！', '我恨你！！', '好恶！', '救命啊！', '完了完了！'],
  infectOK: ['嘿嘿，传染成功！', '你也是感染者了！', '别怪我！'],
  coin: ['金币！我的！', '发财了！'],
};

class AIDriver {
  constructor(car, rng, diff) {
    this.car = car;
    this.rng = rng || Math.random;
    const dm = diff || { skillMin: 0.55, skillMax: 1.0, speedMult: 1 };
    this.diff = dm;
    this.targetIdx = -1;
    this.targetX = 0; this.targetZ = 0;
    this.repickTimer = 1.5 + this.rng() * 2;
    this.panic = 0;
    this.steerVal = 0;          // 转向平滑
    this.panicRefind = 0;       // 逃生目标刷新间隔
    this.jumpTimer = 0;         // 跳跃决策节流
    this.coinTimer = 0.4;       // 金币探测间隔
    this.coinTarget = null;     // 正在追的金币 {x, z, ttl}
    this.ramTarget = null;      // 激进：选定的冲撞目标车
    this.ramTimer = 0;
    this.visited = new Map();   // 最近访问过的瓦片（避免反复踩）
    this.aiTime = 0;
    this.goalie = false;        // 足球守门员
    this.goalIdx = 0;           // 守的球门编号
    this.trackMode = false;     // 竞速赛（赛道，可安全减速）
    this.football = false;
    // 性格（随机分配）
    const pool = ['conservative', 'aggressive', 'greedy'];
    this.personality = pool[(this.rng() * pool.length) | 0];
    car.personality = this.personality;
    car.name += '·' + AI_PERSONALITY_LABEL[this.personality];
    // 能力差异（难度决定技能范围与速度）
    this.skill = dm.skillMin + this.rng() * (dm.skillMax - dm.skillMin);
    car.maxSpeed = (7.8 + this.skill * 2.6) * dm.speedMult;
    car.accelMax = (7.2 + this.skill * 2.4) * dm.speedMult;
  }

  // 当前性格的避让安全距离（保守更怕撞车）
  avoidDist() {
    return this.personality === 'conservative' ? 3.4 : (this.personality === 'aggressive' ? 2.0 : 2.4);
  }

  // 金币探测半径（贪财看得远，保守不关心）
  coinRadius() {
    return this.personality === 'greedy' ? 24 : (this.personality === 'aggressive' ? 9 : 0);
  }

  // outerRing：当前最外层存活圈号（小于等于它的圈都安全）
  pickTarget(grid, outerRing) {
    const car = this.car;
    // 熔岩模式：目标是"远一点的新路"（近处都是刚被踩掉的坑），全向搜索
    if (this.lava) {
      let idx = grid.pickNearbySolid(car.x, car.z, 0, outerRing, 10, 30, Math.PI * 2, this.rng);
      if (idx < 0) idx = grid.nearestSafe(car.x, car.z, outerRing, false);
      if (idx >= 0) {
        const t = grid.tiles[idx];
        this.targetIdx = idx;
        this.targetX = t.x; this.targetZ = t.z;
      }
      return;
    }
    // 菜鸟偶尔会选到"快掉的瓦片"当目标（自寻死路）
    if (this.rng() < (1 - this.skill) * 0.1) {
      const wi = grid.randomWarnNearby(car.x, car.z, outerRing, this.rng);
      if (wi >= 0) {
        const w = grid.tiles[wi];
        this.targetIdx = wi;
        this.targetX = w.x; this.targetZ = w.z;
        return;
      }
    }
    // 车当前所在圈
    const foot = grid.idxAt(car.x, car.z);
    const carRing = foot >= 0
      ? grid.tiles[foot].ring
      : Math.max(0, Math.round(Math.hypot(car.x, car.z) / (grid.SPACING * 1.5)));
    const r0 = Math.hypot(car.x, car.z);
    // 打分制选目标：实心瓦片 + 向内圈偏好 + 别去刚去过的地方 + 随机分散
    let best = -1, bestScore = 1e9;
    for (const t of grid.tiles) {
      if (t.ring > outerRing - 1 || t.ring < Math.max(0, carRing - 5)) continue;
      if (t.state !== grid.ST.SOLID) continue; // 严格实心（不踩警告格）
      const dx = t.x - car.x, dz = t.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.5 * 2.5 || d2 > 34 * 34) continue;
      let score = d2;
      // 向内圈（离中心近）有优势：缩圈时更安全
      const rt = Math.hypot(t.x, t.z);
      if (rt < r0) score *= 0.62; else score *= 1.35;
      // 刚去过的地方少去（避免来回碾同一个格子）
      if (this.visited.has(t.q + ',' + t.r)) score *= 5;
      // 随机分散，避免全挤一处
      score *= 0.75 + this.rng() * 0.5;
      if (score < bestScore) { bestScore = score; best = grid.tiles.indexOf(t); }
    }
    if (best >= 0) {
      const t = grid.tiles[best];
      this.targetIdx = best;
      this.targetX = t.x + (this.rng() - 0.5) * 1.2;
      this.targetZ = t.z + (this.rng() - 0.5) * 1.2;
      return;
    }
    // 兜底：最近实心瓦片（赛道模式 outerRing 为 -1，用 RING_MAX）
    const ring = outerRing >= 0 ? outerRing : grid.RING_MAX;
    const idx = grid.nearestSafe(car.x, car.z, ring, false);
    if (idx >= 0) {
      const t = grid.tiles[idx];
      this.targetIdx = idx;
      this.targetX = t.x; this.targetZ = t.z;
    }
  }

  update(dt, grid, outerRing, cars, coins, ball, gm) {
    const car = this.car;
    if (!car.alive) return;
    this.lava = !!(gm && gm.mode === 'lava');
    this.trackMode = !!(gm && gm.cpRace);
    this.football = !!(gm && gm.mode === 'football');
    this.aiTime += dt;

    // 记录脚下瓦片（去重用，6 秒后失效）
    const footNow = grid.idxAt(car.x, car.z);
    if (footNow >= 0) {
      const t = grid.tiles[footNow];
      this.visited.set(t.q + ',' + t.r, this.aiTime);
      if (this.visited.size > 40) {
        for (const [k, v] of this.visited) if (this.aiTime - v > 6) this.visited.delete(k);
      }
    }

    // 出生后立即选目标（避免先朝 (0,0) 乱开）
    if (this.targetIdx < 0) this.pickTarget(grid, outerRing);

    // ---- 金币追逐（按性格：贪财最爱、激进顺路、保守无视）----
    const coinR = this.coinRadius();
    this.coinTimer -= dt;
    if (this.coinTarget) {
      this.coinTarget.ttl -= dt;
      if (this.coinTarget.ttl <= 0
          || Math.hypot(car.x - this.coinTarget.x, car.z - this.coinTarget.z) < 1.8) {
        this.coinTarget = null;
      }
    }
    if (coinR > 0 && this.coinTimer <= 0) {
      this.coinTimer = 0.35;
      if (!this.coinTarget && coins && coins.length) {
        let best = null, bestD = coinR * coinR;
        for (const c of coins) {
          const dx = c.x - car.x, dz = c.z - car.z;
          const d = dx * dx + dz * dz;
          if (d >= bestD || d < 4) continue;
          const ti = grid.idxAt(c.x, c.z);
          if (ti >= 0 && grid.isSolidIdx(ti)) { best = c; bestD = d; }
        }
        if (best) this.coinTarget = { x: best.x, z: best.z, ttl: this.personality === 'greedy' ? 2.5 : 1.5 };
      }
    }

    // ---- 激进：寻找机会创人 ----
    if (this.personality === 'aggressive') {
      this.ramTimer -= dt;
      if (this.ramTimer <= 0) {
        this.ramTimer = 0.7;
        let best = null, bestD = 20 * 20;
        for (const o of cars) {
          if (o === car || !o.alive || o.cloakT > 0) continue;
          const dx = o.x - car.x, dz = o.z - car.z;
          const d = dx * dx + dz * dz;
          if (d < bestD) { best = o; bestD = d; }
        }
        this.ramTarget = best;
      }
      if (this.ramTarget) {
        const dx = this.ramTarget.x - car.x, dz = this.ramTarget.z - car.z;
        if (!this.ramTarget.alive || dx * dx + dz * dz > 26 * 26) this.ramTarget = null;
      }
    }

    // 脚下瓦片正在掉落/已消失？→ 立刻逃向安全块（目标冻结 0.4s，避免追尾）
    const foot = grid.idxAt(car.x, car.z);
    if (grid.isDangerIdx(foot)) {
      this.panic = 1;
      this.panicRefind -= dt;
      if (this.panicRefind <= 0) {
        this.panicRefind = 0.4;
        if (this.lava) {
          // 熔岩：跳远一点的新路（近处全是刚踩掉的坑）
          let idx = grid.pickNearbySolid(car.x, car.z, 0, outerRing, 8, 26, Math.PI * 2, this.rng);
          if (idx < 0) idx = grid.nearestSafe(car.x, car.z, outerRing, false);
          if (idx >= 0) {
            const t = grid.tiles[idx];
            this.targetIdx = idx;
            this.targetX = t.x; this.targetZ = t.z;
          }
        } else {
          const safe = grid.nearestSafe(car.x, car.z, outerRing >= 0 ? outerRing : grid.RING_MAX, false); // 就近逃生
          if (safe >= 0) {
            const t = grid.tiles[safe];
            this.targetIdx = safe;
            this.targetX = t.x; this.targetZ = t.z;
          }
        }
      }
      // 弹幕吐槽：脚下快掉时惊慌
      if (!car.bubble && this.rng() < dt * 1.5) {
        car.bubble = { text: PHRASES.fall[(this.rng() * PHRASES.fall.length) | 0], t: 1.5 };
      }
    } else {
      this.panic = Math.max(0, this.panic - dt * 2);
    }

    // 定时重选目标
    this.repickTimer -= dt;
    if (this.repickTimer <= 0) {
      this.repickTimer = 1.4 + this.rng() * 2.4;
      this.pickTarget(grid, outerRing);
    }
    // 目标已不存在（被缩圈摧毁/掉落）→ 重选
    if (this.targetIdx >= 0) {
      const t = grid.tiles[this.targetIdx];
      if (t.state === grid.ST.DEAD || t.state === grid.ST.GONE) this.pickTarget(grid, outerRing);
    }
    // 快到目标 → 立即换目标，绝不能停下（停下脚下瓦片会掉）
    const distNow = Math.hypot(car.x - this.targetX, car.z - this.targetZ);
    if (distNow < 2.4 && this.panic < 0.5) {
      this.pickTarget(grid, outerRing);
      this.repickTimer = 1 + this.rng() * 1.5;
    }

    // ---- 转向：期望方向优先级 = 逃命 > 感染(追/逃) > 竞速赛检查点 > 足球(射门/守门) > 创人 > 追金币 > 正常目标 ----
    let desiredYaw;
    if (this.panic > 0.5) {
      desiredYaw = Math.atan2(this.targetX - car.x, this.targetZ - car.z);
    } else if (gm && gm.cpRace && gm.checkpoints && gm.checkpoints.length) {
      // 检查点竞速赛：朝自己下一个检查点开
      const cp = gm.checkpoints[car.cpNext % gm.checkpoints.length];
      desiredYaw = cp ? Math.atan2(cp.x - car.x, cp.z - car.z)
        : Math.atan2(this.targetX - car.x, this.targetZ - car.z);
    } else if (gm && gm.mode === 'infection' && (gm.infectedCount > 0 || gm.zombieCount > 0)) {
      // 感染模式：感染者追人，正常人逃命
      const nearest = (pred) => {
        let best = null, bd = 1e9;
        for (const o of cars) {
          if (o === car || !o.alive || o.zombie) continue;
          if (pred && !pred(o)) continue;
          const d = (o.x - car.x) * (o.x - car.x) + (o.z - car.z) * (o.z - car.z);
          if (d < bd) { bd = d; best = o; }
        }
        return best;
      };
      if (car.infected) {
        const tgt = nearest((o) => !o.infected); // 追最近的正常人
        if (tgt) {
          desiredYaw = Math.atan2(tgt.x - car.x, tgt.z - car.z);
          if (car.canDash() && this.rng() < 0.05 * this.skill) car.dash = true; // 感染冲刺
        } else {
          desiredYaw = Math.atan2(this.targetX - car.x, this.targetZ - car.z);
        }
      } else {
        const danger = nearest((o) => o.infected); // 最近的感染者
        if (danger) {
          // 逃：朝远离感染者 + 略偏向自己目标的方向
          const away = Math.atan2(car.x - danger.x, car.z - danger.z);
          const go = Math.atan2(this.targetX - car.x, this.targetZ - car.z);
          let diff = away - go;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          desiredYaw = Math.abs(diff) < 1.2 ? away : go; // 顺着逃跑方向走，别回头
        } else {
          desiredYaw = Math.atan2(this.targetX - car.x, this.targetZ - car.z);
        }
      }
    } else if (ball) {
      // 足球模式：多球时追离自己最近的
      const balls2 = Array.isArray(ball) ? ball : [ball];
      let b = balls2[0], bd = Infinity;
      for (const bb of balls2) {
        const dd = (bb.x - car.x) * (bb.x - car.x) + (bb.z - car.z) * (bb.z - car.z);
        if (dd < bd) { bd = dd; b = bb; }
      }
      if (this.goalie && gm && gm.goals && gm.goals.length) {
        // 守门员：站住球门位，球近了冲出去拦截
        const g = gm.goals[this.goalIdx % gm.goals.length];
        const dg = Math.hypot(car.x - g.x, car.z - g.z);
        const db = Math.hypot(b.x - car.x, b.z - car.z);
        if (dg > 9) {
          desiredYaw = Math.atan2(g.x - car.x, g.z - car.z); // 先回位
        } else {
          desiredYaw = Math.atan2(b.x - car.x, b.z - car.z); // 面向球
          if (db < 10 && car.canDash()) car.dash = true;     // 出击拦截
        }
      } else {
        // 普通球员：远→追球；近→对准球门方向射门
        const db = Math.hypot(b.x - car.x, b.z - car.z);
        if (gm && gm.goals && gm.goals.length && db < 9) {
          // 球指向的球门（球所在扇区的门）
          const angB = Math.atan2(b.z, b.x);
          const e = ((Math.round((angB * 180 / Math.PI) / 60) % 6) + 6) % 6;
          const g = gm.goals[e];
          // 瞄准"球 + 朝球门 8 单位"的点：把球往门里带/射
          const gdir = Math.atan2(g.z - b.z, g.x - b.x);
          desiredYaw = Math.atan2((b.x + Math.cos(gdir) * 8) - car.x, (b.z + Math.sin(gdir) * 8) - car.z);
          // 离门近且有角度 → 冲刺重炮
          if (car.canDash() && db < 5 && Math.hypot(g.x - b.x, g.z - b.z) < 30 && this.rng() < 0.2 * this.skill) {
            car.dash = true;
          }
        } else {
          desiredYaw = Math.atan2(b.x - car.x, b.z - car.z);
        }
      }
    } else if (this.ramTarget && this.personality === 'aggressive') {
      // 朝目标车的前方一点冲（预判走位）
      const ax = this.ramTarget.x + this.ramTarget.vx * 0.3;
      const az = this.ramTarget.z + this.ramTarget.vz * 0.3;
      desiredYaw = Math.atan2(ax - car.x, az - car.z);
    } else if (this.coinTarget) {
      desiredYaw = Math.atan2(this.coinTarget.x - car.x, this.coinTarget.z - car.z);
    } else {
      desiredYaw = Math.atan2(this.targetX - car.x, this.targetZ - car.z);
    }
    const spd = car.speed();
    // 反应距离随技能变化：越菜的 AI 看得越近，越容易失误
    const lookAhead = (4 + spd * 0.6) * (0.5 + this.skill * 0.5);

    // 偶尔失误：没注意到前方瓦片快掉了（技能越低越频繁）
    const mistake = this.rng() < (1 - this.skill) * 0.02;

    // 依次尝试：直行 → 小偏 → 大偏（避开掉落瓦片和其他车）
    const avoidD = this.avoidDist();
    const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6];
    let chosen = null;
    for (const off of offsets) {
      const y = desiredYaw + off;
      const px = car.x + Math.sin(y) * lookAhead;
      const pz = car.z + Math.cos(y) * lookAhead;
      const ti = grid.idxAt(px, pz);
      // 可通行判定与物理一致：SOLID 安全；WARN 若剩余时间充足（>1.0s，够冲过去）也可行
      let ok = ti >= 0 && grid.isSolidIdx(ti);
      if (ok && ti >= 0 && grid.tiles[ti].state === grid.ST.WARN) {
        ok = grid.tiles[ti].timer > 1.0;
      }
      if (!ok && !mistake) continue;
      // 前方有别的车 → 不选（看 0.4 秒后的预测位置，能躲迎面车；隐身车看不见）
      let clear = true;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c === car || !c.alive || c.cloakT > 0) continue;
        const px2 = c.x + c.vx * 0.4, pz2 = c.z + c.vz * 0.4;
        if ((px2 - px) * (px2 - px) + (pz2 - pz) * (pz2 - pz) < avoidD * avoidD) { clear = false; break; }
      }
      if (!clear) continue;
      chosen = off;
      break;
    }
    if (chosen === null) {
      // 全被挡：找最近的、短距内不危险的偏移方向，硬挤过去
      for (const off of offsets) {
        const y = desiredYaw + off;
        const px = car.x + Math.sin(y) * 3;
        const pz = car.z + Math.cos(y) * 3;
        const ti = grid.idxAt(px, pz);
        if (ti >= 0 && !grid.isDangerIdx(ti)) { chosen = off; break; }
      }
      if (chosen === null) chosen = 0;
    }

    // ---- 跳跃决策（跳过空洞 / 脚下快掉时逃跳）----
    if (car.canJump()) {
      this.jumpTimer -= dt;
      if (this.jumpTimer <= 0) {
        this.jumpTimer = 0.14; // 决策节流
        // 1) 前方是洞、按当前速度跳过去正好落在安全区 → 跳
        const jd = Math.min(car.speed() * car.jumpTimeMax, 13);
        if (jd > 3) {
          const y = desiredYaw + chosen;
          const mx = car.x + Math.sin(y) * jd * 0.5, mz = car.z + Math.cos(y) * jd * 0.5;
          const lx = car.x + Math.sin(y) * jd, lz = car.z + Math.cos(y) * jd;
          const tMid = grid.idxAt(mx, mz), tLand = grid.idxAt(lx, lz);
          if (grid.isDangerIdx(tMid) && grid.isSolidIdx(tLand) && this.rng() < (0.5 + this.skill * 0.5)) {
            car.jump();
          }
        }
        // 2) 脚下格已警告且剩余时间不足（快掉了）→ 立刻跳走
        const foot = grid.idxAt(car.x, car.z);
        if (!car.airborne && foot >= 0 && grid.tiles[foot].state === grid.ST.WARN
            && grid.tiles[foot].timer < 1.2 && this.rng() < (0.5 + this.skill * 0.5)) {
          car.jump();
        }
      }
    }

    // 转向 = 车头到(目标方向+偏移)的夹角误差（必须基于当前车头算，不能直接输出偏移）
    let err = desiredYaw + chosen - car.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    // 菜鸟转向带抖动
    err += (this.rng() - 0.5) * 0.7 * (1 - this.skill);
    const steer = Math.max(-1, Math.min(1, err * 1.8));
    this.steerVal += (steer - this.steerVal) * Math.min(1, dt * 7);
    car.steer = this.steerVal;

    // ---- 油门：生存模式始终全速（停下脚下瓦片会掉）；赛道/足球按弯道减速 ----
    let throttle = 1;
    if (spd > car.maxSpeed * 0.95) throttle = 0.85;
    if ((this.trackMode || this.football) && !this.panic) {
      // 过弯控速：转向误差越大越慢；技能越高越敢全速
      const errAbs = Math.min(2.2, Math.abs(err));
      throttle *= Math.max(0.3, 1 - errAbs * 0.62 * (1 - this.skill * 0.35));
      // 前方是坑/赛道边缘 → 大力减速，别高速冲出赛道
      const h = car.heading();
      const ahead = grid.idxAt(car.x + h.x * lookAhead * 1.4, car.z + h.z * lookAhead * 1.4);
      if (grid.isDangerIdx(ahead)) throttle = Math.min(throttle, 0.4);
    }
    car.throttle = throttle;
    car.handbrake = false;

    // ---- 冲刺冲撞（按性格）：激进狂创、贪财顺路、保守从不主动撞 ----
    if (car.canDash() && this.personality !== 'conservative' && !this.football) {
      const h2 = car.heading();
      if (this.personality === 'aggressive') {
        // 激进：盯着的目标在正前方就冲刺
        if (this.ramTarget && this.ramTarget.alive && this.rng() < 0.03 * this.skill) {
          const dx = this.ramTarget.x - car.x, dz = this.ramTarget.z - car.z;
          const d = Math.hypot(dx, dz);
          if (d < 13 && d > 1.5 && (dx * h2.x + dz * h2.z) / d > 0.6) car.dash = true;
        }
      } else if (this.rng() < 0.008 * this.skill) {
        // 贪财/普通：近距离正前方有车就撞
        for (let i = 0; i < cars.length; i++) {
          const o = cars[i];
          if (o === car || !o.alive) continue;
          const dx = o.x - car.x, dz = o.z - car.z;
          const d = Math.hypot(dx, dz);
          if (d < 7 && d > 1.5) {
            const dot = (dx * h2.x + dz * h2.z) / d;
            if (dot > 0.85) { car.dash = true; break; }
          }
        }
      }
    }
  }
}

// Node（模拟测试）导出；浏览器中忽略
if (typeof module !== 'undefined') module.exports = AIDriver;

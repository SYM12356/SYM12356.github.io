/* ============================================================
 * car.js — 赛车（纯 2D 物理，无渲染依赖；绘制在 draw.js）
 * 掉落机制：碾到的格子必掉落（在 grid.js 的 WARN_TIME 时间差内逃开即可）
 * ============================================================ */

class Car {
  constructor(opts) {
    this.name = opts.name;
    this.isPlayer = opts.isPlayer;
    this.color = opts.color || '#ffffff';
    this.accelMax = opts.accelMax || 10;
    this.maxSpeed = opts.maxSpeed || 11.5;
    this.brakeForce = 30;
    this.grip = 2.6;
    this.turnRate = 2.1;

    this.x = opts.x; this.z = opts.z;
    this.y = 0; this.vy = 0;
    this.yaw = opts.yaw || 0;
    this.vx = 0; this.vz = 0;
    this.alive = true;
    this.grounded = true;
    this.eliminatedAt = 0;
    this.userData = {};
    this.coinCount = 0;       // 本局收集的金币（玩家与 AI 都计）
    this.lastHitBy = null;    // 最后一次被谁高速撞击（撞人计数）
    this.grace = 0;
    this.throttle = 0;
    this.steer = 0;
    this.handbrake = false;
    // 特殊状态（新玩法）
    this.zombie = false;      // 僵尸车：被淘汰后游荡撞人
    this.infected = false;    // 感染模式：被感染标记
    this.infectTime = 0;      // 被感染时刻（决胜用）
    this.bubble = null;       // 头顶吐槽气泡 {text, t}
    // 跳跃
    this.airborne = false;
    this.jumpT = 0;
    this.jumpCd = 0;
    this.jumpQueued = 0;
    this.jumpTimeMax = 0.9;   // 跳跃滞空时间（全速+空中加速可跨 1~2 格空洞）
    // 冲撞冲刺
    this.dash = false;        // 输入：想冲刺
    this.dashT = 0;           // 冲刺剩余时间
    this.dashCd = 0;          // 冲刺冷却
    // 漂移 + 氮气
    this.nitro = 0;           // 氮气槽 0~1（漂移蓄能，满条自动喷氮气）
    this.drifting = false;    // 是否正在漂移（特效用）
    this.nitroFlash = 0;      // 氮气爆发标记（音效/粒子用）
    // 道具状态
    this.shieldT = 0;         // 护盾：抵消一次坠落
    this.cloakT = 0;          // 隐身：AI 看不到/撞不到
    this.magnetT = 0;         // 磁铁：自动吸金币
    this.missileT = 0;        // 导弹引信（到期命中目标）
    this.missileTarget = null;
    this.itemFlash = 0;       // 吃到道具闪光
    this.shieldBreak = false; // 护盾被消耗（特效）
    // 被撞状态
    this.stunT = 0;           // 眩晕剩余时间（无法加速）
    this.spinV = 0;           // 被撞旋转速度
    this.hitFlash = 0;        // 受击闪白
    this.hitEvent = 0;        // 本帧碰撞力度（供特效/音效）
  }

  // 能否起跳（地面、非空中、冷却结束）
  canJump() {
    return this.alive && !this.airborne && this.grounded && this.jumpCd <= 0 && this.y > -0.5;
  }

  jump() {
    if (!this.alive || this.airborne) return;
    if (!this.grounded || this.y < -0.5) {
      // 落地缓冲：落地瞬间立即起跳
      this.jumpQueued = 0.25;
      return;
    }
    if (this.jumpCd > 0) return;
    this._doJump();
  }

  _doJump() {
    this.airborne = true;
    this.jumpT = this.jumpTimeMax;
    this.grounded = false;
  }

  // 导弹命中：把目标强力撞飞（眩晕+击退+特效标记）
  hitMissile(target) {
    let dx = target.x - this.x, dz = target.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const power = 12;
    target.vx += dx * power; target.vz += dz * power;
    target.stunT = Math.max(target.stunT, 0.55);
    target.spinV = (Math.random() - 0.5) * 8;
    target.hitEvent = Math.max(target.hitEvent || 0, 14);
    target.hitFlash = 0.3;
    target.lastHitBy = this;
  }

  // 能否冲刺冲撞（地面、非空中、冷却结束）
  canDash() {
    return this.alive && !this.airborne && this.grounded && this.dashCd <= 0 && this.dashT <= 0;
  }

  heading() {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  speed() {
    return Math.hypot(this.vx, this.vz);
  }

  update(dt, grid) {
    if (!this.alive && !this.zombie) return;

    const h = this.heading();

    // ---- 冲刺/眩晕状态 ----
    if (this.dashT > 0) this.dashT -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.yaw += this.spinV * dt; // 被撞打转
      this.spinV *= (1 - dt * 3);
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.itemFlash > 0) this.itemFlash -= dt;
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.cloakT > 0) this.cloakT -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.missileT > 0) {
      this.missileT -= dt;
      if (this.missileT <= 0 && this.missileTarget && this.missileTarget.alive) {
        this.hitMissile(this.missileTarget); // 导弹命中
      }
      this.missileTarget = null;
    }
    if (this.dash && this.canDash()) {
      this.dashT = 0.65;
      this.dashCd = 1.1;
      // 起步爆发：瞬间向前猛冲一截
      this.vx += h.x * 4;
      this.vz += h.z * 4;
    }

    // ---- 漂移蓄氮气：手刹 + 有速度 + 在转向 → 蓄能；满条自动喷氮气 ----
    if (this.handbrake && this.speed() > 3.5 && Math.abs(this.steer) > 0.3 && !this.airborne) {
      this.nitro = Math.min(1, this.nitro + dt * 0.45);
      this.drifting = true;
    } else {
      this.drifting = false;
    }
    if (this.nitro >= 1) {
      this.nitro = 0;
      this.dashT = Math.max(this.dashT, 0.85);
      this.nitroFlash = 1.2;
    }
    if (this.nitroFlash > 0) this.nitroFlash -= dt;

    // ---- 护盾保命：坠落太深时消耗护盾传送回安全瓦片 ----
    if (this.alive && this.shieldT > 0 && this.y < -7 && !this.airborne) {
      const safe = grid.nearestSafe(this.x, this.z, grid.RING_MAX, false);
      if (safe >= 0) {
        this.shieldT = 0;
        this.shieldBreak = true;
        const t = grid.tiles[safe];
        this.x = t.x; this.z = t.z;
        this.y = 0; this.vy = 0;
        this.grounded = true;
        this.itemFlash = 0.6;
      }
    }

    // ---- 转向（眩晕时转向受限）----
    const steerEff = this.stunT > 0 ? this.steer * 0.25 : this.steer;
    let turn = steerEff * this.turnRate;
    if (this.handbrake) turn *= 1.6;
    this.yaw += turn * dt;

    // 速度方向朝车头靠拢（抓地力）
    const spd = this.speed();
    if (spd > 0.001) {
      const dot = (this.vx * h.x + this.vz * h.z) / spd;
      const clamped = Math.max(-1, Math.min(1, dot));
      const ang = Math.acos(clamped);
      const sign = (this.vx * h.z - this.vz * h.x) >= 0 ? 1 : -1;
      const gripNow = this.grip * (this.handbrake ? 0.55 : 1) * (0.35 + Math.min(1, spd * 0.06));
      const rot = Math.min(ang, gripNow * dt);
      const a = sign * rot;
      const cos = Math.cos(a), sin = Math.sin(a);
      const nx = this.vx * cos - this.vz * sin;
      const nz = this.vx * sin + this.vz * cos;
      this.vx = nx; this.vz = nz;
    }

    // ---- 油门 / 刹车 / 倒车（冲刺加速、眩晕无法加速）----
    const dashing = this.dashT > 0;
    const accelEff = dashing ? this.accelMax * 1.8 : this.accelMax;
    const thr = (this.stunT > 0) ? 0 : this.throttle; // 眩晕时被"锁油"
    if (thr > 0) {
      this.vx += h.x * accelEff * thr * dt;
      this.vz += h.z * accelEff * thr * dt;
    } else if (thr < 0) {
      if (spd > 0.6) {
        const dec = this.brakeForce * dt;
        const ns = Math.max(0, spd - dec);
        if (spd > 0) { this.vx *= ns / spd; this.vz *= ns / spd; }
      } else {
        this.vx -= h.x * this.accelMax * 0.45 * (-thr) * dt;
        this.vz -= h.z * this.accelMax * 0.45 * (-thr) * dt;
      }
    }

    // ---- 阻力 & 极速（冲刺极速提高；手刹漂移不再猛掉速，蓄氮气才有意义）----
    const spd2 = this.speed();
    const drag = this.handbrake ? 0.95 : 0.55;
    if (spd2 > 0) {
      const ns = Math.max(0, spd2 - drag * spd2 * dt);
      this.vx *= ns / spd2; this.vz *= ns / spd2;
    }
    const maxEff = dashing ? this.maxSpeed * 1.5 : this.maxSpeed;
    const spd3 = this.speed();
    if (spd3 > maxEff) {
      this.vx *= maxEff / spd3; this.vz *= maxEff / spd3;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    if (this.grace > 0) this.grace -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    if (this.jumpQueued > 0) this.jumpQueued -= dt;

    // ---- 空中（跳跃）：不检测地面、不触发瓦片，落地后判定 ----
    if (this.airborne) {
      this.jumpT -= dt;
      if (this.jumpT <= 0) {
        this.airborne = false;
        this.jumpCd = 0.25;
        const idx = grid.idxAt(this.x, this.z);
        if (grid.isSolidIdx(idx)) { this.y = 0; this.vy = 0; this.grounded = true; }
        else { this.grounded = false; } // 落进空洞 → 下方坠落逻辑接手
      }
      return;
    }

    // ---- 地面检测 ----
    const idx = grid.idxAt(this.x, this.z);
    if (grid.isSolidIdx(idx)) {
      this.y = 0; this.vy = 0; this.grounded = true;
      // 必掉落：碾到就触发，靠 WARN_TIME 的时间差逃开
      // （快速通过安全；慢速/停留超过时间差就会连人带格子掉下去）
      if (this.grace <= 0) grid.trigger(idx);
    } else {
      this.grounded = false;
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      if (this.y < -16) {
        this.alive = false;
        this.zombie = false; // 僵尸车坠入深渊：彻底消失
        this.eliminatedAt = performance.now();
        this.vy = Math.max(this.vy, -12);
      }
    }

    // 落地缓冲：落地瞬间立即起跳（按键提前按也有效）
    if (this.jumpQueued > 0 && this.grounded) {
      this.jumpQueued = 0;
      this._doJump();
    }
  }
}

// 碰撞：两车相推 + 弹性分离（僵尸车也会撞人）
function carCollide(cars) {
  const n = cars.length;
  for (let i = 0; i < n; i++) {
    const a = cars[i];
    if (!a.alive && !a.zombie) continue;
    for (let j = i + 1; j < n; j++) {
      const b = cars[j];
      if (!b.alive && !b.zombie) continue;
      let dx = b.x - a.x, dz = b.z - a.z;
      let d2 = dx * dx + dz * dz;
      const minD = 1.8;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        dx /= d; dz /= d;
        // 位置分离
        const push = (minD - d) * 0.7 + 0.05;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;

        // 冲撞：沿碰撞轴的靠近速率决定冲击力（冲刺撞人更狠）
        const rel = (a.vx - b.vx) * dx + (a.vz - b.vz) * dz;
        if (rel > 0) {
          const aDash = a.dashT > 0, bDash = b.dashT > 0;
          const impact = rel * (aDash || bDash ? 1.7 : 1.0);
          // 速度对撞交换
          const imp = impact * 0.55;
          a.vx -= imp * dx; a.vz -= imp * dz;
          b.vx += imp * dx; b.vz += imp * dz;
          // 高速相撞 → 击退眩晕 + 打转 + 受击特效（护盾可免眩晕）
          if (impact > 5) {
            const stun = Math.min(0.4, 0.12 + impact * 0.015);
            if (!aDash && a.shieldT <= 0) { a.stunT = Math.max(a.stunT, stun); a.spinV = (Math.random() - 0.5) * impact * 0.035; }
            if (!bDash && b.shieldT <= 0) { b.stunT = Math.max(b.stunT, stun); b.spinV = (Math.random() - 0.5) * impact * 0.035; }
            a.hitEvent = Math.max(a.hitEvent || 0, impact);
            b.hitEvent = Math.max(b.hitEvent || 0, impact);
            a.hitFlash = 0.2; b.hitFlash = 0.2;
            // 记录肇事者（撞人计数用）：冲刺者优先，否则速度大的一侧
            const causer = aDash ? a : (bDash ? b
              : ((Math.abs(a.vx) + Math.abs(a.vz)) >= (Math.abs(b.vx) + Math.abs(b.vz)) ? a : b));
            if (causer === a) b.lastHitBy = a; else a.lastHitBy = b;
          }
        }
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Car, carCollide };

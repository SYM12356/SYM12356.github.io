/* ============================================================
 * draw.js — 2D 渲染核心（浏览器 Canvas 与 Node 测试渲染器共用）
 * 只用最基础的 ctx 原语：beginPath/moveTo/lineTo/closePath/fill/
 * arc/fillRect/save/restore/globalAlpha/fillStyle，保证可移植。
 * 坐标系：世界 (x,z) → 屏幕通过 view 计算（无旋转，北朝上）。
 * ============================================================ */

const Draw = (() => {
  // 世界→屏幕（支持相机旋转：v.rot 使车头方向对齐屏幕上方）
  function toScreen(x, z, v) {
    const dx = x - v.camX, dz = z - v.camZ;
    const cr = Math.cos(v.rot || 0), sr = Math.sin(v.rot || 0);
    return [v.cx + (dx * cr + dz * sr) * v.zoom, v.cy + (-dx * sr + dz * cr) * v.zoom];
  }

  // 六边形顶点角：偏移 30°，使"平边"正对相邻格子方向（轴向邻居方向为 0°,60°...）
  // 这是该轴向网格的标准密铺朝向：相邻六边形共享同一条边
  function hexAngle(k) {
    return Math.PI / 6 + (k / 6) * Math.PI * 2;
  }

  function hexPts(sx, sy, r) {
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = hexAngle(k);
      pts.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]);
    }
    return pts;
  }

  // 世界坐标的六边形顶点，经相机（含旋转）投影到屏幕
  // 顶点角固定在世界方向，旋转时整个六边形跟着转
  function hexWorld(x, z, R, v) {
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = hexAngle(k);
      pts.push(toScreen(x + Math.cos(a) * R, z + Math.sin(a) * R, v));
    }
    return pts;
  }

  function poly(ctx, pts, color) {
    if (pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // 平台底座：整个区域底色（被摧毁的圈露出这个深色）
  function platformBase(ctx, v) {
    const R = (v.grid.RING_MAX + 0.5) * v.grid.SPACING * Math.sqrt(3);
    poly(ctx, hexWorld(0, 0, R, v), '#101828');
    // 平台外围一圈微弱光晕
    const r2 = (v.grid.RING_MAX + 1) * v.grid.SPACING * Math.sqrt(3);
    poly(ctx, hexWorld(0, 0, r2, v), '#182440');
  }

  // 单块六边形瓦片（顶点随相机旋转）
  function tile(ctx, t, v, time) {
    const R = v.grid.HEX_R;
    let fill, rScale = 1, alpha = 1;
    let ox = 0, oy = 0; // 抖动/坠落偏移（屏幕像素）
    const day = (v.day != null) ? v.day : 1;
    const dim = 0.42 + 0.58 * day; // 夜晚瓦片变暗

    if (t.state === v.grid.ST.SOLID) {
      if (t.road) {
        // 异型赛道：沥青路面（深灰，随昼夜微变）
        const l = (0.26 + 0.045 * (t.parity ? 0 : 1)) * dim;
        fill = `hsl(216, 14%, ${(l * 100).toFixed(1)}%)`;
      } else {
        const l = (t.shade + (t.parity ? 0 : 0.09)) * dim;
        fill = `hsl(210, 22%, ${(l * 100).toFixed(1)}%)`;
      }
    } else if (t.state === v.grid.ST.WARN) {
      // 橙色深浅 = 剩余时间：刚触发亮橙（还有时间），快掉了变暗红
      const rem = Math.max(0, Math.min(1, t.timer / v.grid.WARN_TIME));
      const pulse = 0.5 + 0.5 * Math.sin(time * 10);
      const hue = 25 - 12 * (1 - rem);
      const light = (42 + 24 * rem + pulse * 6) * dim;
      fill = `hsl(${hue.toFixed(1)}, 95%, ${light.toFixed(1)}%)`;
      ox = (Math.random() - 0.5) * 1.6;
      oy = (Math.random() - 0.5) * 1.6;
    } else if (t.state === v.grid.ST.FALLING) {
      fill = 'hsl(0, 80%, 42%)';
      rScale = Math.max(0.12, 1 - t.timer * 0.22);
      alpha = Math.max(0.12, 1 - t.timer * 0.3);
      oy = Math.min(50, t.timer * 34);
      ox = (Math.random() - 0.5) * 1.2;
    } else if (t.state === v.grid.ST.GROWING) {
      const l = (t.shade + (t.parity ? 0 : 0.09) + 0.16) * dim;
      fill = `hsl(210, 22%, ${(l * 100).toFixed(1)}%)`;
      rScale = Math.max(0.02, t.scale);
    } else {
      // GONE / DEAD：只留深色凹槽
      ctx.globalAlpha = 0.6;
      poly(ctx, hexWorld(t.x, t.z, R * 0.85, v), '#0c1322');
      ctx.globalAlpha = 1;
      return;
    }

    // 屏幕像素抖动/坠落偏移（投影后叠加）
    const off = (p) => [p[0] + ox, p[1] + oy];
    ctx.globalAlpha = alpha;
    // 密铺：六边形边缘相贴，之间只留细边线
    // 路面瓦片：浅色路缘（区别于深坑）；安全平台（中心）：金色边框 + 翠绿填充，永不掉落
    const isSafe = t.safe && !t.road && t.state === v.grid.ST.SOLID;
    const isRoad = t.road && t.state === v.grid.ST.SOLID;
    const edgeColor = isSafe ? '#8a6d1a' : (isRoad ? '#9aa3b5' : '#151d2e');
    poly(ctx, hexWorld(t.x, t.z, R * (isSafe || isRoad ? 1.045 : 1.015) * rScale, v).map(off), edgeColor);
    poly(ctx, hexWorld(t.x, t.z, R * (isSafe || isRoad ? 1.0 : 0.985) * rScale, v).map(off), isSafe ? '#3fa04f' : fill);
    // 安全平台呼吸光环
    if (isSafe) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      ctx.globalAlpha = 0.18 + pulse * 0.14;
      poly(ctx, hexWorld(t.x, t.z, R * 1.09, v), '#6bff8a');
      ctx.globalAlpha = alpha;
    }
    ctx.globalAlpha = 1;
  }

  // 赛车（旋转的近似圆角矩形 + 玻璃 + 玩家光环）
  function car(ctx, c, v, time) {
    const [sx, sy] = toScreen(c.x, c.z, v);
    const s = v.zoom;
    let scale = 1, alpha = 1;
    if (c.airborne) {
      // 空中：车放大（视觉升高），影子留在原地更深
      scale = 1.18;
    } else if (!c.grounded) {
      scale = Math.max(0.3, 1 + c.y * 0.035);
      alpha = Math.max(0.3, 1 + c.y * 0.05);
    }
    if (c.cloakT > 0) alpha *= 0.45; // 隐身：半透明
    const L = 1.95 * s * scale;   // 半长（车更大）
    const Wd = 1.0 * s * scale;   // 半宽（车更大）

    // 车在屏幕上的朝向：把世界车头方向经相机旋转投影到屏幕
    const cr = Math.cos(v.rot || 0), sr = Math.sin(v.rot || 0);
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const sfx = fx * cr + fz * sr;
    const sfy = -fx * sr + fz * cr;
    let spriteAng = Math.atan2(-sfx, sfy); // 车头指向屏幕的旋转角
    if (c.airborne) spriteAng += 0.15 * Math.sin(time * 20); // 空中轻微倾斜（动态感）

    const rot = (px, pz) => {
      const cos = Math.cos(spriteAng), sin = Math.sin(spriteAng);
      return [sx + px * cos - pz * sin, sy + px * sin + pz * cos];
    };

    // 阴影（空中时更深更大，凸显高度）
    ctx.globalAlpha = (c.airborne ? 0.55 : 0.4) * alpha;
    ctx.beginPath();
    ctx.arc(sx + 3 * (v.zoom / 13), sy + 4 * (v.zoom / 13), L * (c.airborne ? 0.95 : 0.85), 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.globalAlpha = alpha;

    // 跳跃光环：起跳后车下方扩散的淡蓝光圈
    if (c.airborne) {
      const airT = Math.max(0, c.jumpTimeMax - c.jumpT);
      const ar = (9 + airT * 30) * (v.zoom / 11.5);
      ctx.globalAlpha = Math.max(0, 0.4 * (1 - airT / c.jumpTimeMax));
      ctx.beginPath();
      ctx.arc(sx, sy, ar, 0, Math.PI * 2);
      ctx.fillStyle = '#cfe9ff';
      ctx.fill();
      ctx.globalAlpha = alpha;
    }

    // 车身（8 边形圆角近似）——注意：车长沿本地 pz（+pz 是车头），
    // 与物理朝向 (sin yaw, cos yaw) 一致，yaw=0 时车头朝屏幕下方（+z 方向）
    const body = [
      rot(Wd * 0.55, L), rot(Wd, L * 0.6), rot(Wd, -L * 0.6),
      rot(Wd * 0.55, -L), rot(-Wd * 0.55, -L), rot(-Wd, -L * 0.6),
      rot(-Wd, L * 0.6), rot(-Wd * 0.55, L),
    ];
    // 僵尸车：灰绿车身
    const bodyColor = c.zombie ? '#6a6f52' : (c.isPlayer ? '#2f6bff' : c.color);
    poly(ctx, body, bodyColor);
    // 僵尸红眼（车头两盏红光）
    if (c.zombie) {
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(sx + Math.sin(spriteAng) * L * 0.9 - Math.cos(spriteAng) * Wd * 0.45, sy - Math.cos(spriteAng) * L * 0.9 - Math.sin(spriteAng) * Wd * 0.45, 1.7 * s * scale, 0, Math.PI * 2); ctx.fillStyle = '#ff3b30'; ctx.fill();
      ctx.beginPath(); ctx.arc(sx + Math.sin(spriteAng) * L * 0.9 + Math.cos(spriteAng) * Wd * 0.45, sy - Math.cos(spriteAng) * L * 0.9 + Math.sin(spriteAng) * Wd * 0.45, 1.7 * s * scale, 0, Math.PI * 2); ctx.fillStyle = '#ff3b30'; ctx.fill();
    }
    // 感染光环（紫红呼吸圈）
    if (c.infected) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      ctx.globalAlpha = (0.32 + pulse * 0.25) * alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, (2.6 + pulse * 0.2) * s * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#c44dff';
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    // 冲刺尾焰（车尾后方喷火：本地 px=侧向, pz=车长方向,-pz 为车尾）
    if (c.dashT > 0) {
      const fl = 0.6 + 0.4 * Math.sin(time * 40);
      const flameLen = L * (0.7 + fl * 0.8);
      ctx.globalAlpha = (0.75 + 0.25 * Math.sin(time * 45)) * alpha;
      const flame = (side, halfW) => [
        rot(side * Wd * 0.55, -L * 0.9),
        rot(side * Wd * 0.55 + halfW * 0.5, -L * 1.05),
        rot(side * Wd * 0.3, -L * 1.05 - flameLen * 0.8),
      ];
      poly(ctx, flame(-1, 1), '#ff9a3d');
      poly(ctx, flame(1, 1), '#ff9a3d');
      poly(ctx, flame(-1, 0.5), '#ffe14d');
      poly(ctx, flame(1, 0.5), '#ffe14d');
      ctx.globalAlpha = alpha;
    }
    // 受击闪白
    if (c.hitFlash > 0) {
      ctx.globalAlpha = (c.hitFlash / 0.2) * 0.7;
      poly(ctx, body, '#ffffff');
      ctx.globalAlpha = alpha;
    }
    // 引擎盖亮条（车头方向）
    poly(ctx, [rot(Wd * 0.4, L * 0.45), rot(Wd * 0.28, L * 0.9), rot(-Wd * 0.28, L * 0.9), rot(-Wd * 0.4, L * 0.45)], 'rgba(255,255,255,0.35)');
    // 挡风玻璃（车头略后方）
    poly(ctx, [rot(Wd * 0.72, L * 0.12), rot(Wd * 0.72, L * 0.45), rot(-Wd * 0.72, L * 0.3), rot(-Wd * 0.72, -L * 0.03)], '#9fd0ff');
    // 尾翼（车尾）
    poly(ctx, [rot(Wd * 0.95, -L * 0.85), rot(Wd * 0.8, -L * 1.0), rot(-Wd * 0.8, -L * 1.0), rot(-Wd * 0.95, -L * 0.85)], 'rgba(0,0,0,0.35)');
    // 刹车灯（车尾）
    const braking = c.throttle < -0.05 || c.handbrake;
    if (braking) {
      poly(ctx, [rot(Wd * 0.5, -L * 0.98), rot(Wd * 0.6, -L * 0.9), rot(-Wd * 0.6, -L * 0.9), rot(-Wd * 0.5, -L * 0.98)], '#ff3b30');
    }

    // 玩家光环
    if (c.isPlayer) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 5);
      ctx.globalAlpha = (0.4 + pulse * 0.35) * alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, (2.3 + pulse * 0.12) * s * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#7fd4ff';
      ctx.fill();
      ctx.globalAlpha = alpha;
    }

    // 性格徽章（AI 专属）：绿=保守 红=激进 金=贪财
    if (c.personality && !c.isPlayer) {
      const badge = c.personality === 'conservative' ? '#6bd96b'
        : (c.personality === 'aggressive' ? '#ff4d4d' : '#ffd23e');
      ctx.globalAlpha = 0.95 * alpha;
      ctx.beginPath();
      ctx.arc(sx + 15 * (v.zoom / 9), sy - 17 * (v.zoom / 9), 4.5 * (v.zoom / 9), 0, Math.PI * 2);
      ctx.fillStyle = badge;
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    // 护盾气泡（蓝色呼吸圆罩）
    if (c.shieldT > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 8);
      ctx.globalAlpha = (0.28 + pulse * 0.2) * alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, (2.5 + pulse * 0.15) * s * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#5dd6ff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 吃到道具闪光
    if (c.itemFlash > 0) {
      ctx.globalAlpha = (c.itemFlash / 0.6) * 0.7;
      poly(ctx, body, '#ffffff');
      ctx.globalAlpha = 1;
    }
    // 头顶吐槽气泡（AI 弹幕）
    if (c.bubble && c.bubble.t > 0 && ctx.fillText) {
      const bt = Math.min(1, c.bubble.t * 3); // 淡出
      const txt = c.bubble.text;
      const bx = sx, by = sy - 2.6 * s * scale;
      const fs = Math.max(10, 0.62 * s * scale);
      ctx.globalAlpha = 0.92 * bt;
      ctx.font = '700 ' + fs + 'px sans-serif';
      const tw = ctx.measureText ? ctx.measureText(txt).width : txt.length * fs;
      const bw = tw + fs, bh = fs * 1.7;
      // 气泡本体
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx - bw / 2, by - bh, bw, bh, bh * 0.45) : ctx.rect(bx - bw / 2, by - bh, bw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // 小尾巴
      ctx.beginPath();
      ctx.moveTo(bx - fs * 0.3, by - bh * 0.25);
      ctx.lineTo(bx + fs * 0.3, by - bh * 0.25);
      ctx.lineTo(bx, by + fs * 0.35);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // 文字
      ctx.fillStyle = '#1a1a2e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, bx, by - bh / 2);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }

  // 缩圈边界：沿当前最外圈轮廓的发光警示点
  function ringEdge(ctx, outerRing, v, time, collapseTimer) {
    if (outerRing < 0) return;
    // 密铺朝向（平边在 0°,60°...）：边界贴合最外层瓦片的平边
    const R = (outerRing + 0.5) * v.grid.SPACING * 2;
    const pts = hexPts(0, 0, R); // 世界坐标顶点（平边朝 0°,60°... 方向）
    const warn = collapseTimer < 3;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const seg = t * 6, si = Math.floor(seg) % 6, s2 = (si + 1) % 6;
      const f = seg - Math.floor(seg);
      const wx = pts[si][0] + (pts[s2][0] - pts[si][0]) * f;
      const wz = pts[si][1] + (pts[s2][1] - pts[si][1]) * f;
      const [sx, sy] = toScreen(wx, wz, v);
      const pulse = 0.5 + 0.5 * Math.sin(time * 6 + i * 0.7);
      const rr = (warn ? 3.2 + pulse * 2 : 2.1 + pulse * 1.1) * (v.zoom / 13);
      ctx.beginPath();
      ctx.arc(sx, sy, rr, 0, Math.PI * 2);
      ctx.fillStyle = warn ? `rgba(255,70,55,${(0.5 + pulse * 0.45).toFixed(2)})`
                           : `rgba(255,180,80,${(0.3 + pulse * 0.3).toFixed(2)})`;
      ctx.fill();
    }
  }

  // 粒子（淘汰爆炸 / 瓦片尘埃）
  function particles(ctx, list, v) {
    for (const p of list) {
      const [sx, sy] = toScreen(p.x, p.z, v);
      const alpha = Math.max(0, 1 - p.t / p.life);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r * (v.zoom / 13) * (0.5 + 0.5 * alpha), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 全屏背景（昼夜：白天亮蓝，夜晚深蓝 + 星星）
  const STAR_SEED = [0.42, 0.83, 0.15, 0.67, 0.31, 0.91, 0.07, 0.55, 0.24, 0.76, 0.48, 0.88, 0.12, 0.63, 0.36, 0.72, 0.02, 0.57, 0.94, 0.28];
  function background(ctx, v) {
    const day = (v.day != null) ? v.day : 1;
    // 夜间背景 #0a0f1e → 白天 #2e5f9e
    const r = Math.round(10 + (46 - 10) * day);
    const g = Math.round(15 + (95 - 15) * day);
    const b = Math.round(30 + (158 - 30) * day);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, v.W, v.H);
    // 夜晚星星
    if (day < 0.55) {
      const starA = Math.min(1, (0.55 - day) * 2.2);
      for (let i = 0; i < 24; i++) {
        const sx = (STAR_SEED[i % STAR_SEED.length] * 7919) % 1;
        const sy = (STAR_SEED[(i + 7) % STAR_SEED.length] * 104729) % 1;
        ctx.globalAlpha = Math.min(1, starA * (0.5 + 0.5 * Math.abs(Math.sin(v.time * 1.3 + i * 2.1))) * 1.9);
        ctx.beginPath();
        ctx.arc(sx * v.W, sy * v.H * 0.85, 1.1 + (i % 3), 0, Math.PI * 2);
        ctx.fillStyle = '#dfe9ff';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // 道具（彩色六边形 + 图标）：rocket火箭/shield护盾/magnet磁铁/missile导弹/cloak隐身
  const ITEM_COLORS = { rocket: '#ff5d5d', shield: '#5dd6ff', magnet: '#ff9a3d', missile: '#c06bff', cloak: '#9aa7bd' };
  function item(ctx, x, z, v, time, type, spin) {
    const [sx, sy] = toScreen(x, z, v);
    const r = 0.6 * v.zoom * (1 + 0.12 * Math.sin(time * 5 + (spin || 0)));
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + time * 1.2 + (spin || 0);
      pts.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]);
    }
    // 光晕
    ctx.globalAlpha = 0.4 + 0.25 * Math.sin(time * 5 + (spin || 0));
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = ITEM_COLORS[type] || '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 1;
    poly(ctx, pts, ITEM_COLORS[type] || '#ffffff');
    // 白色图标
    const rr = r * 0.42;
    if (type === 'rocket') {
      poly(ctx, [[sx, sy - rr * 1.4], [sx - rr * 0.8, sy + rr * 0.2], [sx - rr * 0.15, sy + rr * 0.2], [sx - rr * 0.15, sy + rr * 1.4], [sx + rr * 0.8, sy - rr * 0.2], [sx + rr * 0.15, sy - rr * 0.2], [sx + rr * 0.15, sy - rr * 1.4]], '#fff');
    } else if (type === 'shield') {
      poly(ctx, [[sx - rr, sy + rr * 0.8], [sx - rr, sy - rr * 0.4], [sx, sy - rr * 1.2], [sx + rr, sy - rr * 0.4], [sx + rr, sy + rr * 0.8], [sx, sy + rr * 1.2]], '#fff');
    } else if (type === 'magnet') {
      poly(ctx, [[sx - rr * 0.9, sy + rr * 1.1], [sx - rr * 0.9, sy - rr * 0.9], [sx - rr * 0.3, sy - rr * 0.9], [sx - rr * 0.3, sy + rr * 1.1], [sx + rr * 0.3, sy + rr * 1.1], [sx + rr * 0.3, sy - rr * 0.9], [sx + rr * 0.9, sy - rr * 0.9], [sx + rr * 0.9, sy + rr * 1.1], [sx + rr * 0.3, sy + rr * 1.1], [sx - rr * 0.3, sy + rr * 1.1]], '#fff');
    } else if (type === 'missile') {
      poly(ctx, [[sx, sy - rr * 1.3], [sx + rr, sy - rr * 0.1], [sx + rr * 0.3, sy + rr * 0.4], [sx + rr * 0.3, sy + rr * 1.3], [sx - rr * 0.3, sy + rr * 1.3], [sx - rr * 0.3, sy + rr * 0.4], [sx - rr, sy - rr * 0.1]], '#fff');
    } else {
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(sx, sy - rr * 0.3, rr * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy + rr * 0.9, rr * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // 金币（旋转的金色六边形 + 光晕）
  function coin(ctx, x, z, v, time, spin) {
    const [sx, sy] = toScreen(x, z, v);
    const r = 0.55 * v.zoom * (1 + 0.12 * Math.sin(time * 6 + (spin || 0)));
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + time * 1.6 + (spin || 0);
      pts.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]);
    }
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(time * 6 + (spin || 0));
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23e';
    ctx.fill();
    ctx.globalAlpha = 1;
    poly(ctx, pts, '#ffd23e');
    poly(ctx, hexPts(sx, sy, r * 0.55), '#fff3b0');
  }

  // 球门：六边形平台某条边（0°=右，60° 递增）上的彩色球门 + 白杆
  function goal(ctx, edge, color, flash, v, time) {
    const R_FLAT = v.grid.SPACING * Math.sqrt(3) * (v.grid.RING_MAX + 0.5);
    const a = (edge * 60) * Math.PI / 180;
    const Rv = R_FLAT / Math.cos(30 * Math.PI / 180);
    // 球门两端（门柱）
    const p1 = toScreen(Math.cos(a - Math.PI / 6) * Rv, Math.sin(a - Math.PI / 6) * Rv, v);
    const p2 = toScreen(Math.cos(a + Math.PI / 6) * Rv, Math.sin(a + Math.PI / 6) * Rv, v);
    const flashA = flash > 0 ? Math.min(1, flash * 3) : 0;
    // 门柱
    ctx.globalAlpha = 0.95;
    for (const p of [p1, p2]) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], (2.4 + flashA * 2) * (v.zoom / 9), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    // 球门线：一排彩色光点 + 进球闪光
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = p1[0] + (p2[0] - p1[0]) * t;
      const y = p1[1] + (p2[1] - p1[1]) * t;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4 + edge + i * 0.5);
      const rr = (2 + pulse * 1.2 + flashA * 3) * (v.zoom / 9);
      ctx.globalAlpha = 0.55 + flashA * 0.45 + pulse * 0.2;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = flashA > 0.3 ? '#ffffff' : color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 足球：白色球 + 黑色斑点 + 阴影（touchFlash 时闪白）
  function ball(ctx, b, v, time) {
    const [sx, sy] = toScreen(b.x, b.z, v);
    const r = (b.r || 4.0) * v.zoom * (1 + 0.05 * Math.sin(time * 8));
    // 阴影（随球半径变大）
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(sx + 2, sy + 3, r * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    // 球体
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    // 黑色斑点（足球花纹）
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 5; i++) {
      const aa = (i / 5) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.arc(sx + Math.cos(aa) * r * 0.5, sy + Math.sin(aa) * r * 0.5, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // 被踢到的闪光
    if (b.touchFlash > 0) {
      ctx.globalAlpha = Math.min(1, b.touchFlash * 5);
      ctx.beginPath();
      ctx.arc(sx, sy, r * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe9a8';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 机关：加速带(蓝箭头) / 弹射板(黄蹦床) / 传送门(紫漩涡)
  function gadget(ctx, g, v, time) {
    const [sx, sy] = toScreen(g.x, g.z, v);
    const s = v.zoom;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5 + (g.tileIdx || 0));
    const ellipse = (x, y, rx, ry, rot, c) => {
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
      else ctx.arc(x, y, (rx + ry) / 2, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    };
    if (g.type === 'boost') {
      const a = g.dir;
      // 蓝色椭圆板
      ctx.globalAlpha = 0.9;
      ellipse(sx, sy, 2.1 * s, 1.15 * s, a, '#3d9bff');
      ctx.globalAlpha = 0.55 + pulse * 0.35;
      ellipse(sx, sy, 1.5 * s, 0.72 * s, a, '#b7e3ff');
      // 白色方向箭头（朝 dir）
      const ax = Math.cos(a), az = Math.sin(a);
      const [tx, ty] = toScreen(g.x + ax * 0.6, g.z + az * 0.6, v);
      const [hx2, hy2] = toScreen(g.x + ax * 1.1, g.z + az * 1.1, v);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(hx2, hy2);
      ctx.lineTo(tx - (hx2 - sx) * 0.18, ty - (hy2 - sy) * 0.18);
      ctx.lineTo(tx - (hx2 - sx) * 0.18 + (hy2 - sy) * 0.1, ty - (hy2 - sy) * 0.18 - (hx2 - sx) * 0.1);
      ctx.closePath();
      ctx.fill();
      if (ctx.stroke) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2 * (s / 9);
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      }
    } else if (g.type === 'jump') {
      // 黄色蹦床
      ctx.globalAlpha = 0.9;
      ellipse(sx, sy, 1.9 * s, 1.3 * s, 0, '#ffb13d');
      ctx.globalAlpha = 0.75;
      ellipse(sx, sy, 1.2 * s, 0.75 * s, 0, '#ffd98a');
      // 向上箭头
      if (ctx.stroke) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.4 * (s / 9);
        ctx.beginPath();
        ctx.moveTo(sx, sy + 0.7 * s); ctx.lineTo(sx, sy - 0.55 * s); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 0.45 * s, sy - 0.2 * s); ctx.lineTo(sx, sy - 0.7 * s); ctx.lineTo(sx + 0.45 * s, sy - 0.2 * s);
        ctx.stroke();
      }
    } else if (g.type === 'mine') {
      // 地雷：红色尖刺球（引爆后熄灭 6 秒）
      ctx.globalAlpha = g.armed ? 0.95 : 0.25;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.15 * s, 0, Math.PI * 2);
      ctx.fillStyle = g.armed ? '#ff3d2e' : '#7a3a35';
      ctx.fill();
      ctx.globalAlpha = g.armed ? 0.9 : 0.2;
      if (ctx.stroke) {
        ctx.strokeStyle = '#ffd23e';
        ctx.lineWidth = 1.1 * (s / 9);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + time * 2;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * 1.1 * s, sy + Math.sin(a) * 1.1 * s);
          ctx.lineTo(sx + Math.cos(a) * 1.7 * s, sy + Math.sin(a) * 1.7 * s);
          ctx.stroke();
        }
      }
    } else if (g.type === 'gate') {
      // 加速门：两根光柱 + 中间箭头
      const gx = Math.cos(g.dir), gz = Math.sin(g.dir);
      const px = -gz, pz = gx;
      for (const side of [-1, 1]) {
        const [px1, py1] = toScreen(g.x + px * side * 2.4, g.z + pz * side * 2.4, v);
        const [px2, py2] = toScreen(g.x + px * side * 2.4 + gx * 1.6, g.z + pz * side * 2.4 + gz * 1.6, v);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(px1, py1, 0.55 * s, 0, Math.PI * 2);
        ctx.fillStyle = '#3df0ff';
        ctx.fill();
        if (ctx.stroke) {
          ctx.strokeStyle = '#3df0ff';
          ctx.lineWidth = 2.6 * (s / 9);
          ctx.beginPath();
          ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
        }
      }
      // 中间箭头
      if (ctx.stroke) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.4 * (s / 9);
        ctx.beginPath();
        ctx.moveTo(sx - gx * 1.2 * s, sy - gz * 1.2 * s); ctx.lineTo(sx + gx * 1.2 * s, sy + gz * 1.2 * s); ctx.stroke();
        const [ax, ay] = toScreen(g.x + gx * 1.6, g.z + gz * 1.6, v);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - gx * 0.5 * s + px * 0.3 * s, ay - gz * 0.5 * s + pz * 0.3 * s);
        ctx.lineTo(ax - gx * 0.5 * s - px * 0.3 * s, ay - gz * 0.5 * s - pz * 0.3 * s);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    } else if (g.type === 'spring') {
      // 弹簧台：黄色弹簧 + 向上弹射箭头
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb13d';
      ctx.fill();
      ctx.globalAlpha = 0.75;
      if (ctx.stroke) {
        ctx.strokeStyle = '#fff3d6';
        ctx.lineWidth = 2.2 * (s / 9);
        for (let k = 0; k < 3; k++) {
          const r0 = 0.45 + k * 0.3, r1 = r0 + 0.42;
          ctx.beginPath();
          ctx.arc(sx, sy, (r0 + (pulse * 0.25)) * s, 0.4, Math.PI * 1.6);
          ctx.stroke();
        }
      }
      if (ctx.stroke) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.6 * (s / 9);
        ctx.beginPath();
        ctx.moveTo(sx, sy + 1.0 * s); ctx.lineTo(sx, sy - 1.0 * s); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 0.55 * s, sy - 0.45 * s); ctx.lineTo(sx, sy - 1.1 * s); ctx.lineTo(sx + 0.55 * s, sy - 0.45 * s);
        ctx.stroke();
      }
    } else if (g.type === 'portal') {
      // 紫色传送门（漩涡感）
      ctx.globalAlpha = 0.55 + pulse * 0.3;
      if (ctx.stroke) {
        for (let k = 2; k >= 0; k--) {
          ctx.beginPath();
          ctx.arc(sx, sy, (1.5 + k * 0.7) * s, time * 2 + k, time * 2 + k + Math.PI * 1.2);
          ctx.lineWidth = 1.6 * s;
          ctx.strokeStyle = k === 2 ? '#a05bff' : (k === 1 ? '#c98bff' : '#e6c4ff');
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.0 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#8a4dff';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 检查点（竞速赛）：金色光环，下一个高亮脉冲
  function checkpoint(ctx, cp, isNext, v, time) {
    const [sx, sy] = toScreen(cp.x, cp.z, v);
    const s = v.zoom;
    const pulse = 0.5 + 0.5 * Math.sin(time * (isNext ? 8 : 3));
    const r = (isNext ? 2.6 : 2.1) * s;
    ctx.globalAlpha = (isNext ? 0.55 + pulse * 0.4 : 0.35 + pulse * 0.2);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23e';
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = isNext ? '#fff8dc' : '#e8b93d';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  return { toScreen, platformBase, tile, car, ringEdge, particles, coin, item, goal, ball, gadget, checkpoint, background };
})();

if (typeof module !== 'undefined') module.exports = Draw;

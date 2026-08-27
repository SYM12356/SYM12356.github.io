/* =====================================================================
 * 《剑影江湖》电子版 —— 人机对战 AI
 * 启发式评估：伤害/速度/距离/状态/防御/血量压力综合打分。
 * 提供：出招选牌、DLC2 公共牌选牌、DLC4 援护选牌、决策自动应答。
 * ===================================================================== */
(function (global) {
  'use strict';

  // 各侠客理想距离（0贴身 1近 2中 3远 4极远）
  var PREF = { liu: 1, tie: 0, li: 1, tang: 3, zhang: 2 };

  function heroPref(heroId) {
    return PREF[heroId] !== undefined ? PREF[heroId] : 1;
  }

  // 出招评估
  function scoreCard(g, p, foe, c) {
    var score = 0;
    var inRange = c.lo <= g.dist && g.dist <= c.hi;
    if (!inRange) {
      score -= 7;                       // 大概率落空
      if (c.ultimate) score -= 2;       // 绝学落空更亏（直接移出）
    } else {
      score += c.dmg * 2.2;
      if (c.dmg > 0 && p.effSpeed(c) <= 5) score -= 1.4;   // 可能平速/后手
    }
    // 状态价值
    if (c.appliesPoison) score += 1.7;
    if (c.appliesPoise) score += 1.3;
    if (c.appliesInner) score += 2.0;
    if (c.healAmt) score += c.healAmt * 1.9;
    if (c.ultimate) score += c.dmg * 0.9;
    // 速度价值
    score += (p.effSpeed(c) - 4.5) * 0.9;
    // 距离偏好：向侠客理想距离靠拢
    var pref = heroPref(p.heroId);
    var distScore = pref === 0 ? (4 - g.dist) : pref === 4 ? g.dist : -Math.abs(g.dist - pref);
    score += distScore * 0.75;
    // 防御价值：护盾/减伤牌在对手即将出重手时价值高
    if (c.dmg === 0 && (c.name === '金钟罩' || c.name === '如封似闭' || c.name === '盘根诀' ||
                        c.name === '铁索横江' || c.name === '金蝉脱壳' || c.name === '云台三落')) {
      score += 1.8;
      if (foe.curCard && foe.curCard.dmg >= 3) score += 1.5;
    }
    // 血量压力
    if (p.hp <= 8 && c.healAmt) score += 5;
    if (p.hp <= 8 && c.name === '金蝉脱壳') score += 3;
    if (foe.hp <= 8 && c.dmg >= 3) score += 4;
    if (foe.hp <= 5 && c.dmg >= 5) score += 5;
    // 耗气效率
    score -= c.cost * 0.4;
    return score;
  }

  // 出招选牌（level: easy / normal / hard）
  function choose(g, p, level) {
    level = level || 'normal';
    if (p.forcedCard && p.hand.some(function (c) { return c.uid === p.forcedCard.uid; })) return p.forcedCard;
    var foe = g.foe(p);
    var cand = p.hand.filter(function (c) { return g.effectiveCost(p, c) <= p.qi; });
    if (!cand.length) {
      return p.hand.reduce(function (a, b) { return g.effectiveCost(p, a) <= g.effectiveCost(p, b) ? a : b; });
    }
    // ---- 简单：一半概率随意出招（仍避开落空），一半弱化评估 + 随机扰动 ----
    if (level === 'easy') {
      if (Math.random() < 0.5) {
        var usable = cand.filter(function (c) { return c.lo <= g.dist && g.dist <= c.hi; });
        var pool = usable.length ? usable : cand;
        return pool[Math.floor(Math.random() * pool.length)];
      }
      var b1 = null, sc1 = -Infinity;
      cand.forEach(function (c) {
        var sc = scoreCard(g, p, foe, c) * 0.6 + (Math.random() * 4 - 2);
        if (sc > sc1) { sc1 = sc; b1 = c; }
      });
      return b1;
    }
    // ---- 普通 / 困难：启发式打分 ----
    var best = null, bestScore = -Infinity;
    cand.forEach(function (c) {
      var s = scoreCard(g, p, foe, c);
      if (level === 'hard') s -= threatAfter(g, p, foe, c);   // 困难：考虑对手最佳应对
      if (s > bestScore) { bestScore = s; best = c; }
    });
    // 绝学时机：困难更激进，普通更保守
    if (!p.ultUsed && g.effectiveCost(p, p.ult) <= p.qi) {
      var us = scoreCard(g, p, foe, p.ult);
      var desperate = level === 'hard' ? (foe.hp <= 12 || p.hp <= 12) : (foe.hp <= 10 || p.hp <= 10);
      var threshold = level === 'hard' ? 1.15 : 1.3;
      if (desperate ? (us > bestScore) : (us > bestScore * threshold)) {
        bestScore = us; best = p.ult;
      }
    }
    return best;
  }

  // 困难模式：粗略估计打出 c 后对手最佳应对的威胁值
  function threatAfter(g, p, foe, c) {
    var foeCand = foe.hand.filter(function (f) { return g.effectiveCost(foe, f) <= foe.qi; });
    var best = 0;
    foeCand.forEach(function (f) {
      var s = scoreCard(g, foe, p, f);
      if (s > best) best = s;
    });
    return best * 0.55;
  }

  // DLC2 公共牌选牌
  function pickPublic(g, faceup) {
    var p = g.draftTurn === 0 ? g.p1 : g.p2;
    var foe = g.foe(p);
    var best = null, bestScore = -Infinity;
    faceup.forEach(function (c) {
      var s = scoreCard(g, p, foe, c);
      if (c.healAmt) s += 1;
      if (s > bestScore) { bestScore = s; best = c; }
    });
    return best || faceup[0];
  }

  // DLC4 援护选牌（简单偏好：医女/武僧/老僧生存向优先）
  function pickYuanhu(list) {
    var rank = { shenmi: 9, doctor: 8, wuseng: 7, mobei: 6, gaibang: 6, duyi: 5, xingxiu: 5, anxiang: 4, zhujian: 4, shuoshu: 4, miaoshou: 3, chuanfu: 2 };
    var best = list[0], bestRank = -1;
    list.forEach(function (y) {
      var r = rank[y.id] !== undefined ? rank[y.id] : 0;
      if (r > bestRank) { bestRank = r; best = y; }
    });
    return best;
  }

  // 决策自动应答（AI 作为决策方时）
  function decide(prompt) {
    switch (prompt.type) {
      case 'regen':
        // 医女/毒医/铸剑师：气血亏则医女，有负面则毒医，其他用铸剑师
        if (prompt.player.hp < prompt.player.maxhp - 4) return 'use';
        return 'use';
      case 'preplay':
        // 丐帮长老/船夫：一律发动（收益为正）
        return 'use';
      case 'shuoshu-dist':
        return String(Math.max(0, Math.min(4, heroPref(prompt.player.heroId))));
      case 'force-card': {
        // 选择对手手牌中耗气最高的一张（与 Python 引擎一致）
        var foe = prompt.foe || (prompt.player ? prompt.player.game.foe(prompt.player) : null);
        var opts = prompt.options || [];
        var best = opts[0], bestCost = -1;
        opts.forEach(function (o) {
          var card = foe ? foe.hand.find(function (c) { return c.name === o.label; }) : null;
          var cost = card ? card.cost : 0;
          if (cost > bestCost) { bestCost = cost; best = o; }
        });
        return best ? best.id : (opts[0] ? opts[0].id : 'skip');
      }
      case 'miaoshou-discard': {
        // 回气堆中选最贵的一张回手
        var opts2 = prompt.options || [];
        var b2 = opts2[0], bc = -1;
        opts2.forEach(function (o) {
          var m = /耗(\d+)/.exec(o.desc || '');
          var cost = m ? parseInt(m[1], 10) : 0;
          if (cost > bc) { bc = cost; b2 = o; }
        });
        return b2 ? b2.id : (opts2[0] ? opts2[0].id : 'skip');
      }
      default:
        return 'skip';
    }
  }

  var AI = {
    choose: choose,
    pickPublic: pickPublic,
    pickYuanhu: pickYuanhu,
    decide: decide
  };
  global.JY_AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);

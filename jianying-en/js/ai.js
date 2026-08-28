/* =====================================================================
 * Jianying Jianghu Digital Edition - AI opponent
 * Heuristic evaluation: combined scoring of damage / speed / distance /
 * status / defense / blood pressure.
 * Provides: technique pick, DLC2 public-card pick, DLC4 aid pick, and
 * automatic decision responses.
 * ===================================================================== */
(function (global) {
  'use strict';

  // Ideal distance per hero (0 clinch 1 near 2 mid 3 far 4 extreme)
  var PREF = { liu: 1, tie: 0, li: 1, tang: 3, zhang: 2 };

  function heroPref(heroId) {
    return PREF[heroId] !== undefined ? PREF[heroId] : 1;
  }

  // Technique evaluation
  function scoreCard(g, p, foe, c) {
    var score = 0;
    var inRange = c.lo <= g.dist && g.dist <= c.hi;
    if (!inRange) {
      score -= 7;                       // likely to miss
      if (c.ultimate) score -= 2;       // an ultimate that misses hurts more (removed outright)
    } else {
      score += c.dmg * 2.2;
      if (c.dmg > 0 && p.effSpeed(c) <= 5) score -= 1.4;   // may tie / act second
    }
    // Status value
    if (c.appliesPoison) score += 1.7;
    if (c.appliesPoise) score += 1.3;
    if (c.appliesInner) score += 2.0;
    if (c.healAmt) score += c.healAmt * 1.9;
    if (c.ultimate) score += c.dmg * 0.9;
    // Speed value
    score += (p.effSpeed(c) - 4.5) * 0.9;
    // Distance preference: move toward the hero's ideal distance
    var pref = heroPref(p.heroId);
    var distScore = pref === 0 ? (4 - g.dist) : pref === 4 ? g.dist : -Math.abs(g.dist - pref);
    score += distScore * 0.75;
    // Defensive value: shield/reduction cards gain value when the foe is about to strike hard
    // NOTE: the card-name literals below must match the card definitions in data.js (still in Chinese)
    if (c.dmg === 0 && (c.name === 'Golden Bell Shield' || c.name === 'Seal and Close' || c.name === 'Rooted Coil Art' ||
                        c.name === 'Iron Chain Across the River' || c.name === 'Golden Cicada Escape' || c.name === 'Cloud Terrace Falls')) {
      score += 1.8;
      if (foe.curCard && foe.curCard.dmg >= 3) score += 1.5;
    }
    // Blood pressure
    if (p.hp <= 8 && c.healAmt) score += 5;
    if (p.hp <= 8 && c.name === 'Golden Cicada Escape') score += 3;
    if (foe.hp <= 8 && c.dmg >= 3) score += 4;
    if (foe.hp <= 5 && c.dmg >= 5) score += 5;
    // Qi efficiency
    score -= c.cost * 0.4;
    return score;
  }

  // Technique pick (level: easy / normal / hard)
  function choose(g, p, level) {
    level = level || 'normal';
    if (p.forcedCard && p.hand.some(function (c) { return c.uid === p.forcedCard.uid; })) return p.forcedCard;
    var foe = g.foe(p);
    var cand = p.hand.filter(function (c) { return g.effectiveCost(p, c) <= p.qi; });
    if (!cand.length) {
      return p.hand.reduce(function (a, b) { return g.effectiveCost(p, a) <= g.effectiveCost(p, b) ? a : b; });
    }
    // ---- Easy: half the time pick at random (still avoiding misses), half a weakened evaluation + random jitter ----
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
    // ---- Normal / Hard: heuristic scoring ----
    var best = null, bestScore = -Infinity;
    cand.forEach(function (c) {
      var s = scoreCard(g, p, foe, c);
      if (level === 'hard') s -= threatAfter(g, p, foe, c);   // Hard: consider the foe's best response
      if (s > bestScore) { bestScore = s; best = c; }
    });
    // Ultimate timing: Hard is more aggressive, Normal more conservative
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

  // Hard mode: roughly estimate the threat of the foe's best response after playing c
  function threatAfter(g, p, foe, c) {
    var foeCand = foe.hand.filter(function (f) { return g.effectiveCost(foe, f) <= foe.qi; });
    var best = 0;
    foeCand.forEach(function (f) {
      var s = scoreCard(g, foe, p, f);
      if (s > best) best = s;
    });
    return best * 0.55;
  }

  // DLC2 public-card pick
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

  // DLC4 aid pick (simple preference: survival-oriented healer / monks first)
  function pickYuanhu(list) {
    var rank = { shenmi: 9, doctor: 8, wuseng: 7, mobei: 6, gaibang: 6, duyi: 5, xingxiu: 5, anxiang: 4, zhujian: 4, shuoshu: 4, miaoshou: 3, chuanfu: 2 };
    var best = list[0], bestRank = -1;
    list.forEach(function (y) {
      var r = rank[y.id] !== undefined ? rank[y.id] : 0;
      if (r > bestRank) { bestRank = r; best = y; }
    });
    return best;
  }

  // Automatic decision responses (when the AI is the deciding party)
  function decide(prompt) {
    switch (prompt.type) {
      case 'regen':
        // healer / poison-doctor / swordsmith: use the healer when blood is low,
        // the poison-doctor when debuffed, otherwise the swordsmith
        if (prompt.player.hp < prompt.player.maxhp - 4) return 'use';
        return 'use';
      case 'preplay':
        // Beggar elder / ferryman: always activate (positive value)
        return 'use';
      case 'shuoshu-dist':
        return String(Math.max(0, Math.min(4, heroPref(prompt.player.heroId))));
      case 'force-card': {
        // Pick the card with the highest qi cost in the foe's hand (matches the Python engine)
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
        // Return the most expensive card in the qi-return pile to hand
        var opts2 = prompt.options || [];
        var b2 = opts2[0], bc = -1;
        opts2.forEach(function (o) {
          var m = /Qi\s+(\d+)/.exec(o.desc || '');   // "Qi N" cost format produced by cardBrief in data.js
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

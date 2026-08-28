/* =====================================================================
 * Sword Shadows Jianghu - Digital Edition: Data and Rule Definitions
 * Based on: Sword Shadows Jianghu - Balanced Revision.docx (the balanced
 *           patch values are the defaults; enabling DLC2/DLC4
 *           auto-applies the balanced2 tweaks)
 * Rules semantics ported from Sword Shadows Jianghu - Balance Analysis.py
 *           (a rule engine verified by 2M+ Monte Carlo games)
 * ===================================================================== */
(function (global) {
  'use strict';

  // ---------------- Constants ----------------
  var MAX_HP = 30;        // Starting HP
  var MAX_QI = 5;         // Qi cap
  var START_DIST = 2;     // Starting distance (mid)
  var DISCARD_LIMIT = 4;  // Discard-pile threshold (5 under DLC2)
  var TURN_LIMIT = 60;    // Turn limit per game (anti-stall; draw at limit)

  // ---------------- Effect Functions ----------------
  // Common signature: (g, p, foe, ctx), ctx = { isFirst, tie, dmgBonus, ignoreShield }
  // post-type additionally receives dealt (the actual damage dealt by this move)
  // reveal-type takes effect right after reveal, before the clash ("this turn" defensive effects)

  /* ---------- Liu Rufeng ---------- */
  function eJifengci(g, p, foe, ctx) { if (ctx.isFirst) ctx.dmgBonus += (p.curCard.jifengciBonus || 0); }
  function eHuifeng(g, p, foe, ctx) { g.changeDist(p, ctx.isFirst ? 1 : 2); }
  function eJinghong(g, p, foe, ctx) { g.changeDist(p, ctx.isFirst ? Math.max(g.dist - 2, 1) : Math.min(4, g.dist + 1)); }
  function eRaozhirou(g, p, foe, ctx, dealt) { if (dealt > 0) foe.poise += 1; }
  function eJianqi(g, p, foe, ctx) { if (ctx.isFirst) g.addInner(foe, 1); else p.qi = Math.min(g.maxQi, p.qi + 1); }
  function eTaxue(g, p, foe, ctx) { g.changeDist(p, 3); p.poise = Math.max(0, p.poise - 1); }
  function eSanhuan(g, p, foe, ctx) { if (p.discard.length === 2) ctx.dmgBonus += (p.curCard.sanhuanBonus || 1); }
  function eYuntai(g, p, foe, ctx) { /* Shield takes effect on reveal */ }

  /* ---------- Tie Wushuang ---------- */
  function eHeiho(g, p, foe, ctx) { if (ctx.isFirst) foe.poise += 1; }
  function eTieshan(g, p, foe, ctx) { g.changeDist(p, 0); }
  function eSuishi(g, p, foe, ctx) { if (ctx.isFirst) g.changeDist(p, Math.max(0, g.dist - 1)); else ctx.dmgBonus += 1; }
  function eChanshen(g, p, foe, ctx) {
    if (p.discard.length === 1 || p.discard.length === 2) {
      ctx.dmgBonus += (p.curCard.chanshenDmg || 2);
      foe.poise += (p.curCard.chanshenPoise || 1);
    }
  }
  function eJinzhong(g, p, foe, ctx) { p.poise = 0; }
  function eBengquan(g, p, foe, ctx) { g.changeDist(p, Math.max(0, g.dist - 1)); if (ctx.isFirst) ctx.ignoreShield = true; }
  function ePaishan(g, p, foe, ctx) { p.poise += 1; }
  function eHuifengzhang(g, p, foe, ctx) { g.changeDist(p, ctx.isFirst ? 2 : 3); }

  /* ---------- Li Zhanfeng ---------- */
  function eJihuodao(g, p, foe, ctx) { if (ctx.isFirst) { g.changeDist(p, Math.max(0, g.dist - 1)); ctx.dmgBonus += 1; } }
  function eHuxiao(g, p, foe, ctx) { if (!ctx.isFirst) g.deferredHuxiao.push(p); }
  function eDaowang(g, p, foe, ctx) {
    if (ctx.isFirst) foe.poise += 1;
    else { g.changeDist(p, Math.min(4, g.dist + 1)); p.qi = Math.min(g.maxQi, p.qi + 1); }
  }
  function eNixue(g, p, foe, ctx) {
    p.hp -= (p.curCard.selfHp || 2);                                   // Self-damage (can be lethal; still resolves)
    ctx.dmgBonus += (p.curCard.nixueBonus !== undefined ? p.curCard.nixueBonus : 1);
  }
  function eTiesuo(g, p, foe, ctx) { p.poise += 1; }
  function eBawang(g, p, foe, ctx) {
    g.changeDist(p, 0);
    p.poise += (p.curCard.poiseChange || 1);
    if (foe.inner > 0) ctx.dmgBonus += 1;
  }
  function eXuanfeng(g, p, foe, ctx) { if (ctx.isFirst) g.addInner(foe, 1); else p.qi = Math.max(0, p.qi - 1); }
  function eYixiao(g, p, foe, ctx) { g.changeDist(p, Math.max(0, g.dist - (p.curCard.dash || 2))); if (g.dist === 0) ctx.dmgBonus += 2; }

  /* ---------- Tang Shiqi ---------- */
  function eFeihuang(g, p, foe, ctx) { if (ctx.isFirst) foe.poison += 1; }
  function eXiuli(g, p, foe, ctx) { if (!ctx.isFirst) g.changeDist(p, Math.min(4, g.dist + 1)); }
  function eDujili(g, p, foe, ctx) { foe.poison += 2; if (!ctx.isFirst) p.qi = Math.max(0, p.qi - 1); }
  function eMantian(g, p, foe, ctx) { foe.poison += 2; foe.poise += 1; }
  function eYandan(g, p, foe, ctx) { g.changeDist(p, 4); p.poise = Math.max(0, p.poise - 1); }
  function eTouguding(g, p, foe, ctx) { ctx.ignoreShield = true; if (ctx.isFirst && foe.poison >= 2) ctx.dmgBonus += 1; }
  function eHansha(g, p, foe, ctx) { if (!ctx.isFirst && foe.curCard && foe.curCard.speed >= 7) ctx.dmgBonus += 2; }
  function eJinchan(g, p, foe, ctx) { g.changeDist(p, 3); p.poise += 1; }

  /* ---------- Zhang Xuanqing ---------- */
  function eYunshou(g, p, foe, ctx) { /* Second-player defensive effect applies on reveal */ }
  function eLanque(g, p, foe, ctx) { if (ctx.isFirst) g.changeDist(p, 1); else { g.changeDist(p, 2); foe.poise += 1; } }
  function eRufeng(g, p, foe, ctx) { /* Shield takes effect on reveal */ }
  function eBanlan(g, p, foe, ctx) { if (!ctx.isFirst) { ctx.dmgBonus += 2; g.changeDist(p, 0); } }
  function eYema(g, p, foe, ctx) { if (ctx.isFirst) foe.poise += 1; else p.qi = Math.min(g.maxQi, p.qi + 2); }
  function eYunv(g, p, foe, ctx) { g.changeDist(p, Math.min(4, Math.max(0, g.dist + (p.curCard.distDelta || -2)))); p.poise = Math.max(0, p.poise - 1); }
  function eGaotama(g, p, foe, ctx) { if (ctx.isFirst) g.changeDist(p, Math.max(0, g.dist - 1)); else g.addInner(foe, 1); }
  function eShizishou(g, p, foe, ctx) { if (!ctx.isFirst) { p.pendingTaiji = true; ctx.dmgBonus += 1; } }

  /* ---------- Ultimate Moves ---------- */
  function eTianwai(g, p, foe, ctx) { /* Pure damage */ }
  function eBanruo(g, p, foe, ctx) { g.addInner(foe, 2); }
  function eJiuzhuan(g, p, foe, ctx) { g.addInner(foe, 2); p.poise += 2; }
  function eBaoyu(g, p, foe, ctx) { foe.poison += 3; foe.pendingSlowVal = Math.max(foe.pendingSlowVal, 3); }
  function eTaiji(g, p, foe, ctx) { p.qi = Math.min(g.maxQi, p.qi + 3); }

  /* ---------- DLC2 Public Cards ---------- */
  function eBabu(g, p, foe, ctx) { g.changeDist(p, g.dist === 0 ? 4 : 0); }
  function eYiwei(g, p, foe, ctx) { g.changeDist(p, Math.min(4, g.dist + 2)); p.poise = Math.max(0, p.poise - 1); }
  function eShenxing(g, p, foe, ctx) { if (ctx.isFirst) g.changeDist(p, Math.max(0, g.dist - 1)); else g.changeDist(p, Math.min(4, g.dist + 1)); p.qisurge = true; }
  function ePoyu(g, p, foe, ctx) { if (ctx.isFirst) g.addInner(foe, 1); else ctx.dmgBonus += 1; }
  function eWuchang(g, p, foe, ctx) { if (foe.hp < 15) ctx.dmgBonus += 2; }
  function eFenjin(g, p, foe, ctx) { foe.poise += 2; if (!ctx.isFirst) p.qi = Math.min(g.maxQi, p.qi + 1); }
  function eChuanxin(g, p, foe, ctx) { ctx.ignoreShield = true; if (ctx.isFirst) g.changeDist(p, Math.max(0, g.dist - 1)); }
  function eMuchun(g, p, foe, ctx) { if (!ctx.isFirst) { p.hp = Math.min(p.maxhp, p.hp + 4); } else { p.hp = Math.min(p.maxhp, p.hp + 3); p.poise += 1; } }
  function eWuluo(g, p, foe, ctx) { foe.poison += 2; if (!ctx.isFirst) foe.poison += 1; }
  function eChilian(g, p, foe, ctx) { foe.poison += 1; foe.poise += 1; }
  function eWuxiang(g, p, foe, ctx) { if (ctx.isFirst) foe.pendingSlowVal = Math.max(foe.pendingSlowVal, 2); else p.qi = Math.min(g.maxQi, p.qi + 1); }
  // Soul-Seizing Art: look at the foe's hand and choose 1 card they must play next turn (async: needs player decision)
  async function eShehun(g, p, foe, ctx) {
    if (foe.hand.length > 0) {
      var choice = await g.decide({
        type: 'force-card', player: p, foe: foe,
        title: 'Soul-Seizing Art',
        text: p.heroName + ' uses Soul-Seizing Art: choose one card that ' + foe.heroName + ' must play next turn.',
        options: foe.hand.map(function (c) {
          return { id: String(c.uid), label: c.name, desc: cardBrief(c) + ' | ' + (c.desc || '') };
        })
      });
      var card = foe.hand.find(function (c) { return String(c.uid) === choice; });
      if (card) foe.forcedCard = card;
    }
    p.qisurge = true;
  }

  /* ---------- "This Turn" Defensive Effects That Apply on Reveal ---------- */
  function rJinzhong(g, p, foe, ctx) { p.shields.push({ amt: 2 }); }
  function rTiesuo(g, p, foe, ctx) { p.shields.push({ amt: 2 }); }
  function rJinchan(g, p, foe, ctx) { p.shields.push({ amt: 3 }); }
  function rRufeng(g, p, foe, ctx) { p.shields.push({ amt: 2, rebound: 2 }); }
  function rTaiji(g, p, foe, ctx) { p.immuneRound = true; }
  function rYunshou(g, p, foe, ctx) { if (!ctx.isFirst) { p.persistReduce += 1; p.qi = Math.min(g.maxQi, p.qi + 1); } }
  function rXiuli(g, p, foe, ctx) { if (!ctx.isFirst) p.shields.push({ amt: 1 }); }
  function rYuntai(g, p, foe, ctx) { if (!ctx.isFirst) p.shields.push({ amt: 2, onlyFirst: true }); }
  function rPangen(g, p, foe, ctx) { p.persistReduce += 2; p.qisurge = true; }
  function rQiyi(g, p, foe, ctx) { p.shields.push({ amt: 999, qiAbsorb: true }); if (ctx.isFirst) g.deferredQiyi.push(p); }
  function rDouzhuan(g, p, foe, ctx) { p.immuneRound = true; }

  // ---------------- Card Summary (for UI / decision display) ----------------
  function rangeText(lo, hi) {
    if (lo === 0 && hi === 4) return 'Any';
    var names = ['Engaged', 'Close', 'Mid', 'Far', 'Extreme'];
    return names[lo] + (hi > lo ? '-' + names[hi] : '');
  }
  function cardBrief(c) {
    var s = 'Spd ' + c.speed + ' / Qi ' + c.cost + ' / ' + rangeText(c.lo, c.hi) + ' / Dmg ' + c.dmg;
    if (c.ultimate) s = '[Ult] ' + s;
    return s;
  }

  // ---------------- Characters (default = balanced values) ----------------
  var CHARACTERS = {
    liu: {
      id: 'liu', name: 'Liu Rufeng', title: 'Swordsman', weapon: 'Sword',
      style: 'Swordplay of airy lightness: quick strikes and mobility, with potent combo damage, but a frail frame that fears brute force.',
      cards: [
        { id: 'jifengci', name: 'Gale Stab', speed: 8, cost: 1, lo: 0, hi: 1, dmg: 2, pre: eJifengci, jifengciBonus: 0,
          desc: 'No additional effect.' },
        { id: 'huifeng', name: 'Willow Sway', speed: 6, cost: 0, lo: 1, hi: 2, dmg: 1, pre: eHuifeng,
          desc: 'First: set distance to 1. Second: set distance to 2.' },
        { id: 'jinghong', name: 'Startled Swan', speed: 9, cost: 2, lo: 2, hi: 3, dmg: 3, pre: eJinghong,
          desc: 'First: lunge, distance -2 (min 1). Second: retreat, distance +1.' },
        { id: 'raozhirou', name: 'Silken Coil', speed: 4, cost: 1, lo: 0, hi: 1, dmg: 1, post: eRaozhirou, appliesPoise: true,
          desc: 'After dealing damage, give the foe 1 Opening.' },
        { id: 'jianqi', name: 'Sword Qi Surge', speed: 5, cost: 2, lo: 2, hi: 3, dmg: 2, pre: eJianqi, appliesInner: true,
          desc: 'First: inflict 1 Internal Injury. Second: restore 1 Qi to yourself.' },
        { id: 'taxue', name: 'Treading Snow', speed: 7, cost: 0, lo: 0, hi: 4, dmg: 0, pre: eTaxue,
          desc: 'Set distance to 3 (Far). Remove 1 Opening from yourself.' },
        { id: 'sanhuan', name: 'Three Rings Catch the Moon', speed: 6, cost: 2, lo: 0, hi: 1, dmg: 2, pre: eSanhuan, sanhuanBonus: 1,
          desc: 'Combo: if your discard pile holds exactly 2 cards when played, this move deals +1 damage.' },
        { id: 'yuntai', name: 'Cloud Terrace Falls', speed: 3, cost: 2, lo: 0, hi: 1, dmg: 3, reveal: rYuntai,
          desc: 'Second: damage you take from the first strike this turn is reduced by 2 (defensive counter).' }
      ],
      ult: { id: 'tianwai', name: 'Flying Immortal', speed: 10, cost: 4, lo: 0, hi: 4, dmg: 6, ultimate: true, pre: eTianwai,
        desc: 'A sword from the west, unbreakable. Removed from the game after use.' }
    },
    tie: {
      id: 'tie', name: 'Tie Wushuang', title: 'Boxer', weapon: 'Fist',
      style: 'Fierce fists and palms with high damage, specializing in Openings and Internal Injuries; defensive moves defuse crises, but his speed lags and he is easily kited.',
      cards: [
        { id: 'heiho', name: 'Black Tiger Steals Heart', speed: 5, cost: 1, lo: 0, hi: 1, dmg: 3, pre: eHeiho, appliesPoise: true,
          desc: 'First: the foe gains 1 Opening.' },
        { id: 'tieshan', name: 'Iron Mountain Slam', speed: 4, cost: 2, lo: 0, hi: 4, dmg: 4, pre: eTieshan,
          desc: 'Ignores current distance; after use, distance becomes 0 (engaged clash).' },
        { id: 'suishi', name: 'Stone-Shattering Palm', speed: 3, cost: 0, lo: 1, hi: 2, dmg: 2, pre: eSuishi,
          desc: 'First: distance -1. Second: this move deals +1 damage.' },
        { id: 'chanshen', name: 'Eighteen Entangling Strikes', speed: 6, cost: 1, lo: 0, hi: 1, dmg: 1, pre: eChanshen,
          chanshenDmg: 2, chanshenPoise: 1, appliesPoise: true,
          desc: 'Combo: if your discard pile has 1 or 2 cards when played, deal 2 extra damage and inflict 1 Opening.' },
        { id: 'jinzhong', name: 'Golden Bell Shield', speed: 2, cost: 2, lo: 0, hi: 4, dmg: 0, pre: eJinzhong, reveal: rJinzhong,
          desc: 'The next damage you take this turn is reduced by 2, and you remove all your Openings. Unmovable as a mountain.' },
        { id: 'bengquan', name: 'Crushing Fist', speed: 7, cost: 2, lo: 1, hi: 2, dmg: 3, pre: eBengquan,
          desc: 'Lunge, distance -1. First: this damage ignores damage reduction.' },
        { id: 'paishan', name: 'Topple Mountains, Overturn Seas', speed: 1, cost: 3, lo: 0, hi: 1, dmg: 6, pre: ePaishan,
          desc: 'After use, you gain 1 Opening (too much force; the move is spent).' },
        { id: 'huifengzhang', name: 'Returning Wind Palm', speed: 5, cost: 0, lo: 1, hi: 2, dmg: 2, pre: eHuifengzhang,
          desc: 'Set distance to 2. If acting second, set it to 3 instead (borrowing force to break away).' }
      ],
      ult: { id: 'banruo', name: 'Prajna Vajra Palm', speed: 10, cost: 5, lo: 0, hi: 1, dmg: 8, ultimate: true, pre: eBanruo,
        jianzhongCost: -1, appliesInner: true,
        desc: 'Inflict 2 Internal Injuries on the foe. Removed from the game after use. Unmatched ferocity — meridians shatter on impact.' }
    },
    li: {
      id: 'li', name: 'Li Zhanfeng', title: 'Blade Fiend', weapon: 'Blade',
      style: 'Mid-range burst: blood-rage traded for damage and brutal armor-breaking. His forms sweep wide and bold, never sparing his own HP.',
      cards: [
        { id: 'jihuodao', name: 'Swift Fire Blade', speed: 7, cost: 2, lo: 1, hi: 2, dmg: 2, pre: eJihuodao,
          desc: 'First: distance -1, and this damage +1.' },
        { id: 'huxiao', name: 'Tiger Roar Slash', speed: 5, cost: 2, lo: 0, hi: 1, dmg: 4, pre: eHuxiao, appliesInner: true,
          desc: 'Second: if you took damage this turn, inflict 1 extra Internal Injury.' },
        { id: 'daowang', name: 'Entangling Blade Net', speed: 6, cost: 1, lo: 1, hi: 2, dmg: 2, pre: eDaowang, appliesPoise: true,
          desc: 'First: the foe gains 1 Opening. Second: distance +1 and restore 1 Qi.' },
        { id: 'nixue', name: 'Reverse Blood Blade', speed: 3, cost: 0, lo: 0, hi: 1, dmg: 2, pre: eNixue, selfHp: 2, nixueBonus: 1,
          desc: 'Your HP -2; this move deals +1 damage. If your HP drops to 0 from this, the move still resolves normally.' },
        { id: 'tiesuo', name: 'Iron Chain Across the River', speed: 2, cost: 2, lo: 1, hi: 2, dmg: 0, pre: eTiesuo, reveal: rTiesuo,
          desc: 'The next damage you take this turn is reduced by 2. You gain 1 Opening.' },
        { id: 'bawang', name: 'Overlord Sheds Armor', speed: 8, cost: 0, lo: 0, hi: 4, dmg: 1, pre: eBawang, poiseChange: 1,
          desc: 'Set distance to 0. Gain 1 Opening yourself. If the foe has Internal Injuries, damage +1.' },
        { id: 'xuanfeng', name: 'Whirlwind Leaf Sweep', speed: 4, cost: 2, lo: 0, hi: 2, dmg: 3, pre: eXuanfeng, appliesInner: true,
          desc: 'First: inflict 1 Internal Injury. Second: your Qi -1 (no effect if insufficient).' },
        { id: 'yixiao', name: 'Thousand-Mountain Roar', speed: 9, cost: 2, lo: 3, hi: 4, dmg: 2, pre: eYixiao, dash: 2,
          desc: 'Lunge, distance -2. If distance is 0 after resolving, damage +2.' }
      ],
      ult: { id: 'jiuzhuan', name: 'Nine-Turn Heaven Blade', speed: 10, cost: 5, lo: 0, hi: 1, dmg: 8, ultimate: true, pre: eJiuzhuan,
        appliesInner: true,
        desc: 'Inflict 2 Internal Injuries on the foe. Gain 2 Openings yourself. Removed from the game after use. One turn of the Heaven Blade — gods and ghosts alike perish.' }
    },
    tang: {
      id: 'tang', name: 'Tang Shiqi', title: 'Thousand Hands', weapon: 'Hidden',
      style: 'Long-range kiting that stacks poison to grind foes down, with high evasion. Torments enemies with poison darts and flying stones like a rain of flowers.',
      cards: [
        { id: 'feihuang', name: 'Locust Stone', speed: 8, cost: 1, lo: 3, hi: 4, dmg: 1, appliesPoison: true, pre: eFeihuang,
          desc: 'First: inflict 1 Poison.' },
        { id: 'xiuli', name: 'Sleeve Arrow', speed: 6, cost: 0, lo: 2, hi: 3, dmg: 2, pre: eXiuli, reveal: rXiuli,
          desc: 'Second: dodge, distance +1, and the next damage you take this turn is reduced by 1.' },
        { id: 'dujili', name: 'Poison Caltrop', speed: 5, cost: 2, lo: 1, hi: 2, dmg: 1, appliesPoison: true, pre: eDujili,
          desc: 'Inflict 2 Poison. Second: your Qi -1.' },
        { id: 'mantian', name: 'Rain of Flowers', speed: 4, cost: 3, lo: 2, hi: 4, dmg: 1, appliesPoison: true, appliesPoise: true, pre: eMantian,
          desc: 'The foe gains 2 Poison and 1 Opening.' },
        { id: 'yandan', name: 'Smoke Bomb', speed: 7, cost: 1, lo: 0, hi: 4, dmg: 0, pre: eYandan,
          desc: 'Set distance to 4. Remove 1 Opening from yourself.' },
        { id: 'touguding', name: 'Bone-Piercing Nail', speed: 9, cost: 2, lo: 0, hi: 1, dmg: 2, pre: eTouguding,
          desc: 'This damage ignores damage reduction. If you act first and the foe has 2+ Poison, damage +1.' },
        { id: 'hansha', name: 'Shadow-Spitting Sand', speed: 3, cost: 1, lo: 2, hi: 3, dmg: 3, pre: eHansha,
          desc: 'Second: if the foe\'s move this turn has Speed 7+, this move deals +2 damage.' },
        { id: 'jinchan', name: 'Golden Cicada Escape', speed: 1, cost: 2, lo: 0, hi: 4, dmg: 0, pre: eJinchan, reveal: rJinchan,
          desc: 'The next damage you take this turn is reduced by 3. Then set distance to 3 and gain 1 Opening yourself.' }
      ],
      ult: { id: 'baoyu', name: 'Pear-Blossom Needle Storm', speed: 10, cost: 4, lo: 0, hi: 4, dmg: 4, appliesPoison: true, ultimate: true, pre: eBaoyu,
        desc: 'Inflict 3 Poison. Until the end of next turn, the foe\'s move Speed -3. Removed from the game after use. Fired, it draws blood; returning empty bodes ill.' }
    },
    zhang: {
      id: 'zhang', name: 'Zhang Xuanqing', title: 'Taiji', weapon: 'Fist',
      style: 'Counters when acting second, cycles Qi, and borrows the foe\'s force. Softness dissolves power; the enemy\'s strength is turned against them.',
      cards: [
        { id: 'yunshou', name: 'Cloud Hands', speed: 4, cost: 0, lo: 0, hi: 1, dmg: 3, reveal: rYunshou,
          desc: 'Second: all damage you take this turn is reduced by 1, and restore 1 Qi.' },
        { id: 'lanque', name: 'Grasp the Sparrow\'s Tail', speed: 3, cost: 2, lo: 1, hi: 2, dmg: 2, pre: eLanque, appliesPoise: true,
          desc: 'First: set distance to 1. Second: set distance to 2, and the foe gains 1 Opening.' },
        { id: 'rufeng', name: 'Seal and Close', speed: 2, cost: 1, lo: 0, hi: 4, dmg: 0, reveal: rRufeng,
          desc: 'The next damage you take this turn is reduced by 2. If this reduction drops that damage to 0, deal 2 damage to the attacker.' },
        { id: 'banlan', name: 'Brush, Parry, Punch', speed: 6, cost: 2, lo: 0, hi: 1, dmg: 4, pre: eBanlan,
          desc: 'Second: this move deals +2 damage and sets distance to 0.' },
        { id: 'yema', name: 'Part the Wild Horse\'s Mane', speed: 5, cost: 1, lo: 1, hi: 2, dmg: 2, pre: eYema, appliesPoise: true,
          desc: 'First: the foe gains 1 Opening. Second: restore 2 Qi to yourself.' },
        { id: 'yunv', name: 'Jade Maiden\'s Shuttle', speed: 8, cost: 0, lo: 2, hi: 4, dmg: 1, pre: eYunv, distDelta: -2,
          desc: 'Distance -2; remove 1 Opening from yourself.' },
        { id: 'gaotama', name: 'High Pat on Horse', speed: 7, cost: 1, lo: 0, hi: 1, dmg: 3, pre: eGaotama, appliesInner: true,
          desc: 'First: lunge, distance -1. Second: inflict 1 Internal Injury.' },
        { id: 'shizishou', name: 'Cross Hands', speed: 1, cost: 1, lo: 0, hi: 1, dmg: 1, pre: eShizishou,
          desc: 'Second: you gain Taiji Stance (move Speed +2 next turn), and this move deals +1 damage.' }
      ],
      ult: { id: 'taiji', name: 'Taiji Two-Polar Palm', speed: 10, cost: 5, lo: 0, hi: 4, dmg: 0, ultimate: true, pre: eTaiji, reveal: rTaiji,
        desc: 'Take no damage this turn. Reflect the original damage of the first strike you would have suffered this turn back at the foe. Restore 3 Qi to yourself. Removed from the game after use. Taiji turns full circle — what comes, goes.' }
    }
  };

  // ---------------- DLC2 Public Cards (15) ----------------
  var PUBLIC_CARDS = [
    { id: 'babu', name: 'Eight-Step Cicada', speed: 9, cost: 1, lo: 0, hi: 4, dmg: 0, pre: eBabu,
      desc: 'Set distance to 0. If it is already 0, set it to 4 instead. A spirit\'s trail, ever shifting; a single reed crosses the river.' },
    { id: 'yiwei', name: 'One Reed Across the River', speed: 7, cost: 0, lo: 0, hi: 4, dmg: 0, pre: eYiwei,
      desc: 'Distance +2. Remove 1 Opening from yourself. Ride the righteousness of heaven and earth, mastering the six vital breaths.' },
    { id: 'shenxing', name: 'Divine Steps, Hundred Changes', speed: 6, cost: 1, lo: 1, hi: 2, dmg: 1, pre: eShenxing,
      desc: 'First: distance -1. Second: distance +1. Either way, after this move resolves, you gain Qi Surge.' },
    { id: 'poyu', name: 'Jade-Breaking Fist', speed: 5, cost: 2, lo: 0, hi: 1, dmg: 3, pre: ePoyu, appliesInner: true,
      desc: 'First: the foe gains 1 Internal Injury. Second: this move deals +1 damage. Jade shatters on Kunlun; ferocity breaks the enemy.' },
    { id: 'wuchang', name: 'Wuchang Reaps Life', speed: 4, cost: 2, lo: 1, hi: 2, dmg: 2, pre: eWuchang,
      rangeWidenLast: true,
      desc: 'If the foe\'s HP is below 15, this move deals +2 damage. Second: this move\'s range limit widens by 1 (i.e., 0-3 allowed).' },
    { id: 'fenjin', name: 'Tendon-Rending Grasp', speed: 3, cost: 3, lo: 0, hi: 1, dmg: 2, pre: eFenjin, appliesPoise: true,
      desc: 'Inflict 2 Openings. Second: your Qi +1. Dislocate bones and tendons; lock their joints.' },
    { id: 'chuanxin', name: 'Heart-Piercing Finger', speed: 8, cost: 2, lo: 0, hi: 4, dmg: 2, pre: eChuanxin,
      desc: 'This damage ignores damage reduction. First: distance -1. One finger out — even metal and stone are pierced.' },
    { id: 'pangen', name: 'Rooted Coil Art', speed: 1, cost: 3, lo: 0, hi: 4, dmg: 0, reveal: rPangen,
      desc: 'All damage you take this turn is reduced by 2. You gain Qi Surge. Rooted like a gnarled pine — ten thousand weights cannot move you.' },
    { id: 'muchun', name: 'Bathe in the Spring Breeze', speed: 2, cost: 1, lo: 0, hi: 4, dmg: 0, pre: eMuchun, healAmt: 3.5,
      desc: 'Restore 3 HP and gain 1 Opening. Second: restore 4 HP instead and gain no Opening. A withered tree meets spring; moisture falls without sound.' },
    { id: 'qiyi', name: 'Ruyi Qi Armor', speed: 5, cost: 2, lo: 0, hi: 4, dmg: 0, reveal: rQiyi,
      desc: 'The next damage you take this turn is absorbed by Qi: each point of Qi reduces damage by 1 and is consumed. If you act first and took no damage this turn: restore 2 Qi.' },
    { id: 'wuluo', name: 'Five-Silk Mist Palm', speed: 7, cost: 2, lo: 1, hi: 2, dmg: 1, appliesPoison: true, pre: eWuluo,
      desc: 'Inflict 2 Poison. Second: +1 Poison inflicted. Where the light smoke passes, five poisons assail the heart.' },
    { id: 'chilian', name: 'Viper\'s Poison Sand', speed: 6, cost: 1, lo: 0, hi: 2, dmg: 1, appliesPoison: true, appliesPoise: true, pre: eChilian,
      desc: 'Inflict 1 Poison and 1 Opening. A scorpion\'s heart in a beauty\'s breast; poisoned sand veils the Yellow Springs.' },
    { id: 'wuxiang', name: 'Formless Tribulation Finger', speed: 4, cost: 2, lo: 2, hi: 3, dmg: 2, pre: eWuxiang,
      desc: 'First: the foe\'s move Speed -2 next turn. Second: your Qi +1. Formless and traceless — fate cannot be escaped.' },
    { id: 'shehun', name: 'Soul-Seizing Art', speed: 3, cost: 3, lo: 0, hi: 1, dmg: 0, pre: eShehun,
      desc: 'Look at the foe\'s hand and choose 1 card that they must play next turn (if they lack the Qi, it is forced to miss and they gain Openings normally). You gain Qi Surge.' },
    { id: 'douzhuan', name: 'Shifting Stars', speed: 10, cost: 4, lo: 0, hi: 4, dmg: 0, reveal: rDouzhuan, removed: true,
      desc: 'Take no damage this turn. Reflect the original damage of the first strike you would have suffered this turn back at the foe. This card is unaffected by the equal-speed damage -1. Removed from the game after use. Their own art, returned upon their own body.' }
  ];

  // Weapon types (for the Sword Grave Ruins): Liu Rufeng=Sword Tie Wushuang/Zhang Xuanqing=Fist Li Zhanfeng=Blade Tang Shiqi=Hidden
  (function assignWeapons() {
    CHARACTERS.liu.cards.forEach(function (c) { c.weapon = 'Sword'; });
    CHARACTERS.liu.ult.weapon = 'Sword';
    [CHARACTERS.tie, CHARACTERS.zhang].forEach(function (h) {
      h.cards.forEach(function (c) { c.weapon = 'Fist'; });
      h.ult.weapon = 'Fist';
    });
    CHARACTERS.li.cards.forEach(function (c) { c.weapon = 'Blade'; });
    CHARACTERS.li.ult.weapon = 'Blade';
    CHARACTERS.tang.cards.forEach(function (c) { c.weapon = 'Hidden'; });
    CHARACTERS.tang.ult.weapon = 'Hidden';
    PUBLIC_CARDS.forEach(function (c) {
      if (c.name === 'Heart-Piercing Finger' || c.name === 'Eight-Step Cicada') c.weapon = 'Sword';
      else if (c.name === 'Jade-Breaking Fist' || c.name === 'Tendon-Rending Grasp' || c.name === 'Five-Silk Mist Palm') c.weapon = 'Fist';
      else c.weapon = null;
    });
  })();

  // ---------------- DLC3 Scene Cards ----------------
  var SCENES = {
    huashan:   { id: 'huashan',   name: 'Mount Hua Summit', desc: 'A lone peak above a churning sea of clouds. Distance cannot be actively increased: any effect that increases distance is nullified.' },
    zhuhai:    { id: 'zhuhai',    name: 'Bamboo Sea Forest', desc: 'Ten thousand green bamboos blot out the sun. Moves with Speed 6 or higher deal -1 final damage (min 1).' },
    dashamo:   { id: 'dashamo',   name: 'Great Desert Wild Sand', desc: 'Sand blots out the sun; qi leaks away. Both players\' Qi cap temporarily becomes 3; restore 2 Qi in the regen phase.' },
    bingfeng:  { id: 'bingfeng',  name: 'Frost-Sealed Pool', desc: 'The pool\'s surface is a mirror; the chill cuts to the bone. After reveal, the side with higher Speed gains 1 Opening (none if speeds are equal).' },
    duzhang:   { id: 'duzhang',   name: 'Poison Miasma Swamp', desc: 'Black water churns; miasma hangs thick. Poison does not decay naturally; any effect that inflicts Internal Injury instead inflicts an equal amount of Poison.' },
    jianzhong: { id: 'jianzhong', name: 'Sword Grave Ruins', desc: 'Broken swords stand like a forest, sword intent in the air. Sword moves cost -1 Qi (min 0); fist/palm moves deal -1 damage (min 1).' }
  };

  // ---------------- DLC4 Assist Character Cards (12) ----------------
  // when: regen=regen phase preplay=start of play phase reveal=after reveal miss=on miss
  //       firstDmg=before first-strike damage deal=after dealing damage take=when taking damage death=near death
  function yhDoctor(g, p) { if (p.hp >= p.maxhp) p.qi = Math.min(g.maxQi, p.qi + 2); else p.hp = Math.min(p.maxhp, p.hp + 5); }
  function yhGaibang(g, p) { p.yuanhuCostReduce = 2; if (p.hand.length < g.foe(p).hand.length) p.qi = Math.min(g.maxQi, p.qi + 1); }
  function yhXingxiu(g, p, foe) { foe.poison += 2; }
  function yhZhujian(g, p) { p.dmgBonusPerm += 1; p.maxhp -= 3; if (p.hp > p.maxhp) p.hp = p.maxhp; }
  function yhChuanfu(g, p) { g.changeDist(p, 4); p.qi = Math.min(g.maxQi, p.qi + 1); }
  function yhDuyi(g, p) { p.poison = 0; p.inner = 0; }
  function yhShenmi(g, p) { p.hp = 5; p.poise = 0; }

  var YUANHU_CARDS = [
    { id: 'doctor', name: 'Vulture Palace Healer', when: 'regen', effect: yhDoctor,
      desc: 'Restore 5 HP; if HP is already full, restore 2 Qi instead. The living are the ones who deal damage.' },
    { id: 'mobei', name: 'Northern Desert Blade', when: 'firstDmg', effect: null,
      desc: 'When you play a first strike and its damage is about to be calculated: that damage +3. One blade offered — death, not life.' },
    { id: 'miaoshou', name: 'Deft Fingers', when: 'miss', effect: null,
      desc: 'When your move misses: avoid the Opening you would gain; then draw 1 random card from the public deck into your hand (without DLC2, instead return 1 chosen card from your discard pile to your hand). Steal the sky and swap the sun; graft flowers onto foreign branches.' },
    { id: 'gaibang', name: 'Beggar Clan Elder', when: 'preplay', effect: yhGaibang,
      desc: 'Your moves cost -2 Qi this turn (min 0). If you have fewer cards in hand than the foe, restore 1 extra Qi. Beggars may lack for much — never for numbers.' },
    { id: 'anxiang', name: 'Dark-Fragrance Assassin', when: 'deal', effect: null,
      desc: 'When your move deals damage to the foe: inflict 1 extra Poison and 1 Opening. Shadow falls, scent follows; life ends without a trace.' },
    { id: 'wuseng', name: 'Temple-Guard Monk', when: 'take', effect: null,
      desc: 'When you take damage (after damage reduction resolves): that damage -3 (min 0). A vajra\'s glare shields his ground.' },
    { id: 'xingxiu', name: 'Star-Sect Fiend', when: 'reveal', effect: yhXingxiu,
      desc: 'When you play a move card with a poison effect (after reveal): that move inflicts +2 Poison this time. If the poison fails to kill you, this old man has lived in vain.' },
    { id: 'zhujian', name: 'Master Swordsmith', when: 'regen', effect: yhZhujian,
      desc: 'For the rest of the game, all your moves deal +1 damage; but your HP cap is reduced by 3 immediately (if your HP exceeds the new cap, lower it). This effect cannot be dispelled. Forging the blade with his life — unstoppably sharp.' },
    { id: 'shuoshu', name: 'Storyteller', when: 'reveal', effect: null,
      desc: 'Change the current distance to any value (choose 0-4). This change does not affect miss judgment. One crack of the gavel — a foot apart, yet worlds away.' },
    { id: 'chuanfu', name: 'The Boatman', when: 'preplay', effect: yhChuanfu,
      desc: 'Set distance to 4 and restore 1 Qi. Cross every tribulation; meet again on the rivers and lakes.' },
    { id: 'duyi', name: 'Poison Doctor', when: 'regen', effect: yhDuyi,
      desc: 'Remove all Poison and all Internal Injuries from yourself. Every medicine is three parts poison; every poison, seven parts medicine.' },
    { id: 'shenmi', name: 'Mysterious Old Monk', when: 'death', effect: yhShenmi,
      desc: 'When your HP drops to 0 or below and defeat is imminent: restore HP to 5 and remove all your Openings (one free save per game). If I do not enter hell, who will?' }
  ];

  // ---------------- Balance Patch ----------------
  // balanced: base + DLC1/DLC3 config (default values built into the card definitions)
  // balanced2: DLC2/DLC4 config → 7 tweaks layered on balanced (applied per card; shared data untouched)
  function applyBalanced2ToCard(c) {
    switch (c.name) {
      case 'Gale Stab': c.jifengciBonus = 1; break;           // restore first-strike damage +1
      case 'Grasp the Sparrow\'s Tail': c.cost = 1; break;
      case 'Part the Wild Horse\'s Mane': c.cost = 0; break;
      case 'Reverse Blood Blade': c.nixueBonus = 0; break;    // 2 damage for 2 HP
      case 'Overlord Sheds Armor': c.poiseChange = 2; break;  // gain 2 Openings
      case 'Golden Bell Shield': c.cost = 1; break;
    }
  }

  // ---------------- Export ----------------
  var DATA = {
    MAX_HP: MAX_HP, MAX_QI: MAX_QI, START_DIST: START_DIST,
    DISCARD_LIMIT: DISCARD_LIMIT, TURN_LIMIT: TURN_LIMIT,
    CHARACTERS: CHARACTERS, PUBLIC_CARDS: PUBLIC_CARDS, SCENES: SCENES,
    YUANHU_CARDS: YUANHU_CARDS, rangeText: rangeText, cardBrief: cardBrief,
    applyBalanced2ToCard: applyBalanced2ToCard
  };
  global.JY_DATA = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
})(typeof window !== 'undefined' ? window : globalThis);

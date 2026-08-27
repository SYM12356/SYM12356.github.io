/* =====================================================================
 * 《剑影江湖》电子版 —— 规则引擎（纯逻辑，无 DOM）
 * 语义逐条移植自《剑影江湖-平衡性分析.py》的 Game/Player/play_turn
 * ===================================================================== */
(function (global) {
  'use strict';
  var DATA = global.JY_DATA;
  if (!DATA) throw new Error('engine.js 需要先加载 data.js');
  var CHARACTERS = DATA.CHARACTERS, PUBLIC_CARDS = DATA.PUBLIC_CARDS,
      YUANHU_CARDS = DATA.YUANHU_CARDS, SCENES = DATA.SCENES;
  var MAX_HP = DATA.MAX_HP, MAX_QI = DATA.MAX_QI, START_DIST = DATA.START_DIST,
      DISCARD_LIMIT = DATA.DISCARD_LIMIT, TURN_LIMIT = DATA.TURN_LIMIT;

  var uidCounter = 1;

  // ---------------- 卡牌实例 ----------------
  function instantiate(def) {
    return Object.assign({}, def, { uid: uidCounter++ });
  }

  // ---------------- 玩家 ----------------
  function Player(game, heroId, index) {
    var hero = CHARACTERS[heroId];
    this.game = game;
    this.index = index;                       // 0 = P1, 1 = P2
    this.heroId = heroId;
    this.heroName = hero.name;
    this.title = hero.title;
    this.style = hero.style;
    this.hp = MAX_HP;
    this.maxhp = MAX_HP;
    this.qi = MAX_QI;
    this.poise = 0;                           // 破绽
    this.inner = 0;                           // 内伤
    this.poison = 0;                          // 中毒
    this.hand = hero.cards.map(function (c) {
      var inst = instantiate(c);
      if (game.patch === 'balanced2') DATA.applyBalanced2ToCard(inst);
      return inst;
    });
    this.discard = [];
    this.ult = (function () {
      var inst = instantiate(hero.ult);
      if (game.patch === 'balanced2') DATA.applyBalanced2ToCard(inst);
      return inst;
    })();
    this.ultUsed = false;
    this.shields = [];                        // 本回合护盾 {amt, onlyFirst, rebound, qiAbsorb}
    this.persistReduce = 0;                   // 云手/盘根诀：本回合所有伤害-X
    this.immuneRound = false;                 // 太极两仪掌/斗转星移
    this.rebounded = false;
    this.pendingTaiji = false;                // 下回合出招速度+2
    this.pendingSlowVal = 0;                  // 下回合速度-（暴雨梨花针3/无相劫指2）
    this.slowActiveVal = 0;                   // 本回合生效的减速
    this.qisurge = false;                     // 气涌：下次出招耗气-1
    this.forcedCard = null;                   // 摄魂大法
    this.tookDmg = false;
    this.curCard = null;
    this.yuanhu = null;                       // DLC4 援护
    this.yuanhuUsed = false;
    this.yuanhuCostReduce = 0;                // 丐帮长老
    this.dmgBonusPerm = 0;                    // 铸剑师
  }

  Player.prototype.effSpeed = function (card) {
    var s = card.speed - this.poise;
    if (this.pendingTaiji) s += 2;
    s -= this.slowActiveVal;
    return Math.max(0, s);
  };

  Player.prototype.takeDamage = function (g, attacker, base, opts) {
    opts = opts || {};
    var poison = !!opts.poison, tie = !!opts.tie,
        ignoreShield = !!opts.ignoreShield, reflected = !!opts.reflected;
    if (poison) {                             // 中毒：独立伤害（受内伤加成，不可减免）
      var dmgP = Math.max(0, base + this.inner);
      if (dmgP > 0) this.hp -= dmgP;
      return dmgP;
    }
    if (reflected) {                          // 反弹伤害：不可减免
      var dmgR = Math.max(0, base);
      this.hp -= dmgR;
      return dmgR;
    }
    if (this.immuneRound) {                   // 太极两仪掌/斗转星移：免疫 + 反弹第一段先手伤害
      if (attacker && attacker === g.firstAttacker && !this.rebounded) {
        this.rebounded = true;
        attacker.takeDamage(g, this, base, { reflected: true });
        g.log('🌀 ' + this.heroName + ' 免疫伤害，将 ' + base + ' 点伤害（原数值）反弹给 ' + attacker.heroName, 'reflect');
      }
      return 0;
    }
    var dmg = base;
    if (g.scene === 'jianzhong' && attacker && attacker.curCard && attacker.curCard.weapon === '拳' && dmg >= 1) {
      dmg = Math.max(1, dmg - 1);             // 剑冢：拳掌招式伤害-1
    }
    if (tie && dmg >= 1) dmg = Math.max(1, dmg - 1);                       // 平速：招式伤害-1（最低1）
    if (g.scene === 'zhuhai' && attacker && attacker.curCard && attacker.curCard.speed >= 6 && dmg >= 1) {
      dmg = Math.max(1, dmg - 1);             // 竹海：速度6+招式伤害-1（平速之后）
    }
    dmg += this.inner;                        // 内伤：受到的伤害+1
    if (!ignoreShield) dmg = this.absorb(g, attacker, dmg);
    if (g.dlc4 && dmg > 0 && this.yuanhu && !this.yuanhuUsed && this.yuanhu.id === 'wuseng') {
      this.yuanhuUsed = true;                 // 护寺武僧：受伤害-3（减伤结算后）
      var before = dmg;
      dmg = Math.max(0, dmg - 3);
      g.log('🛡 ' + this.heroName + ' 发动援护「护寺武僧」：所受伤害 ' + before + ' → ' + dmg, 'assist');
    }
    dmg = Math.max(0, dmg);
    if (dmg > 0) { this.hp -= dmg; this.tookDmg = true; }
    return dmg;
  };

  Player.prototype.absorb = function (g, attacker, dmg) {
    var remaining = dmg, keep = [];
    for (var i = 0; i < this.shields.length; i++) {
      var s = this.shields[i];
      if (remaining <= 0) { keep.push(s); continue; }
      if (s.qiAbsorb) {                       // 如意气甲：真气抵消
        var absorbQi = Math.min(remaining, this.qi);
        if (absorbQi > 0) {
          this.qi -= absorbQi;
          remaining -= absorbQi;
          g.log('🛡 ' + this.heroName + ' 的如意气甲以 ' + absorbQi + ' 点真气抵消伤害', 'shield');
        }
        continue;                             // 一次性：触发即消耗
      }
      if (s.onlyFirst && attacker !== g.firstAttacker) { keep.push(s); continue; }
      var reduced = Math.min(remaining, s.amt);
      remaining -= reduced;
      s.amt -= reduced;
      if (s.rebound && reduced > 0 && remaining <= 0) {
        attacker.takeDamage(g, this, s.rebound, { reflected: true });   // 如封似闭反弹
        g.log('🌀 如封似闭：伤害被完全化解，反弹 ' + s.rebound + ' 点给 ' + attacker.heroName, 'reflect');
      }
      if (s.amt > 0) keep.push(s);
    }
    this.shields = keep;
    remaining = Math.max(0, remaining - this.persistReduce);
    return remaining;
  };

  // ---------------- 对局 ----------------
  function Game(cfg) {
    cfg = cfg || {};
    this.dlc2 = !!cfg.dlc2;
    this.scene = cfg.scene || null;
    this.dlc4 = !!cfg.dlc4;
    this.patch = cfg.patch || (this.dlc2 || this.dlc4 ? 'balanced2' : 'balanced');
    this.maxQi = this.scene === 'dashamo' ? 3 : MAX_QI;
    this.p1 = new Player(this, cfg.hero1 || 'liu', 0);
    this.p2 = new Player(this, cfg.hero2 || 'tie', 1);
    this.players = [this.p1, this.p2];
    if (this.scene === 'dashamo') { this.p1.qi = this.p2.qi = 3; }
    this.dist = START_DIST;
    this.turn = 0;
    this.activePlayer = 0;                    // 当前回合玩家（交替，用于出招顺序/援护平手次序）
    this.winner = null;
    this.firstAttacker = null;
    this.deferredHuxiao = [];
    this.deferredQiyi = [];
    this.discardLimit = this.dlc2 ? 5 : DISCARD_LIMIT;
    this.logEntries = [];
    this.publicLeftover = [];
    this.decideFn = cfg.decide || null;
    this.draftPool = [];
    this.draftFaceup = [];
    this.draftCount = 0;
    this.draftDone = false;
    this.draftTurn = 0;
    this.yuanhuDraft = [[], []];
    this.yuanhuDraftDone = [false, false];
  }

  Game.prototype.decide = function (prompt) {
    if (!this.decideFn) return Promise.reject(new Error('未提供 decide 处理器'));
    return Promise.resolve(this.decideFn(prompt));
  };

  Game.prototype.log = function (text, cls) {
    this.logEntries.push({ t: text, c: cls || 'info' });
  };

  Game.prototype.instantiate = instantiate;

  Game.prototype.foe = function (p) { return p === this.p1 ? this.p2 : this.p1; };

  Game.prototype.changeDist = function (actor, val, mode) {
    var nxt = mode === 'delta' ? this.dist + val : val;
    if (this.scene === 'huashan' && nxt > this.dist) nxt = this.dist;   // 华山之巅：距离不得后退
    nxt = Math.max(0, Math.min(4, nxt));
    if (nxt !== this.dist) {
      var names = ['贴身', '近身', '中距', '远距', '极远'];
      this.log('➜ ' + actor.heroName + ' 使距离变为 ' + nxt + '（' + names[nxt] + '）', 'move');
    }
    this.dist = nxt;
  };

  Game.prototype.addInner = function (p, n) {
    if (this.scene === 'duzhang') p.poison += n;    // 毒瘴沼泽：内伤效果改为等量中毒
    else p.inner += n;
  };

  // 实际耗气：气涌-1（最低0）
  Game.prototype.playCost = function (p, c) {
    var cost = c.cost;
    if (p.qisurge && cost > 0) cost -= 1;
    return Math.max(0, cost);
  };

  // 出招时按场景/援护修正耗气（在气涌之后）
  Game.prototype.effectiveCost = function (p, c) {
    var cost = this.playCost(p, c);
    if (p.yuanhuCostReduce > 0) cost -= p.yuanhuCostReduce;   // 丐帮长老：本回合耗气-2
    if (this.scene === 'jianzhong') {
      if (c.weapon === '剑' && cost > 0) cost -= 1;           // 剑法耗气-1
      else if (c.jianzhongCost) cost += c.jianzhongCost;      // 般若金刚掌：消耗降为4
    }
    return Math.max(0, cost);
  };

  Game.prototype.removeCard = function (p, card) {
    var i = p.hand.findIndex(function (c) { return c.uid === card.uid; });
    if (i >= 0) p.hand.splice(i, 1);
  };

  Game.prototype.checkWin = function () {
    if (this.winner) return this.winner;
    var self = this;
    this.players.forEach(function (p) {                     // 神秘老僧：濒死免死
      if (p.hp <= 0 && p.yuanhu && !p.yuanhuUsed && p.yuanhu.id === 'shenmi') {
        p.yuanhuUsed = true;
        p.hp = 5;
        p.poise = 0;
        self.log('🙏 ' + p.heroName + ' 发动援护「神秘老僧」：气血恢复至5，破绽尽除！', 'assist');
      }
    });
    if (this.p1.hp <= 0 && this.p2.hp <= 0) this.winner = 'draw';
    else if (this.p1.hp <= 0) this.winner = 'p2';
    else if (this.p2.hp <= 0) this.winner = 'p1';
    return this.winner;
  };

  // ---------------- 援护辅助 ----------------
  Game.prototype.hasYuanhu = function (p, when) {
    return !!(this.dlc4 && p.yuanhu && !p.yuanhuUsed && p.yuanhu.when === when);
  };

  // 调息阶段援护（医女/铸剑师/毒医）：由玩家决定是否发动
  Game.prototype.regenAssistPrompt = function (p) {
    var self = this;
    if (!this.hasYuanhu(p, 'regen')) return Promise.resolve();
    var yh = p.yuanhu;
    if (yh.id === 'duyi' && p.poison <= 0 && p.inner <= 0) return Promise.resolve();
    return this.decide({
      type: 'regen', player: p,
      title: '援护 · ' + yh.name,
      text: p.heroName + ' 的援护「' + yh.name + '」可发动：' + yh.desc,
      options: [
        { id: 'use', label: '发动援护' },
        { id: 'skip', label: '暂不发动' }
      ]
    }).then(function (choice) {
      if (choice === 'use') {
        p.yuanhuUsed = true;
        yh.effect(self, p);
        self.log('🎴 ' + p.heroName + ' 发动援护「' + yh.name + '」', 'assist');
      }
    });
  };

  // 出招阶段开始援护（丐帮长老/船夫）：由玩家决定
  Game.prototype.preplayAssistPrompt = function (p) {
    var self = this;
    if (!this.hasYuanhu(p, 'preplay')) return Promise.resolve();
    var yh = p.yuanhu;
    return this.decide({
      type: 'preplay', player: p,
      title: '援护 · ' + yh.name,
      text: p.heroName + ' 的援护「' + yh.name + '」可发动：' + yh.desc,
      options: [
        { id: 'use', label: '发动援护' },
        { id: 'skip', label: '暂不发动' }
      ]
    }).then(function (choice) {
      if (choice === 'use') {
        p.yuanhuUsed = true;
        yh.effect(self, p);
        self.log('🎴 ' + p.heroName + ' 发动援护「' + yh.name + '」', 'assist');
      }
    });
  };

  // 亮牌后援护（说书人：改距离；星宿老怪：毒+2）
  Game.prototype.revealAssistPrompt = function (p) {
    var self = this;
    if (!this.hasYuanhu(p, 'reveal')) return Promise.resolve();
    var yh = p.yuanhu;
    if (yh.id === 'shuoshu') {
      p.yuanhuUsed = true;
      var distNames = ['0 贴身', '1 近身', '2 中距', '3 远距', '4 极远'];
      return this.decide({
        type: 'shuoshu-dist', player: p,
        title: '援护 · 说书人',
        text: p.heroName + ' 发动援护「说书人」：请选择新的距离（不影响本次落空判定）。',
        options: [0, 1, 2, 3, 4].map(function (d) { return { id: String(d), label: distNames[d] }; })
      }).then(function (choice) {
        var d = parseInt(choice, 10);
        if (!isNaN(d)) self.changeDist(p, Math.max(0, Math.min(4, d)));
        self.log('🎴 ' + p.heroName + ' 发动援护「说书人」', 'assist');
      });
    }
    if (yh.id === 'xingxiu') {
      var c = p.curCard;
      if (c && c.appliesPoison) {
        p.yuanhuUsed = true;
        yh.effect(this, p, this.foe(p));
        this.log('🎴 ' + p.heroName + ' 发动援护「星宿老怪」：中毒 +2', 'assist');
      }
    }
    return Promise.resolve();
  };

  // 落空时援护（妙手空空）：自动发动，免除落空破绽
  Game.prototype.missAssist = function (p) {
    var self = this;
    if (!this.hasYuanhu(p, 'miss')) return Promise.resolve();
    p.yuanhuUsed = true;
    p.poise = Math.max(0, p.poise - 1);                       // 妙手空空：避免落空破绽
    if (this.dlc2 && this.publicLeftover.length) {
      var i = Math.floor(Math.random() * this.publicLeftover.length);
      var card = this.publicLeftover.splice(i, 1)[0];
      var inst = this.instantiate(card);
      inst.isPublic = true;
      p.hand.push(inst);
      this.log('🎴 ' + p.heroName + ' 发动援护「妙手空空」：落空免破绽，并从公共牌库抽得「' + card.name + '」', 'assist');
      return Promise.resolve();
    }
    if (!p.discard.length) {
      this.log('🎴 ' + p.heroName + ' 发动援护「妙手空空」：落空免破绽（回气堆为空，无牌可回）', 'assist');
      return Promise.resolve();
    }
    return this.decide({
      type: 'miaoshou-discard', player: p,
      title: '援护 · 妙手空空',
      text: p.heroName + ' 发动援护「妙手空空」：落空免破绽。请选择回气堆中1张牌返回手牌。',
      options: p.discard.map(function (c) {
        return { id: String(c.uid), label: c.name, desc: DATA.cardBrief(c) + '｜' + (c.desc || '') };
      })
    }).then(function (choice) {
      var card = p.discard.find(function (c) { return String(c.uid) === choice; });
      if (card) {
        p.discard = p.discard.filter(function (c) { return c.uid !== card.uid; });
        p.hand.push(card);
        self.log('🎴 ' + p.heroName + ' 发动援护「妙手空空」：落空免破绽，回手「' + card.name + '」', 'assist');
      }
    });
  };

  // ---------------- 单回合：调息阶段（含 DLC4 调息/出招前援护决策） ----------------
  // 返回 Promise；完成后由调用方收集双方选牌，再调用 resolveCombat
  Game.prototype.beginTurn = function () {
    var self = this;
    var p1 = this.p1, p2 = this.p2;
    this.log('—— 第 ' + (this.turn + 1) + ' 回合 ——', 'phase');

    // ========== 1. 调息阶段 ==========
    var regen = this.scene === 'dashamo' ? 2 : 1;
    this.players.forEach(function (p) {
      p.qi = Math.min(self.maxQi, p.qi + regen);
      p.poise = Math.max(0, p.poise - 1);
      p.slowActiveVal = p.pendingSlowVal;       // 减速在本回合生效
      p.pendingSlowVal = 0;
      self.log('💨 ' + p.heroName + ' 回复' + regen + '真气（' + p.qi + '），破绽 -1（' + p.poise + '）', 'qi');
    });
    var regenOrder = this.activePlayer === 1 ? [p2, p1] : [p1, p2];
    var chain = Promise.resolve();
    if (this.dlc4) {
      regenOrder.forEach(function (p) { chain = chain.then(function () { return self.regenAssistPrompt(p); }); });
    }
    return chain.then(function () {
      // 中毒结算
      self.players.forEach(function (p) {
        if (p.poison > 0) {
          var d = p.takeDamage(self, null, p.poison, { poison: true });
          self.log('☠ ' + p.heroName + ' 中毒发作，受到 ' + d + ' 点伤害（气血 ' + p.hp + '）', 'poison');
        }
      });
      self.players.forEach(function (p) {
        if (self.scene !== 'duzhang') p.poison = Math.max(0, p.poison - 1);   // 毒瘴沼泽：中毒不衰减
        p.shields = [];
        p.persistReduce = 0;
        p.immuneRound = false;
        p.rebounded = false;
        p.tookDmg = false;
      });

      // ========== 2. 出招阶段开始（援护） ==========
      var preOrder = self.activePlayer === 1 ? [p2, p1] : [p1, p2];
      var chain2 = Promise.resolve();
      if (self.dlc4) {
        preOrder.forEach(function (p) { chain2 = chain2.then(function () { return self.preplayAssistPrompt(p); }); });
      }
      return chain2;
    });
  };

  // ---------------- 单回合入口：调息 + 出招结算（测试/一键使用） ----------------
  Game.prototype.playTurn = function (sel1, sel2) {
    var self = this;
    if (!sel1 || !sel2) return Promise.reject(new Error('双方必须各选一张牌'));
    return this.beginTurn().then(function () {
      return self.resolveCombat(sel1, sel2);
    });
  };

  Game.prototype.resolveCombat = function (sel1, sel2) {
    var self = this;
    var p1 = this.p1, p2 = this.p2;
    var c1 = sel1, c2 = sel2;
    p1.curCard = c1; p2.curCard = c2;

    // 出招：支付真气
    var cost1 = this.effectiveCost(p1, c1), cost2 = this.effectiveCost(p2, c2);
    // 真气不足（含摄魂大法强制出牌）→ 该牌落空。正常对局中 UI 不会允许选中不可负担的牌，
    // 此兜底仅覆盖极端情况（如无任何可负担之牌），语义与"强制落空并正常获得破绽"一致。
    var payfail1 = cost1 > p1.qi;
    var payfail2 = cost2 > p2.qi;
    p1.qi = Math.max(0, p1.qi - cost1);
    p2.qi = Math.max(0, p2.qi - cost2);
    p1.yuanhuCostReduce = 0;
    p2.yuanhuCostReduce = 0;
    p1.forcedCard = null;
    p2.forcedCard = null;
    p1.qisurge = false;
    p2.qisurge = false;
    if (!c1.ultimate) this.removeCard(p1, c1); else p1.ultUsed = true;
    if (!c2.ultimate) this.removeCard(p2, c2); else p2.ultUsed = true;

    var costTxt = function (p, c, cost) {
      var s = p.heroName + ' 暗选「' + c.name + '」';
      if (c.ultimate) s += '（绝学）';
      if (cost > 0) s += '，消耗 ' + cost + ' 真气（余 ' + p.qi + '）';
      return s;
    };
    this.log('🃏 ' + costTxt(p1, c1, cost1), 'card');
    this.log('🃏 ' + costTxt(p2, c2, cost2), 'card');

    // ========== 3. 亮牌：速度与先手后手 ==========
    var s1 = p1.effSpeed(c1), s2 = p2.effSpeed(c2);
    this.log('⚡ 速度比较：' + p1.heroName + ' ' + s1 + ' vs ' + p2.heroName + ' ' + s2, 'info');
    if (this.scene === 'bingfeng' && s1 !== s2) {           // 冰封寒潭：速度较高方+1破绽
      if (s1 > s2) p1.poise += 1; else p2.poise += 1;
      this.log('❄ 冰封寒潭：' + (s1 > s2 ? p1.heroName : p2.heroName) + ' 下盘不稳，破绽 +1', 'status');
    }
    var first, last, tie;
    if (s1 > s2) { first = p1; last = p2; tie = false; }
    else if (s2 > s1) { first = p2; last = p1; tie = false; }
    else { first = null; last = null; tie = true; }

    function effRange(c, isFirst) {
      if (!isFirst && c.rangeWidenLast) return [0, 3];      // 无常索命：后手放宽至0-3
      return [c.lo, c.hi];
    }

    var m1, m2;
    if (tie) {
      var r1 = effRange(c1, false), r2 = effRange(c2, false);
      m1 = payfail1 || !(r1[0] <= self.dist && self.dist <= r1[1]);
      m2 = payfail2 || !(r2[0] <= self.dist && self.dist <= r2[1]);
      self.firstAttacker = null;
      self.log('🤝 双方速度相同（' + s1 + '），均视为后手，且各自招式伤害-1（最低1）', 'tie');
    } else {
      var fc = first.curCard;
      var rf = effRange(fc, true), rl = effRange(last.curCard, false);
      var mf = (first === p1 ? payfail1 : payfail2) || !(rf[0] <= self.dist && self.dist <= rf[1]);
      var ml = (last === p2 ? payfail2 : payfail1) || !(rl[0] <= self.dist && self.dist <= rl[1]);
      m1 = first === p1 ? mf : ml;
      m2 = last === p2 ? ml : mf;
      if (m1 && !m2) self.firstAttacker = p2;
      else if (m2 && !m1) self.firstAttacker = p1;
      else self.firstAttacker = (m1 || m2) ? null : first;
    }
    p1.pendingTaiji = false;                                  // 太极势：亮牌比较速度后即消失
    p2.pendingTaiji = false;

    if (m1) { p1.poise += 1; self.log('💢 ' + p1.heroName + ' 的「' + c1.name + '」落空（距离不符/真气不足），破绽 +1', 'miss'); }
    if (m2) { p2.poise += 1; self.log('💢 ' + p2.heroName + ' 的「' + c2.name + '」落空（距离不符/真气不足），破绽 +1', 'miss'); }
    if (m1 && m2) this.log('—— 双方皆落空，本回合无对决 ——', 'info');
    else if (m1 && !m2) this.log('—— ' + p2.heroName + ' 视作自动先手 ——', 'info');
    else if (!m1 && m2) this.log('—— ' + p1.heroName + ' 视作自动先手 ——', 'info');

    // DLC4：落空援护（妙手空空）+ 亮牌后援护（说书人/星宿老怪）
    var chain = Promise.resolve();
    if (this.dlc4) {
      if (m1) chain = chain.then(function () { return self.missAssist(p1); });
      if (m2) chain = chain.then(function () { return self.missAssist(p2); });
      var revealOrder = self.activePlayer === 1 ? [p2, p1] : [p1, p2];
      revealOrder.forEach(function (p) { chain = chain.then(function () { return self.revealAssistPrompt(p); }); });
    }

    return chain.then(function () {
      // ========== 4. 对决阶段 ==========
      var resolves = [];
      if (m1 && m2) { /* 无对决 */ }
      else if (m1) resolves.push([p2, p1, true, false]);
      else if (m2) resolves.push([p1, p2, true, false]);
      else if (tie) resolves.push([p1, p2, false, true], [p2, p1, false, true]);
      else resolves.push([first, last, true, false], [last, first, false, false]);

      // 亮牌即生效的"本回合"防御效果（先后手已定，落空不生效）
      [[p1, c1, m1], [p2, c2, m2]].forEach(function (item) {
        var p = item[0], c = item[1], m = item[2];
        if (m || !c.reveal) return;
        c.reveal(self, p, self.foe(p), { isFirst: p === self.firstAttacker });
        self.log('🛡 ' + p.heroName + ' 亮出「' + c.name + '」，防御效果生效', 'shield');
      });

      var runResolve = function (i) {
        if (i >= resolves.length) return Promise.resolve();
        var r = resolves[i];
        return self._resolve(r[0], r[1], r[2], r[3]).then(function () {
          if (self.winner && !r[3]) return Promise.resolve();
          return runResolve(i + 1);
        });
      };
      return runResolve(0).then(function () {
        // 回合末：虎啸斩受击判定 / 如意气甲未受伤回气
        if (self.deferredHuxiao.length) {
          self.deferredHuxiao.forEach(function (p) {
            if (p.tookDmg) {
              self.addInner(self.foe(p), 1);
              self.log('🐯 ' + p.heroName + ' 本回合受过伤害，虎啸斩后手生效：' + self.foe(p).heroName + ' 内伤 +1', 'status');
            }
          });
          self.deferredHuxiao = [];
        }
        if (self.deferredQiyi.length) {
          self.deferredQiyi.forEach(function (p) {
            if (!p.tookDmg) {
              p.qi = Math.min(self.maxQi, p.qi + 2);
              self.log('🧘 ' + p.heroName + ' 本回合未受伤，如意气甲回复 2 真气', 'qi');
            }
          });
          self.deferredQiyi = [];
        }

        // 平速：双方完整结算后重新判定（同归于尽 → 平局）
        if (self.winner && (self.winner === 'p1' || self.winner === 'p2') && resolves.length && resolves[0][3]) {
          if (p1.hp <= 0 && p2.hp <= 0) self.winner = 'draw';
          else if (p1.hp <= 0) self.winner = 'p2';
          else if (p2.hp <= 0) self.winner = 'p1';
        }

        // ========== 5. 回气阶段 ==========
        [[p1, c1], [p2, c2]].forEach(function (item) {
          var p = item[0], c = item[1];
          if (c.ultimate || c.removed) {
            if (c.ultimate) self.log('💫 「' + c.name + '」绝学移出游戏', 'info');
            else self.log('💫 「' + c.name + '」移出游戏', 'info');
            return;
          }
          p.discard.push(c);
          self.log('🔄 ' + p.heroName + ' 的「' + c.name + '」进入回气堆（' + p.discard.length + '/' + self.discardLimit + '）', 'info');
          if (p.discard.length >= self.discardLimit) {
            p.hand = p.hand.concat(p.discard);
            p.discard = [];
            self.log('🌀 ' + p.heroName + ' 调息完毕，回气堆全部牌返回手牌', 'info');
          }
        });

        self.turn += 1;
        self.activePlayer = 1 - self.activePlayer;
        self.checkWin();
        if (!self.winner && self.turn >= TURN_LIMIT) self.winner = 'limit';
        return self.winner;
      });
    });
  };

  // 结算一方招式（按 先手→后手 顺序）
  Game.prototype._resolve = function (p, foe, isFirst, tie) {
    var self = this;
    var card = p.curCard;
    var role = tie ? '平速' : (isFirst ? '先手' : '后手');
    var effTxt = card.ultimate ? '【绝学】' : '';
    this.log('⚔ ' + p.heroName + '（' + role + '）打出 ' + effTxt + '「' + card.name + '」', isFirst ? 'first' : 'second');

    // 快照双方状态用于日志差分
    var snap = function (pl) {
      return { hp: pl.hp, qi: pl.qi, poise: pl.poise, inner: pl.inner, poison: pl.poison };
    };
    var beforeP = snap(p), beforeF = snap(foe), beforeDist = this.dist;

    var ctx = { isFirst: isFirst, tie: tie, dmgBonus: 0, ignoreShield: false };
    var run = Promise.resolve();
    if (card.pre) run = run.then(function () { return card.pre(self, p, foe, ctx); });
    return run.then(function () {
      var dmg = card.dmg + ctx.dmgBonus + p.dmgBonusPerm;      // 铸剑师：永久伤害+1
      if (self.dlc4 && isFirst && dmg >= 1 && p.yuanhu && !p.yuanhuUsed && p.yuanhu.id === 'mobei') {
        p.yuanhuUsed = true;
        dmg += 3;
        self.log('🗡 ' + p.heroName + ' 发动援护「漠北刀客」：先手伤害 +3', 'assist');
      }
      var dealt = 0;
      if (dmg > 0) {
        dealt = foe.takeDamage(self, p, dmg, { tie: tie, ignoreShield: ctx.ignoreShield });
        if (dealt > 0) {
          self.log('💥 ' + p.heroName + ' 的「' + card.name + '」对 ' + foe.heroName + ' 造成 ' + dealt + ' 点伤害（气血 ' + foe.hp + '）', 'dmg');
        } else {
          self.log('🛡 ' + foe.heroName + ' 化解了全部伤害', 'shield');
        }
        if (self.dlc4 && dealt > 0 && p.yuanhu && !p.yuanhuUsed && p.yuanhu.id === 'anxiang') {
          p.yuanhuUsed = true;
          foe.poison += 1;
          foe.poise += 1;
          self.log('🗡 ' + p.heroName + ' 发动援护「暗香刺客」：' + foe.heroName + ' 中毒+1、破绽+1', 'assist');
        }
      }
      var postRun = Promise.resolve();
      if (card.post) postRun = postRun.then(function () { return card.post(self, p, foe, ctx, dealt); });
      return postRun.then(function () {
        // 日志差分：气血/真气/状态变化
        self.logDelta(p, beforeP, '自身');
        self.logDelta(foe, beforeF, '对手');
        self.checkWin();
      });
    });
  };

  Game.prototype.logDelta = function (pl, before, tag) {
    var parts = [];
    if (pl.hp !== before.hp) parts.push('气血 ' + before.hp + '→' + pl.hp);
    if (pl.qi !== before.qi) parts.push('真气 ' + before.qi + '→' + pl.qi);
    if (pl.poise !== before.poise) parts.push('破绽 ' + before.poise);
    if (pl.inner !== before.inner) parts.push('内伤 ' + before.inner);
    if (pl.poison !== before.poison) parts.push('中毒 ' + before.poison);
    if (parts.length) this.log('📋 ' + pl.heroName + '（' + tag + '）：' + parts.join('，'), 'status');
  };

  // ---------------- DLC2 选牌流程 ----------------
  Game.prototype.startPublicDraft = function () {
    this.draftPool = PUBLIC_CARDS.slice().sort(function () { return Math.random() - 0.5; });
    this.draftFaceup = [];
    for (var i = 0; i < 3 && this.draftPool.length; i++) this.draftFaceup.push(this.draftPool.pop());
    this.draftCount = 0;
    this.draftDone = false;
    this.draftTurn = 0;                                       // P1 先手挑选权（第1、3手）
  };

  Game.prototype.publicDraftPick = function (pIdx, card) {
    var idx = this.draftFaceup.indexOf(card);
    if (idx < 0) return null;
    this.draftFaceup.splice(idx, 1);
    var inst = this.instantiate(card);
    inst.isPublic = true;
    (pIdx === 0 ? this.p1 : this.p2).hand.push(inst);
    this.draftCount++;
    this.log('🃏 ' + (pIdx === 0 ? this.p1.heroName : this.p2.heroName) + ' 选取公共招式「' + card.name + '」', 'card');
    if (this.draftCount >= 4) {
      this.publicLeftover = this.draftFaceup.concat(this.draftPool);
      this.draftFaceup = [];
      this.draftPool = [];
      this.draftDone = true;
    } else {
      if (this.draftPool.length) this.draftFaceup.push(this.draftPool.pop());
      this.draftTurn = 1 - this.draftTurn;
    }
    return inst;
  };

  // ---------------- DLC4 援护选牌 ----------------
  Game.prototype.startYuanhuDraft = function () {
    var pool = YUANHU_CARDS.slice().sort(function () { return Math.random() - 0.5; });
    for (var i = 0; i < 2; i++) {
      this.yuanhuDraft[i] = [pool.pop(), pool.pop(), pool.pop()];
    }
    this.yuanhuDraftDone = [false, false];
  };

  Game.prototype.yuanhuDraftPick = function (pIdx, def) {
    var p = pIdx === 0 ? this.p1 : this.p2;
    p.yuanhu = Object.assign({}, def);
    this.yuanhuDraftDone[pIdx] = true;
    return true;
  };

  // ---------------- 导出 ----------------
  var JY = {
    Game: Game,
    Player: Player,
    instantiate: instantiate,
    CHARACTERS: CHARACTERS,
    PUBLIC_CARDS: PUBLIC_CARDS,
    YUANHU_CARDS: YUANHU_CARDS,
    SCENES: SCENES,
    TURN_LIMIT: TURN_LIMIT
  };
  global.JY = JY;
  if (typeof module !== 'undefined' && module.exports) module.exports = JY;
})(typeof window !== 'undefined' ? window : globalThis);

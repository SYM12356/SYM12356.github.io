/* =====================================================================
 * 《剑影江湖》电子版 —— 数据与规则定义
 * 依据：《剑影江湖-平衡修订版.docx》（balanced 补丁为默认数值；
 *        启用 DLC2/DLC4 时自动套用 balanced2 特调）
 * 规则语义移植自《剑影江湖-平衡性分析.py》（200万+局蒙特卡洛验证的规则引擎）
 * ===================================================================== */
(function (global) {
  'use strict';

  // ---------------- 常量 ----------------
  var MAX_HP = 30;        // 起始气血
  var MAX_QI = 5;         // 真气上限
  var START_DIST = 2;     // 起始距离（中距）
  var DISCARD_LIMIT = 4;  // 回气堆门槛（DLC2 下为 5）
  var TURN_LIMIT = 60;    // 单局回合上限（防龟缩，达上限判平）

  // ---------------- 效果函数 ----------------
  // 通用签名：(g, p, foe, ctx)，ctx = { isFirst, tie, dmgBonus, ignoreShield }
  // post 类额外接收 dealt（本招实际造成伤害）
  // reveal 类在亮牌后、对决前立即生效（"本回合"防御效果）

  /* ---------- 柳如风 ---------- */
  function eJifengci(g, p, foe, ctx) { if (ctx.isFirst) ctx.dmgBonus += (p.curCard.jifengciBonus || 0); }
  function eHuifeng(g, p, foe, ctx) { g.changeDist(p, ctx.isFirst ? 1 : 2); }
  function eJinghong(g, p, foe, ctx) { g.changeDist(p, ctx.isFirst ? Math.max(g.dist - 2, 1) : Math.min(4, g.dist + 1)); }
  function eRaozhirou(g, p, foe, ctx, dealt) { if (dealt > 0) foe.poise += 1; }
  function eJianqi(g, p, foe, ctx) { if (ctx.isFirst) g.addInner(foe, 1); else p.qi = Math.min(g.maxQi, p.qi + 1); }
  function eTaxue(g, p, foe, ctx) { g.changeDist(p, 3); p.poise = Math.max(0, p.poise - 1); }
  function eSanhuan(g, p, foe, ctx) { if (p.discard.length === 2) ctx.dmgBonus += (p.curCard.sanhuanBonus || 1); }
  function eYuntai(g, p, foe, ctx) { /* 护盾在亮牌时(reveal)生效 */ }

  /* ---------- 铁无双 ---------- */
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

  /* ---------- 厉斩风 ---------- */
  function eJihuodao(g, p, foe, ctx) { if (ctx.isFirst) { g.changeDist(p, Math.max(0, g.dist - 1)); ctx.dmgBonus += 1; } }
  function eHuxiao(g, p, foe, ctx) { if (!ctx.isFirst) g.deferredHuxiao.push(p); }
  function eDaowang(g, p, foe, ctx) {
    if (ctx.isFirst) foe.poise += 1;
    else { g.changeDist(p, Math.min(4, g.dist + 1)); p.qi = Math.min(g.maxQi, p.qi + 1); }
  }
  function eNixue(g, p, foe, ctx) {
    p.hp -= (p.curCard.selfHp || 2);                                   // 自伤（可致死，仍结算）
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

  /* ---------- 唐十七 ---------- */
  function eFeihuang(g, p, foe, ctx) { if (ctx.isFirst) foe.poison += 1; }
  function eXiuli(g, p, foe, ctx) { if (!ctx.isFirst) g.changeDist(p, Math.min(4, g.dist + 1)); }
  function eDujili(g, p, foe, ctx) { foe.poison += 2; if (!ctx.isFirst) p.qi = Math.max(0, p.qi - 1); }
  function eMantian(g, p, foe, ctx) { foe.poison += 2; foe.poise += 1; }
  function eYandan(g, p, foe, ctx) { g.changeDist(p, 4); p.poise = Math.max(0, p.poise - 1); }
  function eTouguding(g, p, foe, ctx) { ctx.ignoreShield = true; if (ctx.isFirst && foe.poison >= 2) ctx.dmgBonus += 1; }
  function eHansha(g, p, foe, ctx) { if (!ctx.isFirst && foe.curCard && foe.curCard.speed >= 7) ctx.dmgBonus += 2; }
  function eJinchan(g, p, foe, ctx) { g.changeDist(p, 3); p.poise += 1; }

  /* ---------- 张玄清 ---------- */
  function eYunshou(g, p, foe, ctx) { /* 后手防御效果在亮牌时生效 */ }
  function eLanque(g, p, foe, ctx) { if (ctx.isFirst) g.changeDist(p, 1); else { g.changeDist(p, 2); foe.poise += 1; } }
  function eRufeng(g, p, foe, ctx) { /* 护盾在亮牌时(reveal)生效 */ }
  function eBanlan(g, p, foe, ctx) { if (!ctx.isFirst) { ctx.dmgBonus += 2; g.changeDist(p, 0); } }
  function eYema(g, p, foe, ctx) { if (ctx.isFirst) foe.poise += 1; else p.qi = Math.min(g.maxQi, p.qi + 2); }
  function eYunv(g, p, foe, ctx) { g.changeDist(p, Math.min(4, Math.max(0, g.dist + (p.curCard.distDelta || -2)))); p.poise = Math.max(0, p.poise - 1); }
  function eGaotama(g, p, foe, ctx) { if (ctx.isFirst) g.changeDist(p, Math.max(0, g.dist - 1)); else g.addInner(foe, 1); }
  function eShizishou(g, p, foe, ctx) { if (!ctx.isFirst) { p.pendingTaiji = true; ctx.dmgBonus += 1; } }

  /* ---------- 绝学 ---------- */
  function eTianwai(g, p, foe, ctx) { /* 纯伤害 */ }
  function eBanruo(g, p, foe, ctx) { g.addInner(foe, 2); }
  function eJiuzhuan(g, p, foe, ctx) { g.addInner(foe, 2); p.poise += 2; }
  function eBaoyu(g, p, foe, ctx) { foe.poison += 3; foe.pendingSlowVal = Math.max(foe.pendingSlowVal, 3); }
  function eTaiji(g, p, foe, ctx) { p.qi = Math.min(g.maxQi, p.qi + 3); }

  /* ---------- DLC2 公共牌 ---------- */
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
  // 摄魂大法：观看对手手牌并选择1张，使其下回合必须打出该牌（异步：需要玩家决策）
  async function eShehun(g, p, foe, ctx) {
    if (foe.hand.length > 0) {
      var choice = await g.decide({
        type: 'force-card', player: p, foe: foe,
        title: '摄魂大法',
        text: p.heroName + '施展摄魂大法：请选择一张牌，令 ' + foe.heroName + ' 下回合必须打出。',
        options: foe.hand.map(function (c) {
          return { id: String(c.uid), label: c.name, desc: cardBrief(c) + '｜' + (c.desc || '') };
        })
      });
      var card = foe.hand.find(function (c) { return String(c.uid) === choice; });
      if (card) foe.forcedCard = card;
    }
    p.qisurge = true;
  }

  /* ---------- 亮牌即生效的"本回合"防御效果 ---------- */
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

  // ---------------- 卡牌简表（UI/决策展示用） ----------------
  function rangeText(lo, hi) {
    if (lo === 0 && hi === 4) return '任意';
    var names = ['贴身', '近身', '中距', '远距', '极远'];
    return names[lo] + (hi > lo ? '-' + names[hi] : '');
  }
  function cardBrief(c) {
    var s = '速' + c.speed + ' / 耗' + c.cost + ' / ' + rangeText(c.lo, c.hi) + ' / 伤' + c.dmg;
    if (c.ultimate) s = '【绝学】' + s;
    return s;
  }

  // ---------------- 角色定义（默认 = balanced 数值） ----------------
  var CHARACTERS = {
    liu: {
      id: 'liu', name: '柳如风', title: '剑侠', weapon: '剑',
      style: '剑走轻灵，长于速攻与位移，套路连击伤害可观，但身板单薄，惧怕硬撼。',
      cards: [
        { id: 'jifengci', name: '疾风刺', speed: 8, cost: 1, lo: 0, hi: 1, dmg: 2, pre: eJifengci, jifengciBonus: 0,
          desc: '无附加效果。' },
        { id: 'huifeng', name: '回风拂柳', speed: 6, cost: 0, lo: 1, hi: 2, dmg: 1, pre: eHuifeng,
          desc: '先手：将距离变为1。后手：将距离变为2。' },
        { id: 'jinghong', name: '惊鸿一瞥', speed: 9, cost: 2, lo: 2, hi: 3, dmg: 3, pre: eJinghong,
          desc: '先手：突进，距离-2（至最近1）。后手：后撤，距离+1。' },
        { id: 'raozhirou', name: '绕指柔', speed: 4, cost: 1, lo: 0, hi: 1, dmg: 1, post: eRaozhirou, appliesPoise: true,
          desc: '造成伤害后，给对手1层破绽。' },
        { id: 'jianqi', name: '剑气纵横', speed: 5, cost: 2, lo: 2, hi: 3, dmg: 2, pre: eJianqi, appliesInner: true,
          desc: '先手：造成1层内伤。后手：自身回复1点真气。' },
        { id: 'taxue', name: '踏雪无痕', speed: 7, cost: 0, lo: 0, hi: 4, dmg: 0, pre: eTaxue,
          desc: '将距离变为3（远）。移除自身1层破绽。' },
        { id: 'sanhuan', name: '三环套月', speed: 6, cost: 2, lo: 0, hi: 1, dmg: 2, pre: eSanhuan, sanhuanBonus: 1,
          desc: '连击：若打出时你回气堆恰好有2张牌，此招伤害+1。' },
        { id: 'yuntai', name: '云台三落', speed: 3, cost: 2, lo: 0, hi: 1, dmg: 3, reveal: rYuntai,
          desc: '后手：本回合你受到的先手伤害-2（守御反击）。' }
      ],
      ult: { id: 'tianwai', name: '天外飞仙', speed: 10, cost: 4, lo: 0, hi: 4, dmg: 6, ultimate: true, pre: eTianwai,
        desc: '一剑西来，无坚不摧。使用后移出游戏。' }
    },
    tie: {
      id: 'tie', name: '铁无双', title: '拳师', weapon: '拳',
      style: '拳掌刚猛，伤害高，擅长施加破绽与内伤，防御技可化解危机，但速度偏慢，易被风筝。',
      cards: [
        { id: 'heiho', name: '黑虎掏心', speed: 5, cost: 1, lo: 0, hi: 1, dmg: 3, pre: eHeiho, appliesPoise: true,
          desc: '先手：对手获得1层破绽。' },
        { id: 'tieshan', name: '铁山靠', speed: 4, cost: 2, lo: 0, hi: 4, dmg: 4, pre: eTieshan,
          desc: '无视当前距离，使用后距离变为0（贴身硬撼）。' },
        { id: 'suishi', name: '碎石掌', speed: 3, cost: 0, lo: 1, hi: 2, dmg: 2, pre: eSuishi,
          desc: '先手：距离-1。后手：此招伤害+1。' },
        { id: 'chanshen', name: '缠身十八打', speed: 6, cost: 1, lo: 0, hi: 1, dmg: 1, pre: eChanshen,
          chanshenDmg: 2, chanshenPoise: 1, appliesPoise: true,
          desc: '连击：若打出时你回气堆牌数为1或2，额外造成2点伤害，并施加1层破绽。' },
        { id: 'jinzhong', name: '金钟罩', speed: 2, cost: 2, lo: 0, hi: 4, dmg: 0, pre: eJinzhong, reveal: rJinzhong,
          desc: '本回合你受到的下次伤害-2，并移除自身所有破绽。不动如山。' },
        { id: 'bengquan', name: '崩拳', speed: 7, cost: 2, lo: 1, hi: 2, dmg: 3, pre: eBengquan,
          desc: '突进，距离-1。先手：本次伤害无视减伤效果。' },
        { id: 'paishan', name: '排山倒海', speed: 1, cost: 3, lo: 0, hi: 1, dmg: 6, pre: ePaishan,
          desc: '使用后自身获得1层破绽（用力过猛，招式用老）。' },
        { id: 'huifengzhang', name: '回风掌', speed: 5, cost: 0, lo: 1, hi: 2, dmg: 2, pre: eHuifengzhang,
          desc: '将距离变为2。若后手，改为变为3（借力拉开）。' }
      ],
      ult: { id: 'banruo', name: '般若金刚掌', speed: 10, cost: 5, lo: 0, hi: 1, dmg: 8, ultimate: true, pre: eBanruo,
        jianzhongCost: -1, appliesInner: true,
        desc: '对对手造成2层内伤。使用后移出游戏。刚猛无俦，中者筋脉尽断。' }
    },
    li: {
      id: 'li', name: '厉斩风', title: '刀狂', weapon: '刀',
      style: '中距离爆发，血怒换伤，强破防。招式大开大阖，不惜自损气血。',
      cards: [
        { id: 'jihuodao', name: '疾火刀', speed: 7, cost: 2, lo: 1, hi: 2, dmg: 2, pre: eJihuodao,
          desc: '先手：距离-1，且本伤害+1。' },
        { id: 'huxiao', name: '虎啸斩', speed: 5, cost: 2, lo: 0, hi: 1, dmg: 4, pre: eHuxiao, appliesInner: true,
          desc: '后手：若本回合你受到过伤害，额外施加1层内伤。' },
        { id: 'daowang', name: '缠身刀网', speed: 6, cost: 1, lo: 1, hi: 2, dmg: 2, pre: eDaowang, appliesPoise: true,
          desc: '先手：对手获得1层破绽。后手：距离+1，自身真气+1。' },
        { id: 'nixue', name: '逆血刀法', speed: 3, cost: 0, lo: 0, hi: 1, dmg: 2, pre: eNixue, selfHp: 2, nixueBonus: 1,
          desc: '自身气血-2，此招伤害+1。若因此气血降至0，仍可照常结算此招。' },
        { id: 'tiesuo', name: '铁索横江', speed: 2, cost: 2, lo: 1, hi: 2, dmg: 0, pre: eTiesuo, reveal: rTiesuo,
          desc: '本回合你受到的下一次伤害-2。自身获得1层破绽。' },
        { id: 'bawang', name: '霸王卸甲', speed: 8, cost: 0, lo: 0, hi: 4, dmg: 1, pre: eBawang, poiseChange: 1,
          desc: '距离变为0。获得自身1层破绽。若对手有内伤，则伤害+1。' },
        { id: 'xuanfeng', name: '旋风扫叶', speed: 4, cost: 2, lo: 0, hi: 2, dmg: 3, pre: eXuanfeng, appliesInner: true,
          desc: '先手：造成1层内伤。后手：自身真气-1（若真气不足则无影响）。' },
        { id: 'yixiao', name: '一啸动千山', speed: 9, cost: 2, lo: 3, hi: 4, dmg: 2, pre: eYixiao, dash: 2,
          desc: '突进，距离-2。若结算后距离为0，则伤害+2。' }
      ],
      ult: { id: 'jiuzhuan', name: '九转天刀', speed: 10, cost: 5, lo: 0, hi: 1, dmg: 8, ultimate: true, pre: eJiuzhuan,
        appliesInner: true,
        desc: '对对手造成2层内伤。自身获得2层破绽。使用后移出游戏。天刀一转，神鬼俱灭。' }
    },
    tang: {
      id: 'tang', name: '唐十七', title: '千手', weapon: '暗',
      style: '远程风筝，叠毒消耗，高回避。以漫天花雨般的毒镖飞石折磨对手。',
      cards: [
        { id: 'feihuang', name: '飞蝗石', speed: 8, cost: 1, lo: 3, hi: 4, dmg: 1, appliesPoison: true, pre: eFeihuang,
          desc: '先手：施加1层中毒。' },
        { id: 'xiuli', name: '袖里箭', speed: 6, cost: 0, lo: 2, hi: 3, dmg: 2, pre: eXiuli, reveal: rXiuli,
          desc: '后手：闪避，距离+1，且本回合下次受到的伤害-1。' },
        { id: 'dujili', name: '毒蒺藜', speed: 5, cost: 2, lo: 1, hi: 2, dmg: 1, appliesPoison: true, pre: eDujili,
          desc: '施加2层中毒。后手：自身真气-1。' },
        { id: 'mantian', name: '漫天花雨', speed: 4, cost: 3, lo: 2, hi: 4, dmg: 1, appliesPoison: true, appliesPoise: true, pre: eMantian,
          desc: '对手获得2层中毒与1层破绽。' },
        { id: 'yandan', name: '烟幕弹', speed: 7, cost: 1, lo: 0, hi: 4, dmg: 0, pre: eYandan,
          desc: '距离变为4。移除自身1层破绽。' },
        { id: 'touguding', name: '透骨钉', speed: 9, cost: 2, lo: 0, hi: 1, dmg: 2, pre: eTouguding,
          desc: '本次伤害无视减伤效果。先手且对手中毒层数≥2时，伤害+1。' },
        { id: 'hansha', name: '含沙射影', speed: 3, cost: 1, lo: 2, hi: 3, dmg: 3, pre: eHansha,
          desc: '后手：若对手本回合使用的招式速度≥7，此招伤害+2。' },
        { id: 'jinchan', name: '金蝉脱壳', speed: 1, cost: 2, lo: 0, hi: 4, dmg: 0, pre: eJinchan, reveal: rJinchan,
          desc: '本回合你受到的下一次伤害-3。然后距离变为3，自身获得1层破绽。' }
      ],
      ult: { id: 'baoyu', name: '暴雨梨花针', speed: 10, cost: 4, lo: 0, hi: 4, dmg: 4, appliesPoison: true, ultimate: true, pre: eBaoyu,
        desc: '施加3层中毒。直至下回合结束，对手出招速度-3。使用后移出游戏。出必见血，空回不祥。' }
    },
    zhang: {
      id: 'zhang', name: '张玄清', title: '太极', weapon: '拳',
      style: '后手反击，真气循环，借力打力。以柔劲化力，借敌之力反伤敌身。',
      cards: [
        { id: 'yunshou', name: '云手', speed: 4, cost: 0, lo: 0, hi: 1, dmg: 3, reveal: rYunshou,
          desc: '后手：本回合你受到的所有伤害-1，并回复1真气。' },
        { id: 'lanque', name: '揽雀尾', speed: 3, cost: 2, lo: 1, hi: 2, dmg: 2, pre: eLanque, appliesPoise: true,
          desc: '先手：距离变为1。后手：距离变为2，且对手获得1层破绽。' },
        { id: 'rufeng', name: '如封似闭', speed: 2, cost: 1, lo: 0, hi: 4, dmg: 0, reveal: rRufeng,
          desc: '本回合你受到的下一次伤害-2。若此减伤将该次伤害降至0，则对攻击者造成2点伤害。' },
        { id: 'banlan', name: '搬拦捶', speed: 6, cost: 2, lo: 0, hi: 1, dmg: 4, pre: eBanlan,
          desc: '后手：此招伤害+2，并将距离变为0。' },
        { id: 'yema', name: '野马分鬃', speed: 5, cost: 1, lo: 1, hi: 2, dmg: 2, pre: eYema, appliesPoise: true,
          desc: '先手：对手获得1层破绽。后手：自身回复2真气。' },
        { id: 'yunv', name: '玉女穿梭', speed: 8, cost: 0, lo: 2, hi: 4, dmg: 1, pre: eYunv, distDelta: -2,
          desc: '距离-2，移除自身1层破绽。' },
        { id: 'gaotama', name: '高探马', speed: 7, cost: 1, lo: 0, hi: 1, dmg: 3, pre: eGaotama, appliesInner: true,
          desc: '先手：突进，距离-1。后手：造成1层内伤。' },
        { id: 'shizishou', name: '十字手', speed: 1, cost: 1, lo: 0, hi: 1, dmg: 1, pre: eShizishou,
          desc: '后手：你获得太极势（下回合出招速度+2），且本招式伤害+1。' }
      ],
      ult: { id: 'taiji', name: '太极两仪掌', speed: 10, cost: 5, lo: 0, hi: 4, dmg: 0, ultimate: true, pre: eTaiji, reveal: rTaiji,
        desc: '本回合你不受任何伤害。将本回合你本应受到的第一段先手招式伤害（原数值）反弹给对手。自身回复3真气。使用后移出游戏。太极圆转，有来有去。' }
    }
  };

  // ---------------- DLC2 公共牌（15张） ----------------
  var PUBLIC_CARDS = [
    { id: 'babu', name: '八步赶蝉', speed: 9, cost: 1, lo: 0, hi: 4, dmg: 0, pre: eBabu,
      desc: '距离变为0。若当前距离本就为0，则改为变为4。仙踪无定，一苇渡江。' },
    { id: 'yiwei', name: '一苇渡江', speed: 7, cost: 0, lo: 0, hi: 4, dmg: 0, pre: eYiwei,
      desc: '距离+2。移除自身1层破绽。乘天地之正，而御六气之辩。' },
    { id: 'shenxing', name: '神行百变', speed: 6, cost: 1, lo: 1, hi: 2, dmg: 1, pre: eShenxing,
      desc: '先手：距离-1。后手：距离+1。无论先后手，本次招式结算后，自身获得气涌。' },
    { id: 'poyu', name: '破玉拳', speed: 5, cost: 2, lo: 0, hi: 1, dmg: 3, pre: ePoyu, appliesInner: true,
      desc: '先手：对手获得1层内伤。后手：本招式伤害+1。玉碎昆岗，刚猛破敌。' },
    { id: 'wuchang', name: '无常索命', speed: 4, cost: 2, lo: 1, hi: 2, dmg: 2, pre: eWuchang,
      rangeWidenLast: true,
      desc: '若对手气血低于15，此招伤害+2。后手：此招距离限制放宽1格（即0-3均可）。' },
    { id: 'fenjin', name: '分筋错骨手', speed: 3, cost: 3, lo: 0, hi: 1, dmg: 2, pre: eFenjin, appliesPoise: true,
      desc: '造成2层破绽。后手：自身真气+1。拆骨错筋，封其关节。' },
    { id: 'chuanxin', name: '穿心指', speed: 8, cost: 2, lo: 0, hi: 4, dmg: 2, pre: eChuanxin,
      desc: '本次伤害无视减伤效果。先手：距离-1。一指出，金石穿。' },
    { id: 'pangen', name: '盘根诀', speed: 1, cost: 3, lo: 0, hi: 4, dmg: 0, reveal: rPangen,
      desc: '本回合你受到的所有伤害-2。自身获得气涌。身如盘松，万钧不移。' },
    { id: 'muchun', name: '沐春风', speed: 2, cost: 1, lo: 0, hi: 4, dmg: 0, pre: eMuchun, healAmt: 3.5,
      desc: '回复3点气血，获得1层破绽。后手：改为回复4点气血，不获得破绽。枯木逢春，润物无声。' },
    { id: 'qiyi', name: '如意气甲', speed: 5, cost: 2, lo: 0, hi: 4, dmg: 0, reveal: rQiyi,
      desc: '本回合你受到的下一次伤害由真气抵消：每有1点真气减少1点伤害并消耗等量真气。先手且本回合未受伤：回复2真气。' },
    { id: 'wuluo', name: '五罗轻烟掌', speed: 7, cost: 2, lo: 1, hi: 2, dmg: 1, appliesPoison: true, pre: eWuluo,
      desc: '施加2层中毒。后手：施加的毒层数+1。轻烟过处，五毒攻心。' },
    { id: 'chilian', name: '赤练毒砂', speed: 6, cost: 1, lo: 0, hi: 2, dmg: 1, appliesPoison: true, appliesPoise: true, pre: eChilian,
      desc: '施加1层中毒和1层破绽。蛇蝎美人心，毒砂掩黄泉。' },
    { id: 'wuxiang', name: '无相劫指', speed: 4, cost: 2, lo: 2, hi: 3, dmg: 2, pre: eWuxiang,
      desc: '先手：对手下回合出招速度-2。后手：自身真气+1。无相无形，劫数难逃。' },
    { id: 'shehun', name: '摄魂大法', speed: 3, cost: 3, lo: 0, hi: 1, dmg: 0, pre: eShehun,
      desc: '观看对手手牌，并选择其中1张，使其下回合必须打出该牌（若真气不足则强制落空并正常获得破绽）。自身获得气涌。' },
    { id: 'douzhuan', name: '斗转星移', speed: 10, cost: 4, lo: 0, hi: 4, dmg: 0, reveal: rDouzhuan, removed: true,
      desc: '本回合你不受任何伤害。将本回合你本应受到的第一段先手招式伤害（原数值）反弹给对手。此牌不受平速伤害-1影响。使用后移出游戏。以彼之道，还施彼身。' }
  ];

  // 武器类型（剑冢遗迹用）：柳如风=剑 铁无双/张玄清=拳 厉斩风=刀 唐十七=暗
  (function assignWeapons() {
    CHARACTERS.liu.cards.forEach(function (c) { c.weapon = '剑'; });
    CHARACTERS.liu.ult.weapon = '剑';
    [CHARACTERS.tie, CHARACTERS.zhang].forEach(function (h) {
      h.cards.forEach(function (c) { c.weapon = '拳'; });
      h.ult.weapon = '拳';
    });
    CHARACTERS.li.cards.forEach(function (c) { c.weapon = '刀'; });
    CHARACTERS.li.ult.weapon = '刀';
    CHARACTERS.tang.cards.forEach(function (c) { c.weapon = '暗'; });
    CHARACTERS.tang.ult.weapon = '暗';
    PUBLIC_CARDS.forEach(function (c) {
      if (c.name === '穿心指' || c.name === '八步赶蝉') c.weapon = '剑';
      else if (c.name === '破玉拳' || c.name === '分筋错骨手' || c.name === '五罗轻烟掌') c.weapon = '拳';
      else c.weapon = null;
    });
  })();

  // ---------------- DLC3 场景牌 ----------------
  var SCENES = {
    huashan:   { id: 'huashan',   name: '华山之巅', desc: '孤峰独立，云海翻腾。距离不得主动后退：任何使距离增加的效果改为无效。' },
    zhuhai:    { id: 'zhuhai',    name: '竹海密林', desc: '万竿青竹，遮天蔽日。速度6及以上的招式，其最终伤害-1（最低1）。' },
    dashamo:   { id: 'dashamo',   name: '大漠狂沙', desc: '风沙蔽日，真气外泄。双方真气上限临时变为3，调息阶段回复2真气。' },
    bingfeng:  { id: 'bingfeng',  name: '冰封寒潭', desc: '潭面如镜，寒气彻骨。亮牌后，速度较高的一方获得1层破绽（平速则双方均不获得）。' },
    duzhang:   { id: 'duzhang',   name: '毒瘴沼泽', desc: '黑水翻腾，瘴气弥漫。中毒不自然衰减；任何造成内伤的效果改为等量中毒。' },
    jianzhong: { id: 'jianzhong', name: '剑冢遗迹', desc: '残剑如林，剑意弥漫。剑法招式真气消耗-1（最低0）；拳掌招式伤害-1（最低1）。' }
  };

  // ---------------- DLC4 援护角色牌（12张） ----------------
  // when: regen=调息阶段 preplay=出招阶段开始 reveal=亮牌后 miss=落空时
  //       firstDmg=先手伤害前 deal=造成伤害后 take=受伤害时 death=濒死时
  function yhDoctor(g, p) { if (p.hp >= p.maxhp) p.qi = Math.min(g.maxQi, p.qi + 2); else p.hp = Math.min(p.maxhp, p.hp + 5); }
  function yhGaibang(g, p) { p.yuanhuCostReduce = 2; if (p.hand.length < g.foe(p).hand.length) p.qi = Math.min(g.maxQi, p.qi + 1); }
  function yhXingxiu(g, p, foe) { foe.poison += 2; }
  function yhZhujian(g, p) { p.dmgBonusPerm += 1; p.maxhp -= 3; if (p.hp > p.maxhp) p.hp = p.maxhp; }
  function yhChuanfu(g, p) { g.changeDist(p, 4); p.qi = Math.min(g.maxQi, p.qi + 1); }
  function yhDuyi(g, p) { p.poison = 0; p.inner = 0; }
  function yhShenmi(g, p) { p.hp = 5; p.poise = 0; }

  var YUANHU_CARDS = [
    { id: 'doctor', name: '灵鹫宫医女', when: 'regen', effect: yhDoctor,
      desc: '回复5点气血；若气血已满，则改为回复2点真气。活着才有输出。' },
    { id: 'mobei', name: '漠北刀客', when: 'firstDmg', effect: null,
      desc: '你打出先手招式并即将计算伤害时：该次伤害+3。一刀祭出，有死无生。' },
    { id: 'miaoshou', name: '妙手空空', when: 'miss', effect: null,
      desc: '你的招式落空时：避免因此获得的那层破绽；并从公共牌库随机抽1张加入手牌（未使用DLC2时，改为从回气堆选1张返回手牌）。偷天换日，移花接木。' },
    { id: 'gaibang', name: '丐帮长老', when: 'preplay', effect: yhGaibang,
      desc: '本回合你使用的招式真气消耗-2（最低0）。若你的手牌数量少于对手，额外回复1点真气。叫花子别的没有，就是人多。' },
    { id: 'anxiang', name: '暗香刺客', when: 'deal', effect: null,
      desc: '你的招式对对手造成伤害时：额外施加1层中毒和1层破绽。影落香随，命绝无形。' },
    { id: 'wuseng', name: '护寺武僧', when: 'take', effect: null,
      desc: '你受到伤害时（在减伤效果结算后）：该次伤害-3（最低为0）。金刚怒目，庇佑一方。' },
    { id: 'xingxiu', name: '星宿老怪', when: 'reveal', effect: yhXingxiu,
      desc: '你打出一张具有中毒效果的招式牌时（亮牌后）：该招式本次施加的中毒层数+2。毒不死你，老夫白活。' },
    { id: 'zhujian', name: '铸剑师', when: 'regen', effect: yhZhujian,
      desc: '本局剩余时间内，你所有招式造成的伤害+1；但你立即降低3点气血上限（当前气血若高于新上限则调至新上限）。此效果不可驱散。舍身铸锋，锐不可当。' },
    { id: 'shuoshu', name: '说书人', when: 'reveal', effect: null,
      desc: '将当前距离改为任意数值（0-4之间选择）。此距离改变不影响落空判定。醒木一响，咫尺天涯。' },
    { id: 'chuanfu', name: '船夫', when: 'preplay', effect: yhChuanfu,
      desc: '将距离变为4，并回复1点真气。渡尽劫波，江湖再见。' },
    { id: 'duyi', name: '毒医', when: 'regen', effect: yhDuyi,
      desc: '移除你身上的所有中毒层数和所有内伤层数。是药三分毒，是毒七分药。' },
    { id: 'shenmi', name: '神秘老僧', when: 'death', effect: yhShenmi,
      desc: '你的气血降至0或以下，即将落败时：气血恢复至5点，并移除你身上的所有破绽（一局一次免死）。我不入地狱，谁入地狱。' }
  ];

  // ---------------- 平衡补丁 ----------------
  // balanced：本体+DLC1/DLC3 配置（默认数值已内建在卡牌定义中）
  // balanced2：DLC2/DLC4 配置 → 在 balanced 基础上再特调 7 处（逐卡应用，不改共享数据）
  function applyBalanced2ToCard(c) {
    switch (c.name) {
      case '疾风刺': c.jifengciBonus = 1; break;           // 恢复先手伤害+1
      case '揽雀尾': c.cost = 1; break;
      case '野马分鬃': c.cost = 0; break;
      case '逆血刀法': c.nixueBonus = 0; break;            // 2伤换2血
      case '霸王卸甲': c.poiseChange = 2; break;           // 自获2破绽
      case '金钟罩': c.cost = 1; break;
    }
  }

  // ---------------- 导出 ----------------
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

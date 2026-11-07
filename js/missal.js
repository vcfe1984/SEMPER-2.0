// 彌撒 — Mass builder for 常頌 SEMPER.
// Picks the day's Mass from the liturgical calendar (via office.js dayInfo) and assembles
// the Order of Mass with the chosen texts into one continuous text, from the entrance antiphon to the dismissal.
import { WD } from './calendar.js';

let M = null;
export async function loadMissal(base = 'data/') {
  if (!M) M = await (await fetch(base + 'missal.json')).json();
  return M;
}
export const missalLoaded = () => !!M;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- choosing the formulary ----------
function seasonVariant(T) { return T.season === 'lent' ? 'L' : T.season === 'easter' ? 'E' : 'O'; }
function saintMasses(id, T) {
  const s = M.s[id]; if (!s) return [];
  if (s.masses) return s.masses;
  const v = s[seasonVariant(T)] || s.O || s.L || s.E;
  return v ? [v] : [];
}
/** the weekday (temporal) formulary for a calendar key, with shared weekday propers filled in */
function temporalMass(T) {
  const k = T.key;
  let f = M.t[k];
  if (Array.isArray(f)) return f;
  f = f ? clone(f) : null;
  let w = null, m;
  if ((m = k.match(/^ot(\d+)-[1-6]$/))) w = M.w['otw' + m[1]];
  if (k.match(/^jan\d+$/)) w = M.w['preep-' + T.wd];
  if (w) {
    f = f || { title: T.title, readings: [] };
    for (const p of ['entrance', 'collect', 'offerings', 'communion', 'postcommunion', 'preface']) if (!(f[p] && (f[p].length || f[p].name))) f[p] = w[p];
  }
  if (f) f.title = T.title;
  return f ? [f] : [];
}
/** a memorial: the weekday Mass with the saint's proper parts; readings of the weekday, the saint's as an alternative */
function memorialMass(base, saint, title) {
  const f = clone(base || { readings: [] });
  f.title = title;
  for (const p of ['entrance', 'collect', 'offerings', 'communion', 'postcommunion']) if (saint[p] && saint[p].length) f[p] = saint[p];
  if (saint.preface && (saint.preface.lines.length || saint.preface.name)) f.preface = saint.preface;
  f.readingSets = [{ label: '平日讀經', items: (base && base.readings) || [] }];
  if (saint.readings && saint.readings.length) {
    const s = { label: '聖人讀經', items: saint.readings };
    const weekdayFirst = (saint.note || []).some((n) => /首選：平日|一般選用平日/.test(n)) || !(base && base.readings && base.readings.length);
    if (weekdayFirst && base && base.readings && base.readings.length) f.readingSets.push(s); else f.readingSets.unshift(s);
  }
  f.gloria = false; f.creed = false; f.memorial = true; f.saintNote = saint.note;
  return f;
}

/** All the Masses one may say on this day: [{id, label, f}] — the first is the default. */
export function massesFor(info, choiceId) {
  const L = info.L, T = L.temporal, p = L.primary;
  const out = [];
  const add = (id, label, f, extra = {}) => f && out.push({ id, label, f, ...extra });
  if (M.special[T.key] && p.source !== 'santoral') {
    add('special', M.special[T.key].title, { ...M.special[T.key], special: true });
    return { list: out, more: [] };
  }
  const opt = choiceId && L.options.find((o) => o.id === choiceId);
  if (opt) {                                     // optional memorial chosen by the user
    const base = temporalMass(T)[0];
    const sm = saintMasses(opt.id, T)[0];
    if (sm) add(opt.id, opt.title, memorialMass(base, sm, opt.title + (opt.commemoration ? '（紀念）' : '（自由紀念）')));
  }
  if (p.source === 'santoral' && ['solemnity', 'feast', 'allsouls'].includes(p.rank)) {
    const ms = saintMasses(p.id, T);
    ms.forEach((f, i) => add(p.id + ':' + i, (f.label || '') || p.title, { ...f, rank: p.rank, title: f.title || p.title }));
  } else if (p.source === 'santoral' || p.source === 'movable') {
    const base = temporalMass(p.source === 'movable' ? { ...T, key: L.base ? L.base.key : T.key } : T)[0];
    const sm = p.source === 'movable' ? arr(M.t[p.key])[0] : saintMasses(p.id, T)[0];
    if (sm) add(p.id || p.key, p.title, memorialMass(base, sm, p.title));
    else add(T.key, T.title, base);
  }
  if (!out.length || p.source === 'temporal') {
    temporalMass(p.source === 'temporal' ? p : T).forEach((f, i) => add(T.key + ':' + i, f.label || T.title, { ...f, rank: p.rank }));
  }
  // vigil Masses go after the day Mass in the list; the day Mass is the default
  const day = out.findIndex((o) => /當日/.test(o.f.label || ''));
  if (day > 0) out.unshift(out.splice(day, 1)[0]);
  // Masses that may be said on other days: All Souls (for the dead), Lunar New Year, Mission Sunday
  const more = [];
  (M.s['1102'] && M.s['1102'].masses || []).forEach((f, i) => more.push({ id: 'dead:' + i, label: '追思已亡（' + f.label + '）', f: { ...f, title: '追思已亡諸信者　' + f.label } }));
  M.extra.forEach((f) => more.push({ id: 'x:' + f.id, label: f.title, f }));
  return { list: out, more };
}

// ---------- default choices ----------
const PF = () => M.ordo.prefaces;
function pfIndex(rx) { return PF().findIndex((p) => rx.test(p.title)); }
function pfAll(rx) { return PF().map((p, i) => [p, i]).filter(([p]) => rx.test(p.title)).map(([, i]) => i); }
const PF_RULES = [
  [/將臨期.*（一）/, /^將臨期頌謝詞（一）/], [/將臨期.*（二）/, /^將臨期頌謝詞（二）/], [/將臨/, /^將臨期/],
  [/主顯/, /^主顯節/], [/聖誕|耶誕/, /^(聖誕期|耶誕節)頌謝詞/],
  [/四旬期.*（一）/, /^四旬期頌謝詞（一）/], [/四旬期.*（二）/, /^四旬期頌謝詞（二）/], [/四旬期.*（三）/, /^四旬期頌謝詞（三）/], [/四旬期.*（四）/, /^四旬期頌謝詞（四）/], [/四旬/, /^四旬期/],
  [/受難/, /^主受難/], [/十字/, /^聖十字架/], [/升天/, /^升天節/], [/五旬節/, /^五旬節/], [/聖神/, /^聖神/], [/復活/, /^復活/],
  [/聖三/, /^聖三/], [/聖體/, /^聖體/], [/聖心/, /^耶穌聖心/], [/君王/, /^耶穌君王/], [/聖母|瑪利亞/, /^聖母/], [/若瑟/, /^聖若瑟/],
  [/天使/, /^天使/], [/宗徒/, /^宗徒/], [/殉道/, /^殉道者/], [/牧者/, /^牧者/], [/貞女|會士/, /^貞女及會士/], [/聖人/, /^聖人通用/],
  [/追思|亡者/, /^追思亡者/], [/常年期主日|常年期頌謝詞/, /^常年期頌謝詞/], [/常年期|平日/, /^(平日通用|常年期)/],
];
function seasonPrefaces(T, f, dateStr) {
  const s = T.season, k = T.key;
  if (s === 'adv') return pfAll(Number(dateStr.slice(8)) >= 17 && dateStr.slice(5, 7) === '12' ? /^將臨期頌謝詞（二）/ : /^將臨期/);
  if (k === 'epiphany') return pfAll(/^主顯節/);
  if (s === 'xmas') return pfAll(/^(聖誕期|耶誕節)頌謝詞/);
  if (/^holy-|^palm/.test(k) || (s === 'lent' && T.week === 5)) return [...pfAll(/^主受難/), ...pfAll(/^四旬期/)];
  if (s === 'lent') return pfAll(/^四旬期/);
  if (k === 'ascension' || (s === 'easter' && T.week >= 6 && T.key !== 'pentecost')) return [...pfAll(/^升天節/), ...pfAll(/^復活/)];
  if (s === 'easter') return pfAll(/^復活/);
  if (T.wd === 0) { const all = pfAll(/^常年期頌謝詞/); const n = ((T.week || 1) - 1) % all.length; return [...all.slice(n), ...all.slice(0, n)]; }
  return [...pfAll(/^平日通用/), ...pfAll(/^常年期頌謝詞/)];
}
function saintPrefaces(title) {
  const r = [];
  if (/聖母|瑪利亞/.test(title)) r.push(...pfAll(/^聖母/));
  if (/宗徒/.test(title)) r.push(...pfAll(/^宗徒/));
  if (/殉道/.test(title)) r.push(...pfAll(/^殉道者/));
  if (/主教|司鐸|教宗|執事/.test(title)) r.push(...pfAll(/^牧者/));
  if (/貞女|會士|院長|修女|隱修/.test(title)) r.push(...pfAll(/^貞女及會士/));
  if (/若瑟/.test(title)) r.push(...pfAll(/^聖若瑟/));
  if (/天使|彌額爾|加俾額爾|辣法耳/.test(title)) r.push(...pfAll(/^天使/));
  r.push(...pfAll(/^聖人通用/));
  return r;
}
/** preface candidates: proper text first ('p'), then by the formulary's preface name, the saint, the season */
export function prefaceChoices(f, T, dateStr) {
  const c = [];
  if (f.preface && f.preface.lines && f.preface.lines.length) c.push('p');
  const name = f.preface ? f.preface.name : '';
  const genericOT = /^(當用)?常年期(主日)?頌謝詞$/.test(name) && T.season === 'ot';
  if (name && !genericOT) for (const [a, b] of PF_RULES) if (a.test(name)) { c.push(...pfAll(b)); break; }
  if (f.memorial || /聖|殉道/.test(f.title || '') && !f.preface) c.push(...saintPrefaces(f.title || ''));
  if (/追思|亡者/.test(f.title || '')) c.push(...pfAll(/^追思亡者/));
  c.push(...seasonPrefaces(T, f, dateStr));
  return [...new Set(c)];
}
export const EPS = { I: '感恩經第一式', II: '感恩經第二式', III: '感恩經第三式', IV: '感恩經第四式', Va: '感恩經第五式（甲）', Vb: '感恩經第五式（乙）', Vc: '感恩經第五式（丙）', Vd: '感恩經第五式（丁）' };
function blessingChoices(f, T) {
  const c = [{ id: 'simple', label: '簡式降福' }];
  if (f.blessing && f.blessing.length) c.unshift({ id: 'p', label: '本日隆重祝福' });
  if (T.season === 'easter' || T.key === 'easter') M.blessings.easter.forEach((b, i) => c.push({ id: 'e' + i, label: b.title }));
  M.blessings.ot.forEach((b, i) => c.push({ id: 'o' + i, label: b.title }));
  return c;
}

/** Defaults for a day + formulary. */
export function defaults(info, mass, dateStr) {
  const T = info.L.temporal, f = mass.f;
  const big = ['solemnity', 'feast', 'allsouls'].includes(f.rank) || T.wd === 0;
  const gloria = !f.memorial && (f.gloria || f.rank === 'solemnity' || f.rank === 'feast' || (T.wd === 0 && !['adv', 'lent'].includes(T.season)) || /^(oct|east1-)/.test(T.key));
  const creed = !f.memorial && (f.creed || f.rank === 'solemnity' || T.wd === 0);
  const pf = prefaceChoices(f, T, dateStr)[0];
  const bl = blessingChoices(f, T);
  const blessing = bl[0].id === 'p' ? 'p' : big && (f.solemn || T.wd === 0) ? (T.season === 'easter' && bl.find((b) => b.id === 'e1') ? 'e1' : 'o' + (((T.week || 1) - 1) % 6)) : 'simple';
  return { greet: 0, pen: 0, gloria, creed: creed ? 0 : -1, pf: pf === undefined ? 0 : pf, ep: big ? 'III' : 'II', bless: blessing, rs: 0, alt: {}, ack: 0 };
}

// ---------- rendering ----------
const SPK = /(主祭|信友|信眾|全體|會眾|執事或主祭|執事\/主祭|執事|主教|主禮|輔祭)\s*[：:;；]/g;
function inl(s) {
  return esc(s).replace(/（([^（）]{1,16})）/g, (m, x) => (/^某|^\d|^聖\.\.\.|^夜|^日|^今天|^這地方/.test(x) ? m : `<span class="ri">（${x}）</span>`)).replace(/\+/g, '<span class="ri">✠</span>');
}
class Out {
  constructor() { this.h = []; }
  sec(t) { this.h.push(`<h2 class="m-sec">${esc(t)}</h2>`); }
  h3(t, tag) { this.h.push(`<h3 class="m-h">${esc(t)}${tag ? ` <span class="tag">${esc(tag)}</span>` : ''}</h3>`); }
  rub(t, cls = '') { this.h.push(`<p class="rub ${cls}">${inl(t)}</p>`); }
  raw(h) { this.h.push(h); }
  say(sp, x, cls = '') {
    const parts = []; let last = 0, cur = sp;
    x.replace(SPK, (m, who, off) => { if (off > 0) parts.push([cur, x.slice(last, off)]); else if (!cur) cur = who; cur = who; last = off + m.length; return m; });
    parts.push([cur, x.slice(last)]);
    for (const [w, t0] of parts) { const t = t0.trim(); if (t) this.h.push(`<p class="m-p ${cls}">${w ? `<span class="spk">${esc(w)}：</span>` : ''}${inl(t)}</p>`); }
  }
  blocks(bs) {
    for (const b of bs) {
      if (b.t === 'h') { if (/^(主祭|可由|可省|可)/.test(b.x)) this.rub(b.x); else this.h3(b.x); }
      else if (b.t === 'r') this.rub(b.x);
      else this.say(b.sp || '', b.x);
    }
  }
  html() { return this.h.join(''); }
}
const SUP = 'sup';   // texts supplied by the app (not in the sources): marked for checking

function readingSlots(items, L) {
  const sun = L.cycles.sunday, wk = L.cycles.weekday;
  const tags = new Set(items.map((r) => r.tag).filter(Boolean));
  const want = [...tags].some((t) => '甲乙丙'.includes(t)) ? sun : wk;
  const its = items.filter((r) => !r.tag || r.tag === want);
  const slots = [];
  for (const r of its) {
    const last = slots[slots.length - 1];
    if (last && last.kind === r.kind) last.alts.push(r); else slots.push({ kind: r.kind, alts: [r] });
  }
  return slots;
}
function renderReading(o, it) {
  const ref = (it.lines.find((l) => /^恭讀/.test(l)) || '').split(/[　\s]+/).pop();
  if (it.kind === '福音') {
    const book = (it.lines.find((l) => /^恭讀/.test(l)) || '恭讀聖福音').replace(/[　\s]+[\d:,，\-–、 ]+.*$/, '').replace(/[　\s].*$/, '');
    o.h3(it.head, ref);
    o.say('執事或主祭', '願主與你們同在。', SUP); o.say('信友', '也與你的心靈同在。', SUP);
    o.say('執事或主祭', book + '。', SUP); o.say('信友', '主，願你受讚美。', SUP);
  } else o.h3(it.head.replace(/^(答唱詠)[　\s]*/, '$1　'));
  for (const l of it.lines) {
    if (/^（.*）$/.test(l)) o.rub(l);
    else if (/^——上主的話/.test(l)) { o.say(it.kind === '福音' ? '執事或主祭' : '讀經員', '上主的話。'); o.say('信友', it.kind === '福音' ? '基督，我們讚美你。' : '感謝天主。', SUP); }
    else if (/^【答】/.test(l)) o.say('答', l.replace(/^【答】[：:]?\s*/, ''));
    else if (/^(領|眾)[：:]/.test(l)) o.raw(`<p class="m-p"><span class="spk">${l[0]}：</span>${inl(l.slice(2).replace(/【答】$/, '')).trim()}${/【答】$/.test(l) ? ' <span class="ri">【答】</span>' : ''}</p>`);
    else if (/^恭讀/.test(l)) { if (it.kind !== '福音') o.rub(l); }
    else o.say('', l);
  }
  if (it.short_ref) o.rub('短式：' + it.short_ref);
}

function epBody(o, st, f, info) {
  const E = M.ordo.eucharistic_prayers, ep = E[st.ep], T = info.L.temporal;
  const dlg = E.II.slice(2, 5), sanctus = E.II.slice(6, 8);
  const ownPf = ['IV', 'Va', 'Vb', 'Vc', 'Vd'].includes(st.ep);
  const pfBlocks = () => {
    if (st.pf === 'p') { o.h3('頌謝詞（本日專用）'); f.preface.lines.forEach((l, i) => o.say(i === 0 ? '主祭' : '', l)); }
    else if (st.pf === 'ep2' && st.ep === 'II') { blocksOf(E.II.slice(5, 6)); }
    else { const p = M.ordo.prefaces[st.pf] || M.ordo.prefaces[0]; o.h3(p.title.replace(/（適用.*?）/, '')); o.blocks(p.body); }
  };
  const blocksOf = (b) => o.blocks(b);
  const easterOct = /^(easter|east1-|holysat)$|^east1-/.test(T.key) || T.key === 'east2-0';
  const SEAS = { '耶誕節及八日內': /^(xmas|oct\d+|mary-mother)$/.test(T.key), '主顯節': T.key === 'epiphany', '復活夜及八日內': easterOct, '耶穌升天節': T.key === 'ascension', '五旬節主日': T.key === 'pentecost' };
  if (st.ep === 'I' || st.ep === 'III') {
    o.h3('頌謝詞'); o.blocks(dlg); pfBlocks(); o.h3('歡呼歌'); o.blocks(sanctus.slice(1));
    let skip = false, seasonalUsed = false; const body = [];
    for (const b of ep.slice(1)) {
      if (b.t === 'h') {
        const s = Object.keys(SEAS).find((k) => b.x.startsWith(k));
        if (s) skip = !SEAS[s]; else if (b.x !== '主祭一人祈求' && !/^可由/.test(b.x)) skip = false;
        if (s && SEAS[s]) seasonalUsed = true;
        if (b.x === '紀念諸聖' || b.x === '求主收納祭獻') skip = false;
      }
      if (/^追思彌撒內可用/.test(b.x)) skip = !st.dead;
      if (b.t === 'h' && b.x === '讚頌詞') skip = false;
      if (!skip) body.push(b);
    }
    // EP I: when a proper Communicantes / Hanc igitur is in force, drop the ordinary one
    if (st.ep === 'I' && seasonalUsed) {
      const drop = (head) => { const a = body.findIndex((b) => b.t === 'h' && b.x === head); if (a < 0) return; let e = a + 1; while (e < body.length && !(body[e].t === 'h' && !/^(主祭一人祈求|可由)/.test(body[e].x))) e++; body.splice(a + 1, e - a - 1); };
      drop('紀念諸聖'); if (easterOct) drop('求主收納祭獻');
    }
    if (st.ep === 'III' && st.dead) { const i = body.findIndex((b) => /^（伸手）求你恩准我們已亡的弟兄姐妹/.test(b.x)); if (i >= 0) body.splice(i, 2); }
    o.blocks(body);
  } else if (st.ep === 'II') {
    o.blocks(ep.slice(1, 5)); if (st.pf === 'ep2') o.blocks(ep.slice(5, 6)); else pfBlocks(); o.blocks(ep.slice(6));
  } else {
    if (!ownPf) pfBlocks();
    o.blocks(ep.slice(1));
  }
}

export function renderMass(info, mass, st, dateStr) {
  const f = mass.f, T = info.L.temporal, O = M.ordo, o = new Out();
  if (f.special) return renderSpecial(f);
  const notes = [...(f.sub || []).filter((x) => x.length < 80), ...(f.saintNote || [])];
  if (notes.length) o.raw(`<div class="notes">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`);
  o.sec('進堂式');
  if (f.entrance && f.entrance.length) { o.h3('進堂詠'); f.entrance.forEach((l) => (/^（.*）$/.test(l) || l === '或' ? o.rub(l) : o.say('', l))); }
  o.blocks(O.sign); o.h3('致候詞'); o.blocks(O.greeting[st.greet] || O.greeting[0]);
  o.h3('懺悔詞'); o.blocks(O.penitential[st.pen] || O.penitential[0]);
  if (st.pen !== 2) { o.h3('上主，求你垂憐'); o.blocks(O.kyrie.slice(1)); }
  if (st.gloria) { o.h3('光榮頌'); o.blocks(O.gloria.filter((b) => !/^按禮規/.test(b.x))); }
  o.h3('集禱經'); o.say('主祭', '請大家祈禱。（合掌）'); o.rub('全體默禱片刻。主祭伸手誦念集禱經：');
  arr(f.collect).forEach((l, i) => (l === '或' ? o.rub('或') : o.say(i === 0 ? '主祭' : '', l)));

  o.sec('聖道禮儀');
  const sets = f.readingSets || [{ label: '', items: f.readings || [] }];
  const set = sets[Math.min(st.rs || 0, sets.length - 1)];
  const slots = readingSlots(set.items, info.L);
  const tabs = [];
  if (sets.length > 1) tabs.push(`<div class="tabs">${sets.map((s, i) => `<button class="pill" data-m="rs:${i}" aria-pressed="${i === (st.rs || 0)}">${esc(s.label)}</button>`).join('')}</div>`);
  if (tabs.length) o.raw(tabs.join(''));
  if (!slots.length) o.rub('（本日讀經尚未收錄）');
  slots.forEach((sl, si) => {
    const ai = Math.min((st.alt || {})[si] || 0, sl.alts.length - 1);
    if (sl.alts.length > 1) o.raw(`<div class="tabs">${sl.alts.map((a, j) => `<button class="pill" data-m="alt:${si}:${j}" aria-pressed="${j === ai}">${esc(sl.kind + (a.form ? '・' + a.form : '・' + '一二三四五六'[j]))}</button>`).join('')}</div>`);
    renderReading(o, sl.alts[ai]);
  });
  o.h3('講道'); o.rub('（講道）', SUP);
  if (st.creed >= 0) { o.h3('信經'); o.blocks(O.creed[st.creed] || O.creed[0]); }
  o.h3('信友禱文'); o.rub('（主祭邀請、意向及結束禱詞由團體按需要編寫）', SUP);

  o.sec('聖祭禮儀');
  o.blocks(O.offertory);
  o.h3('獻禮經'); arr(f.offerings).forEach((l, i) => (l === '或' ? o.rub('或') : o.say(i === 0 ? '主祭' : '', l)));
  o.sec(EPS[st.ep]);
  epBody(o, st, f, info);
  o.sec('領主禮');
  const com = O.communion_rite;
  o.blocks(com.slice(1));
  if (f.communion && f.communion.length) { o.h3('領主詠'); f.communion.forEach((l) => (/^（.*）$/.test(l) || l === '或' ? o.rub(l) : o.say('', l))); }
  o.h3('領主後經'); o.say('主祭', '請大家祈禱。'); arr(f.postcommunion).forEach((l, i) => (l === '或' ? o.rub('或') : o.say(i === 0 ? '主祭' : '', l)));

  o.sec('禮成式');
  const con = O.concluding, iD = con.findIndex((b) => b.t === 'h' && b.x === '遣散');
  const bl = st.bless;
  const blLines = bl === 'p' ? f.blessing : bl && bl[0] === 'o' ? M.blessings.ot[+bl.slice(1)].lines : bl && bl[0] === 'e' ? M.blessings.easter[+bl.slice(1)].lines : null;
  if (blLines) { o.h3(bl === 'p' ? '隆重祝福' : (bl[0] === 'o' ? M.blessings.ot[+bl.slice(1)].title : M.blessings.easter[+bl.slice(1)].title)); blLines.forEach((l) => (/^（.*）$/.test(l) ? o.rub(l) : o.say('', l))); }
  else o.blocks(con.slice(1, iD));
  o.blocks(con.slice(iD));
  return o.html();
}

function renderSpecial(f) {
  const o = new Out();
  o.raw(`<div class="notes"><p>本日禮儀按其專有次序舉行，以下全錄香港教區禮儀委員會經文；感恩經及其他常用部分見「彌撒常規」。</p></div>`);
  for (const l of f.lines) {
    if (/^(領|眾|答|主祭|主禮|信友|信眾|全體|會眾|執事|輔祭|讀經員)[：:]/.test(l)) o.say('', l);
    else if (/^（.*）$/.test(l) || /^(若|如|在|主祭|主禮|全體|信友|執事)[^：:]{4,}[。：]$/.test(l) && l.length < 60) o.rub(l);
    else if (l.length <= 14 && !/[。！？，]/.test(l)) o.h3(l);
    else o.say('', l);
  }
  return o.html();
}

// ---------- the options panel ----------
export function optionsPanel(info, list, cur, st, dateStr) {
  const f = cur.f, T = info.L.temporal;
  const sel = (key, label, opts, val, dis) => `<label class="mopt"><span>${esc(label)}</span><select data-ms="${key}"${dis ? ' disabled' : ''}>${opts.map(([v, t]) => `<option value="${esc(String(v))}"${String(v) === String(val) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  if (f.special) return `<div class="mpanel">${massSel(list, cur)}</div>`;
  const pfc = prefaceChoices(f, T, dateStr);
  const pfOpts = [];
  for (const c of pfc) pfOpts.push([c, c === 'p' ? '本日專用頌謝詞' : M.ordo.prefaces[c].title.replace(/（適用.*?）/, '')]);
  if (st.ep === 'II') pfOpts.unshift(['ep2', '感恩經第二式專用頌謝詞']);
  pfOpts.push(['', '──────────']);
  M.ordo.prefaces.forEach((p, i) => { if (!pfc.includes(i)) pfOpts.push([i, p.title.replace(/（適用.*?）/, '')]); });
  const ownPf = ['IV', 'Va', 'Vb', 'Vc', 'Vd'].includes(st.ep);
  const bl = blessingChoices(f, T).map((b) => [b.id, b.label]);
  return `<details class="mpanel" data-m="panel"${st.closed ? '' : ' open'}><summary>彌撒選項　<small>${esc(EPS[st.ep])}・${esc(pfOpts.find(([v]) => String(v) === String(st.pf))?.[1]?.replace(/（.*$/, '') || '')}</small></summary>${massSel(list, cur)}
  <div class="mopts">
  ${sel('greet', '致候詞', [[0, '第一式'], [1, '第二式'], [2, '第三式']], st.greet)}
  ${sel('pen', '懺悔詞', [[0, '第一式（我向全能的天主）'], [1, '第二式'], [2, '第三式（求你垂憐）']], st.pen)}
  ${sel('gloria', '光榮頌', [[1, '念'], [0, '不念']], st.gloria ? 1 : 0)}
  ${sel('creed', '信經', [[0, '尼西亞信經'], [1, '宗徒信經'], [-1, '不念']], st.creed)}
  ${sel('ep', '感恩經', Object.entries(EPS), st.ep)}
  ${sel('pf', '頌謝詞', pfOpts, st.pf, ownPf)}
  ${sel('bless', '降福', bl, st.bless)}
  ${st.ep === 'III' ? sel('dead', '為亡者', [[0, '否'], [1, '是（追思彌撒經文）']], st.dead ? 1 : 0) : ''}
  </div>
  <div class="mbtns"><button class="pill" data-m="reset">恢復預設</button><button class="pill" data-m="print">列印</button></div></details>`;
}
function massSel(list, cur) {
  const all = [...list.list.map((m) => [m.id, m.label]), ...(list.more.length ? [['', '── 其他彌撒 ──'], ...list.more.map((m) => [m.id, m.label])] : [])];
  return `<label class="mopt wide"><span>彌撒</span><select data-ms="mass">${all.map(([v, t]) => `<option value="${esc(v)}"${v === cur.id ? ' selected' : ''}${v === '' ? ' disabled' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
export function massTitle(cur) { return cur.f.title || cur.label; }
export { WD };

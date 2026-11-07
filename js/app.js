import { loadData, office, dayInfo, HOURS, dateLabel, nearestArchiveDate, invitPsalms, setCalendar, calendarList, currentCalendar } from './office.js';
import { fromIso, iso, WD } from './calendar.js';
import { initTTS, stop as stopTTS } from './tts.js';
import { loadMissal, missalLoaded, massesFor, defaults as massDefaults, renderMass as massHtml, optionsPanel, massTitle } from './missal.js';

const APP_VERSION = 'v39（彌撒試用版）';   // keep in step with VERSION in sw.js
const $ = (s) => document.querySelector(s);
const store = { get(k, d) { try { const v = localStorage.getItem('rike.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rike.' + k, JSON.stringify(v)); } catch {} } };

const hkToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
function defaultHour() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: 'numeric', hour12: false }).format(new Date()));
  if (h < 4) return '5'; if (h < 10) return '1'; if (h < 16) return '2'; if (h < 20) return '3'; return '5';
}
const S = { date: hkToday(), hour: defaultHour(), choice: {}, sub: store.get('sub', '午時'), inv: store.get('inv', '95'), alt: store.get('alt', {}) };

function parseHash() {
  const m = location.hash.match(/^#\/(\d{4}-\d\d-\d\d)?\/?([\dmbr])?(?:\?c=([\w@-]*))?/);
  if (m) { if (m[1]) S.date = m[1]; if (m[2]) S.hour = m[2]; if (m[3] !== undefined) S.choice[S.date] = m[3]; }
}
function setHash() {
  const c = S.choice[S.date];
  history.replaceState(null, '', `#/${S.date}/${S.hour}${c ? '?c=' + c : ''}`);
}

// ---------- 繁體 / 簡體 ----------
// The texts are stored in 繁體字; with 簡體字 selected every text node is converted after rendering
// (characters via OpenCC's table, plus the phrases where the character table alone would be wrong).
let T2S = null;
async function loadT2S() {
  if (T2S || store.get('script', 't') !== 's') return;
  try {
    const d = await (await fetch('data/t2s.json')).json();
    const ph = Object.keys(d.p).sort((a, b) => b.length - a.length);
    T2S = { re: new RegExp((ph.length ? ph.join('|') + '|' : '') + '[\\u3400-\\u9fff]', 'g'), f: (x) => d.p[x] || d.c[x] || x };
  } catch { T2S = null; }
}
function zh(root = document.body) {
  if (!T2S || store.get('script', 't') !== 's') return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('[data-script]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = w.nextNode(); n; n = w.nextNode()) { const v = n.nodeValue.replace(T2S.re, T2S.f); if (v !== n.nodeValue) n.nodeValue = v; }
  if (root === document.body) document.title = document.title.replace(T2S.re, T2S.f);
}

// ---------- rendering ----------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// chanting marks are never shown; stray spaces between Chinese characters are dropped
const marks = (s) => esc(s.replace(/\s*[※*＊†]\s*/g, '').replace(/(?<=[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])/g, ''));
const VERSE = new Set(['psalmody', 'gospel', 'invit', 'tedeum']);
const MARK_END = /[※*＊†]\s*$/;
function renderLine(l, ctx = {}) {
  let m;
  if (l.startsWith('§')) return `<h4 class="alt">${esc(l.slice(1))}</h4>`;
  // ℣ 領 / ℟ 答 (答 also for 眾): only the labels are red, the text is black like all other text.
  if ((m = l.match(/^(領|眾|答|啟|應)\s*[：:]\s*(.*)$/))) {
    const t = m[2].replace(/^[—─]{1,2}\s*/, '');
    if ('領啟'.includes(m[1])) return t !== m[2] ? `<p class="vr" data-part="lead">${marks(m[2])}</p>` : `<p class="vr" data-part="lead"><span class="spk">領：</span>${marks(t)}</p>`;
    return `<p class="vr" data-part="resp"><span class="spk">答：</span>${marks(t)}</p>`;
  }
  if (/^[—─]{1,2}/.test(l)) return `<p class="cont" data-part="lead">${marks(l)}</p>`;   // second half of an intercession, with its dash
  if ((m = l.match(/^((?:謝主曲|讚主曲)?對經[一二三]?)\s*[：:]\s*(.*)$/))) return `<p class="ant"><span class="antl">${m[1]}：</span>${marks(m[2])}</p>`;
  if (/^(壹|貳|叁|肆|伍)$/.test(l)) return `<p class="part">${l}</p>`;
  if (/^(夜間或清晨用|日間用|午前|午時|午後)(\s*[（(].*[)）])?$/.test(l)) return `<h4 class="alt">${esc(l)}</h4>`;
  if (/^[（(][^）)]*[)）]$/.test(l) || /^\(?(任擇其一|第[一二三]式)\)?$/.test(l)) return `<p class="rub">${esc(l)}</p>`;
  // the sentence under a psalm title (「…」(希3:13)); quoted words inside a psalm stay psalm text
  if ((/^「.*」/.test(l) && (/[（(][^（）()]*\d[^（）()]*[）)]\s*$/.test(l) || /^(聖詠|聖歌|讚主曲|西默盎|匝加利亞|聖母謝主曲)/.test(ctx.prev || ''))) || /^（[^）]*）$/.test(l)) return `<p class="epi">${esc(l)}</p>`;
  if (l.length < 40 && /^(聖詠|聖歌|讚主曲|西默盎|匝加利亞|聖母謝主曲|\(路)/.test(l)) return `<p class="ps">${esc(l)}</p>`;
  if (/^(恭讀|選讀)/.test(l) && l.length < 60) return `<p class="rd">${esc(l)}</p>`;
  if (/^(對答詠|領：|答：)/.test(l)) return `<p>${esc(l)}</p>`;
  let cls = '';
  if (VERSE.has(ctx.k)) cls = MARK_END.test(l) ? '' : 've';
  else if (ctx.k === 'hymn') cls = /[。；！？」]\s*$/.test(l) ? 've' : '';
  else if (l.length > 34 && !MARK_END.test(l)) cls = 'prose';
  return `<p${cls ? ` class="${cls}"` : ''}>${marks(l)}</p>`;
}
// a canticle that follows the responsory in the same section (夜禱: 西默盎聖歌) is set out verse by verse
function renderLines(lines, s) {
  let ctx = { ...s, st: {} };
  return lines.map((l, i) => { if (!VERSE.has(ctx.k) && l.length < 40 && /^(西默盎|聖母謝主曲|匝加利亞)/.test(l)) ctx = { ...ctx, k: 'gospel' }; return renderLine(l, { ...ctx, prev: lines[i - 1] }); }).join('');
}
const tabs = (attr, items, cur) => `<div class="tabs" role="tablist">${items.map(([v, lab]) => `<button class="pill" role="tab" ${attr}="${v}" aria-pressed="${v === cur}">${esc(lab)}</button>`).join('')}</div>`;

// 序經: the day's antiphon with Ps 95 (default), 100, 67 or 24 — antiphon repeated after each strophe
function renderInvit(s) {
  const P = invitPsalms();
  // the day's antiphon(s): lines before the psalm; "或" separates alternatives
  const head = []; for (const l of s.lines) { if (/^聖詠/.test(l)) break; head.push(l); }
  const ants = []; let cur = null;
  for (const l of head) {
    if (/^[（(]?或[)）]?$/.test(l)) { cur = null; continue; }
    const m = l.match(/^(?:領|眾)\s*[：:]\s*(.*)$/) || l.match(/^或[：:]\s*(?:領\s*[：:]\s*)?(.*)$/);
    if (m && m[1] && !cur) { cur = m[1]; ants.push(cur); }
  }
  if (!P || !ants.length) return null;
  const ai = Math.min(S.alt['invit-ant'] || 0, ants.length - 1), ant = ants[ai];
  const ps = P[S.inv] || P['95'];
  const lab = { 95: '聖詠95', 100: '聖詠100', 67: '聖詠67', 24: '聖詠24' };
  const out = [`領：${ant}`, `眾：${ant}`];
  const body = [`§${ps.title}`, `¤${ps.epi}`];
  for (const st of ps.strophes) body.push(...st.map((l) => '¶' + l), `對經：${ant}`);
  body.push(...ps.gloria.map((l) => '¶' + l), `對經：${ant}`);
  const h = `<h2 class="sh">${esc(s.h)}${s.tag ? ` <span class="tag">${esc(s.tag)}</span>` : ''}</h2>`;
  const antTabs = ants.length > 1 ? tabs('data-alt', ants.map((a, j) => [`invit-ant:${j}`, `對經${'一二三四'[j]}`]), `invit-ant:${ai}`) : '';
  return `<section class="s-invit">${h}${antTabs}${tabs('data-inv', ['95', '100', '67', '24'].map((k) => [k, lab[k]]), S.inv)}${out.map((l) => renderLine(l, s)).join('')}${body.map((l) => l.startsWith('§') ? `<p class="ps">${esc(l.slice(1))}</p>` : l.startsWith('¶') ? `<p>${marks(l.slice(1))}</p>` : l.startsWith('¤') ? `<p class="epi">${esc(l.slice(1))}</p>` : renderLine(l, s)).join('')}</section>`;
}

function renderSection(s, hour) {
  if (hour === '2' && s.sub && s.sub !== S.sub) return '';
  if (s.k === 'invit') { const r = renderInvit(s); if (r) return r; }
  if (s.alts && s.alts.length > 1) {      // alternative texts (e.g. hymns from the commission and the three volumes)
    const key = `${hour}${s.k}`; const i = Math.min(S.alt[key] || 0, s.alts.length - 1);
    const a = s.alts[i];
    const h = `<h2 class="sh">${esc(s.h)}${a.tag ? ` <span class="tag">${esc(a.tag)}</span>` : ''}</h2>`;
    return `<section class="s-${s.k}">${h}${tabs('data-alt', s.alts.map((x, j) => [`${key}:${j}`, x.label]), `${key}:${i}`)}${renderLines(a.lines, s)}</section>`;
  }
  if (s.k === 'bio') return `<section class="bio"><h2 class="sh">${esc(s.h)}</h2>${s.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</section>`;
  let lines = s.lines;
  if (hour === '2' && s.k === 'hymn') { // three hymns for 午前/午時/午後 — show the selected one
    const blocks = []; let cur = null;
    for (const l of lines) { if (l.startsWith('§')) { cur = { h: l.slice(1), l: [] }; blocks.push(cur); } else if (cur) cur.l.push(l); else blocks.push(cur = { h: '', l: [l] }); }
    const pick = blocks.find((b) => b.h.startsWith(S.sub)) || blocks[0];
    lines = pick ? pick.l : lines;
  }
  const h = s.h && !/^(午前|午時|午後)/.test(s.h) ? `<h2 class="sh">${esc(s.h)}${s.tag ? ` <span class="tag">${esc(s.tag)}</span>` : ''}</h2>` : '';
  return `<section class="s-${s.k}">${h}${renderLines(lines, s)}</section>`;
}

function renderCelebs(info) {
  const d = fromIso(S.date);
  const tp = info.L.temporal;
  const el = $('#celebs');
  const parts = [`<div class="day">${info.L.primary.source === 'santoral' && tp.title ? tp.title : WD[d.getUTCDay()]}${tp.psalter ? `・聖詠集第${'一二三四'[tp.psalter - 1]}周` : ''}・主日${info.L.cycles.sunday}年・平日${info.L.cycles.weekday}年</div>`];
  // the day's celebration as a heading (rank after it); when there is a choice, the options as a short list
  const cur = S.choice[S.date] || '';
  const labOf = (c) => (c.kind === 'commemoration' ? '紀念' : c.kind === 'optional' ? '自由紀念' : ({ solemnity: '節日', feast: '慶日', memorial: '紀念' }[c.rank] || '平日'));
  const sel = info.choices.find((c) => c.id === cur) || info.choices[0];
  const selLab = labOf(sel) !== '平日' || info.choices.length > 1 ? labOf(sel) : '';
  parts.push(`<h1 class="cel">${esc(sel.title)}${selLab ? `<span class="rank">${selLab}</span>` : ''}</h1>`);
  if (info.choices.length > 1) {
    parts.push(`<div class="opts" role="radiogroup" aria-label="今日可選"><div class="opts-lab">今日可選：</div>${info.choices.map((c) =>
      `<button class="opt" role="radio" data-c="${c.id}" aria-checked="${c.id === cur}"><span class="dot" aria-hidden="true">${c.id === cur ? '◉' : '○'}</span><span>${esc(c.title)} <small>${labOf(c)}</small></span></button>`).join('')}</div>`);
  }
  el.innerHTML = parts.join('');
  el.querySelectorAll('button.opt').forEach((b) => b.onclick = () => { S.choice[S.date] = b.dataset.c; store.set('mass.' + S.date, null); render(); });
}

function render() {
  stopTTS();   // new text on screen: stop reading
  const info = dayInfo(S.date);
  if (!info.choices.some((c) => c.id === (S.choice[S.date] || ''))) S.choice[S.date] = '';
  const [y, m, d] = S.date.split('-').map(Number);
  $('#dateLabel').textContent = `${y}年${m}月${d}日`;
  $('#datePick').value = S.date;
  const book = BOOK_OF(S.hour);
  $('#books').innerHTML = BOOKS.map((b) => `<button role="tab" data-b="${b.id}" aria-selected="${b.id === book}">${b.name}</button>`).join('');
  $('#books').querySelectorAll('button').forEach((b) => b.onclick = () => { S.hour = b.dataset.b === 'h' ? (S.lastHour || defaultHour()) : b.dataset.b; render(); window.scrollTo(0, 0); });
  $('#celebs').style.display = book === 'b' || book === 'r' ? 'none' : '';
  $('.bar').classList.toggle('nodate', book === 'b' || book === 'r');
  if (book !== 'h') { $('#hours').innerHTML = ''; $('#hours').style.display = 'none'; if (book === 'm') renderCelebs(info); renderBook(book, info); setHash(); return; }
  $('#hours').style.display = ''; S.lastHour = S.hour;
  renderCelebs(info);
  $('#hours').innerHTML = HOURS.map((h) => `<button role="tab" data-h="${h.n}" aria-selected="${h.n === S.hour}">${h.short}</button>`).join('');
  $('#hours').querySelectorAll('button').forEach((b) => b.onclick = () => { S.hour = b.dataset.h; render(); window.scrollTo(0, 0); });
  const r = office(S.date, S.hour, S.choice[S.date] || '');
  // the date and the day's celebration are already shown above; the heading names the hour only
  // (on the eve of a solemnity or Sunday it also names the celebration whose First Vespers/Compline this is)
  const hourName = HOURS.find((h) => h.n === S.hour).name;
  const fv = /第一(晚禱|夜禱)/.test(r.title);
  const head = fv ? r.title.replace(/^[^　\s]*月[^　\s]*日[　\s]*/, '').replace(/（聖詠集[^）]*）/g, '').trim() : hourName;
  let html = fv ? `<h1>${esc(head)}</h1>` : '';   // the hour itself is already the selected tab
  if (r.notes.length) html += `<div class="notes">${r.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>`;
  // the invitatory opens the day's prayer (GILH 35); wording of the rubric after 《每日頌禱》:「如念序經，則省去此開端詞」
  if (S.hour === '4' || S.hour === '1') html += `<p class="rub firsthour">如本時辰是一日的第一個祈禱，先念<a href="#" data-goto="0">序經</a>；如念序經，則省去此開端詞。</p>`;
  if (S.hour === '2') html += `<div class="subsel">${['午前', '午時', '午後'].map((x) => `<button class="pill" data-sub="${x}" aria-pressed="${x === S.sub}">${x}</button>`).join('')}</div>`;
  html += r.sections.length ? r.sections.map((s) => renderSection(s, S.hour)).join('') : `<p class="empty">此日日課尚未收錄。</p>`;
  $('#office').innerHTML = html;
  $('#office').querySelectorAll('[data-goto]').forEach((a) => a.onclick = (e) => { e.preventDefault(); S.hour = a.dataset.goto; render(); window.scrollTo(0, 0); });
  $('#office').querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { S.sub = b.dataset.sub; store.set('sub', S.sub); render(); });
  $('#office').querySelectorAll('[data-inv]').forEach((b) => b.onclick = () => { S.inv = b.dataset.inv; store.set('inv', S.inv); render(); });
  $('#office').querySelectorAll('[data-alt]').forEach((b) => b.onclick = () => { const [k, i] = b.dataset.alt.split(':'); S.alt[k] = +i; store.set('alt', S.alt); render(); });
  setHash();
  const cal = currentCalendar();
  if (cal === 'tw') retext('#office h1, #celebs', /周/g, '週');            // 台灣用「週」
  if (cal !== 'hk' && cal !== 'mo') retext('#office', /亞孟/g, '阿門');      // 港澳用「亞孟」，其他用「阿門」
  zh($('header') || document.body); zh($('#office')); zh($('#celebs') || document.body);
}

// ---------- 彌撒 / 祝福禮典 / 聖事禮典 ----------
const BOOKS = [{ id: 'h', name: '時辰頌禱' }, { id: 'm', name: '彌撒' }, { id: 'b', name: '祝福禮典' }, { id: 'r', name: '聖事禮典' }];
const BOOK_OF = (h) => (['m', 'b', 'r'].includes(h) ? h : 'h');
async function renderBook(book, info) {
  const el = $('#office');
  if (book === 'b' || book === 'r') {
    el.innerHTML = book === 'b'
      ? `<h1>祝福禮典</h1><div class="notes"><p>籌備中。來源：《祝福禮典》（中國主教團禮儀委員會編譯，1984年拉丁文版），共391頁，正在整理文字。</p></div><p>將收錄：祝福家庭及其成員、病人、傳教士、教理講授員、旅行者；祝福房屋、學校、醫院、車輛、工具；祝福宗教物品、聖像、念珠、聖衣；祝福聖堂設施、鐘、管風琴；節慶祝福等。每項儀式可按主禮身分（司鐸、執事、平信徒）顯示相應經文。</p>`
      : `<h1>聖事禮典</h1><div class="notes"><p>籌備中，來源仍在搜集。</p></div><p>將收錄：聖洗聖事（成人、兒童）、堅振聖事、婚姻聖事、修和聖事、病人傅油及臨終聖體、殯葬禮。在彌撒中舉行的禮儀，可直接加入「彌撒」的經文編排。</p>`;
    zh(el); return;
  }
  if (!missalLoaded()) { el.innerHTML = '<p class="loading">載入彌撒經文…</p>'; try { await loadMissal(); } catch (e) { el.innerHTML = '<p class="empty">未能載入彌撒經文。</p>'; return; } if (BOOK_OF(S.hour) !== 'm') return; }
  const list = massesFor(info, S.choice[S.date] || '');
  if (!list.list.length) { el.innerHTML = '<p class="empty">此日彌撒經文尚未收錄。</p>'; return; }
  const saved = store.get('mass.' + S.date, null);
  const all = [...list.list, ...list.more];
  const cur = (saved && all.find((m) => m.id === saved.mass)) || list.list[0];
  const def = massDefaults(info, cur, S.date);
  const st = saved && saved.mass === cur.id ? { ...def, ...saved } : { ...def, mass: cur.id };
  const save = () => store.set('mass.' + S.date, st);
  el.innerHTML = `${list.list.length > 1 || cur !== list.list[0] ? `<h1 class="mtitle">${esc(cur.label)}</h1>` : ''}${optionsPanel(info, list, cur, st, S.date)}<div class="mass">${massHtml(info, cur, st, S.date)}</div>`;
  el.querySelectorAll('select[data-ms]').forEach((x) => x.onchange = () => {
    const k = x.dataset.ms, v = x.value;
    if (k === 'mass') { store.set('mass.' + S.date, { mass: v }); render(); return; }
    if (k === 'gloria' || k === 'dead') st[k] = v === '1';
    else if (k === 'ep' || k === 'bless') st[k] = v;
    else if (k === 'pf') st.pf = (v === 'p' || v === 'ep2') ? v : +v;
    else st[k] = +v;
    if (k === 'ep' && v !== 'II' && st.pf === 'ep2') st.pf = massDefaults(info, cur, S.date).pf;
    save(); const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  const pan = el.querySelector('details.mpanel');
  if (pan) pan.addEventListener('toggle', () => { store.set('massPanelClosed', !pan.open); });
  if (pan && store.get('massPanelClosed', false)) pan.open = false;
  el.querySelectorAll('button[data-m]').forEach((b) => b.onclick = () => {
    const [k, a, c] = b.dataset.m.split(':');
    if (k === 'reset') { store.set('mass.' + S.date, null); render(); return; }
    if (k === 'print') { window.print(); return; }
    if (k === 'rs') { st.rs = +a; st.alt = {}; }
    if (k === 'alt') { st.alt = { ...(st.alt || {}), [a]: +c }; }
    save(); const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  const cal = currentCalendar();
  if (cal !== 'hk' && cal !== 'mo') retext('#office', /亞孟/g, '阿門');
  zh(el); zh($('#celebs'));
}

function retext(sel, re, to) {
  for (const e of document.querySelectorAll(sel)) {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, to); }
    re.lastIndex = 0;
  }
}

function shift(n) { const d = fromIso(S.date); S.date = iso(new Date(d.getTime() + n * 864e5)); render(); window.scrollTo(0, 0); }

function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--fs', store.get('fs', 19) + 'px');
  const th = store.get('theme', null); if (th) root.dataset.theme = th; else delete root.dataset.theme;
  document.body.classList.toggle('norubrics', !store.get('rubrics', true));
  $('#rubrics').checked = store.get('rubrics', true);
  if ($('#showWelcome')) $('#showWelcome').checked = !store.get('skipWelcome', false);
  document.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.theme === (th || '')));
  document.querySelectorAll('[data-script]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.script === store.get('script', 't')));
  const ft = store.get('font', 'ming'); if (ft === 'ming') delete root.dataset.font; else root.dataset.font = ft;
  document.querySelectorAll('[data-font]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.font === ft));
}
function renderCalendars() {
  const el = $('#calendars'); if (!el) return;
  const order = ['general', 'hk', 'mo', 'tw'];
  el.innerHTML = calendarList().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map((c) => `<button class="pill" data-cal="${c.id}" aria-pressed="${c.id === currentCalendar()}">${esc(c.name)}</button>`).join('');
  el.querySelectorAll('[data-cal]').forEach((b) => b.onclick = () => { store.set('cal', b.dataset.cal); setCalendar(b.dataset.cal); renderCalendars(); render(); });
  zh(el);
}

async function main() {
  parseHash();
  applyPrefs();
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  $('#today').onclick = () => { S.date = hkToday(); if (BOOK_OF(S.hour) === 'h') S.hour = defaultHour(); render(); };
  $('#datePick').onchange = (e) => { if (e.target.value) { S.date = e.target.value; render(); } };
  $('#menuBtn').onclick = () => { $('#settings').hidden = false; };
  $('#closeSettings').onclick = () => { $('#settings').hidden = true; };
  $('#settings').onclick = (e) => { if (e.target.id === 'settings') $('#settings').hidden = true; };
  document.querySelectorAll('[data-fs]').forEach((b) => b.onclick = () => { store.set('fs', Math.max(14, Math.min(30, store.get('fs', 19) + Number(b.dataset.fs)))); applyPrefs(); });
  document.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => { store.set('theme', b.dataset.theme); applyPrefs(); });
  document.querySelectorAll('[data-font]').forEach((b) => b.onclick = () => { store.set('font', b.dataset.font); applyPrefs(); });
  $('#showWelcome').onchange = (e) => { store.set('skipWelcome', !e.target.checked); };
  $('#rubrics').onchange = (e) => { store.set('rubrics', e.target.checked); applyPrefs(); };
  document.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; if (e.key === 'ArrowLeft') shift(-1); if (e.key === 'ArrowRight') shift(1); });
  window.addEventListener('hashchange', () => { parseHash(); render(); });
  document.querySelectorAll('[data-script]').forEach((b) => b.onclick = async () => {
    const was = store.get('script', 't'); store.set('script', b.dataset.script); applyPrefs();
    if (was === b.dataset.script) return;
    if (b.dataset.script === 't') { location.reload(); return; }   // back to 繁體: reload the original text
    await loadT2S(); zh(); });
  initTTS(store);
  // welcome screen: stays until the reader has chosen 繁體／简体 (if wished) and taps 進入
  // (with 「記住我的選擇」 it is not shown again; 設定 › 啟動時顯示歡迎畫面 turns it back on)
  const W = $('#welcome');
  const closeWelcome = () => { if (!W || W.hidden) return; store.set('welcomed', true); W.classList.add('out'); setTimeout(() => { W.hidden = true; }, 400); };
  if (store.get('skipWelcome', false)) W.hidden = true;
  $('#welcomeGo').onclick = () => { if ($('#welcomeSkip').checked) { store.set('skipWelcome', true); applyPrefs(); } closeWelcome(); };
  await Promise.all([loadData(), loadT2S()]);
  setCalendar(store.get('cal', 'hk'));
  renderCalendars();
  zh();
  const { first, last } = nearestArchiveDate();
  $('#coverage').textContent = `版本 ${APP_VERSION}`;
  render();
  if (navigator.serviceWorker && navigator.serviceWorker.register && location.protocol !== 'file:') try {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) { $('#update').hidden = false; $('#updateBtn').onclick = () => w.postMessage('skip'); } }); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) navigator.serviceWorker.getRegistration().then((r) => r && r.update()); });
  } catch (e) { /* offline caching unavailable in this browser */ }
}
main();

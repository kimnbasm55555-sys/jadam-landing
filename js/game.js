/* 고객 게임 — 식사하신 손님께 드리는 사은품 뽑기
   게임 1 : 원판 돌리기 (룰렛)
   게임 2 : 10초 맞추기

   · 점주가 그날 상품 이름과 수량을 적고 연다. 손님이 직접 누른다.
   · 수량은 뽑힐 때마다 줄고, 다 나가면 그 상품은 원판에서 빠진다.
   · 하루 기준은 영업일이다. 새벽 6시 전은 전날로 친다 (술집 · 야간 매장).
   · 손님 정보는 받지 않는다. 화면에서 뽑고 끝난다.
   · 기록은 store_games 표에 남긴다. 표가 아직 없으면 이 기기에만 저장한다. */

import { db } from "../db.js";
import { S } from "./state.js";
import { toast } from "./ui.js";

const MAX_ITEMS = 6;
const LEVELS = {
  easy:   { name: '쉬움',   speed: 0.6, desc: '숫자가 천천히 올라가요' },
  normal: { name: '보통',   speed: 0.8, desc: '조금 느리게 올라가요' },
  hard:   { name: '어려움', speed: 1.0, desc: '실제 시계와 같은 빠르기예요' }
};
const NEAR = 0.10;                      /* 2등 범위 : 10.00 에서 ±0.10초 */
const COLORS = ['#FF4F6E', '#FF9F1C', '#FFD60A', '#2EC27E', '#2D9CFF', '#8E5BFF'];
const INK    = ['#FFFFFF', '#3A1E00', '#3A2A00', '#FFFFFF', '#FFFFFF', '#FFFFFF'];

let ROOT = null, CFG = null, DAY = '', LOCAL_ONLY = false;
let VIEW = 'setup', offGuard = null, wake = null;
let DRAFT = [];                         /* 설정 화면에서 고치는 중인 상품 줄 (저장 전) */

/* ───────── 공통 ───────── */
function esc(t){
  return String(t == null ? '' : t).replace(/[<>&"]/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c]));
}
function bizDay(){
  const d = new Date(Date.now() - 6 * 3600 * 1000);       /* 새벽 6시 전은 전날 */
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dayLabel(s){
  const a = s.split('-');
  const w = '일월화수목금토'[new Date(+a[0], +a[1] - 1, +a[2]).getDay()];
  return (+a[1]) + '월 ' + (+a[2]) + '일 (' + w + ')';
}
function rnd(n){                         /* 0 이상 n 미만의 고른 난수 */
  const b = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do{ crypto.getRandomValues(b); }while(b[0] >= lim);
  return b[0] % n;
}
function blank(){
  return {
    notice: '',
    roulette: { items: [{ name: '3,000원 할인권', qty: 10, left: 10 }], lose: { qty: 0, left: 0 } },
    timer: { level: 'normal', p1: { name: '', qty: 0, left: 0 }, p2: { name: '', qty: 0, left: 0 } },
    log: []
  };
}
function lsKey(day){ return 'bn_game_' + (S.store ? S.store.id : 'x') + '_' + day; }

/* ───────── 저장 · 불러오기 ───────── */
async function load(){
  DAY = bizDay();
  CFG = null; LOCAL_ONLY = false;
  try{
    const { data, error } = await db.from('store_games')
      .select('play_date, config').eq('store_id', S.store.id)
      .order('play_date', { ascending: false }).limit(1);
    if(error) throw error;
    const row = data && data[0];
    if(row && row.play_date === DAY) CFG = row.config;
    else if(row) CFG = carry(row.config);                 /* 어제 상품 이름을 그대로 가져온다 */
  }catch(e){
    LOCAL_ONLY = true;
    try{
      const t = localStorage.getItem(lsKey(DAY));
      if(t) CFG = JSON.parse(t);
      else{
        const last = localStorage.getItem('bn_game_last_' + (S.store ? S.store.id : 'x'));
        if(last) CFG = carry(JSON.parse(last));
      }
    }catch(e2){}
  }
  if(!CFG){ CFG = blank(); CFG.fresh = true; }
  fix(CFG);
}
/* 전날 설정에서 이름·수량만 가져오고 남은 수량은 새로 채운다 */
function carry(old){
  const c = blank();
  try{
    fix(old);
    c.roulette.items = old.roulette.items.map(it => ({ name: it.name, qty: it.qty, left: it.qty }));
    c.roulette.lose = { qty: old.roulette.lose.qty, left: old.roulette.lose.qty };
    c.timer.level = old.timer.level;
    c.timer.p1 = { name: old.timer.p1.name, qty: old.timer.p1.qty, left: old.timer.p1.qty };
    c.timer.p2 = { name: old.timer.p2.name, qty: old.timer.p2.qty, left: old.timer.p2.qty };
    c.notice = old.notice || '';
    c.fresh = true;                                        /* 아직 오늘 저장 전 */
  }catch(e){}
  return c;
}
function fix(c){
  const b = blank();
  if(typeof c.notice !== 'string') c.notice = '';
  if(!c.roulette) c.roulette = b.roulette;
  if(!Array.isArray(c.roulette.items) || !c.roulette.items.length) c.roulette.items = b.roulette.items;
  if(!c.roulette.lose) c.roulette.lose = b.roulette.lose;
  if(!c.timer) c.timer = b.timer;
  if(!LEVELS[c.timer.level]) c.timer.level = 'normal';
  if(!c.timer.p1) c.timer.p1 = b.timer.p1;
  if(!c.timer.p2) c.timer.p2 = b.timer.p2;
  if(!Array.isArray(c.log)) c.log = [];
}
async function save(){
  delete CFG.fresh;
  try{
    localStorage.setItem(lsKey(DAY), JSON.stringify(CFG));
    localStorage.setItem('bn_game_last_' + S.store.id, JSON.stringify(CFG));
  }catch(e){}
  if(LOCAL_ONLY) return true;
  try{
    const { error } = await db.from('store_games').upsert(
      { store_id: S.store.id, play_date: DAY, config: CFG, updated_at: new Date().toISOString() },
      { onConflict: 'store_id,play_date' });
    if(error) throw error;
    return true;
  }catch(e){
    LOCAL_ONLY = true;
    return false;
  }
}
function addLog(game, prize){
  const d = new Date();
  CFG.log.unshift({
    t: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    g: game, p: prize
  });
  if(CFG.log.length > 200) CFG.log.length = 200;
}

/* ───────── 열기 · 닫기 ───────── */
export async function openGame(){
  if(!S.store) return;
  injectCss();
  if(ROOT) ROOT.remove();
  ROOT = document.createElement('div');
  ROOT.id = 'bn-game';
  ROOT.innerHTML = '<div class="gm-load">불러오는 중이에요.</div>';
  document.body.appendChild(ROOT);
  document.body.style.overflow = 'hidden';

  try{ history.pushState({ bnGame: 1 }, ''); }catch(e){}
  const onPop = function(e){
    e.stopImmediatePropagation();
    if(VIEW !== 'setup'){                                  /* 게임 중 뒤로가기 → 설정으로 */
      try{ history.pushState({ bnGame: 1 }, ''); }catch(e2){}
      showSetup();
      return;
    }
    window.removeEventListener('popstate', onPop, true);
    offGuard = null;
    close(true);
  };
  window.addEventListener('popstate', onPop, true);
  offGuard = function(){ window.removeEventListener('popstate', onPop, true); };

  await load();
  showSetup();
}
function close(fromBack){
  if(offGuard){ offGuard(); offGuard = null; }
  releaseWake();
  if(ROOT){ ROOT.remove(); ROOT = null; }
  document.body.style.overflow = '';
  VIEW = 'setup';
  if(!fromBack){ window.__bnIgnorePop = true; try{ history.back(); }catch(e){} }
}
async function keepAwake(){
  try{ if(navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); }catch(e){}
}
function releaseWake(){
  try{ if(wake) wake.release(); }catch(e){}
  wake = null;
}

/* ───────── 설정 화면 (점주) ───────── */
function showSetup(){
  VIEW = 'setup';
  releaseWake();
  const r = CFG.roulette, t = CFG.timer;
  const started = !CFG.fresh && (CFG.log.length > 0 || r.items.some(it => it.qty > 0));

  ROOT.className = 'gm-setup';
  ROOT.innerHTML = `
  <div class="gm-hd">
    <span class="gm-bk" id="gm-x">‹</span>
    <span class="gm-tt">고객 게임</span>
    <span class="gm-day">${dayLabel(DAY)}</span>
  </div>
  <div class="gm-body">
    <div class="gm-why">
      <b>식사하신 손님께 드리는 작은 재미입니다.</b>
      계산을 기다리는 동안 손님이 직접 눌러 사은품을 뽑습니다.
      오늘 드릴 상품과 수량을 적고 게임을 열어 주세요.
      당첨 화면이 나오면 직원이 확인하고 상품을 드립니다.
      <span>화면이 큰 태블릿을 계산대에 세워 두고 쓰시기를 권합니다. 개인정보 및 전화번호는 취합하지 않습니다.</span>
    </div>
    ${LOCAL_ONLY ? '<div class="gm-warn">지금은 이 기기에만 저장됩니다. 다른 기기에서는 오늘 수량이 보이지 않아요.</div>' : ''}

    <div class="gm-sec">
      <div class="gm-st">손님에게 보이는 안내</div>
      <div class="gm-cap">게임 화면 맨 위에 크게 나옵니다. 참여 조건을 적어 주세요. 비워 두면 나오지 않습니다.</div>
      <textarea id="gm-notice" class="gm-ta" maxlength="120" rows="3"
        placeholder="예) 2만원 이상 구매하신 고객님은 룰렛 게임에 참여하실 수 있습니다. 선정된 상품을 드리니 점주에게 말씀해 주세요.">${esc(CFG.notice)}</textarea>
    </div>

    <div class="gm-sec">
      <div class="gm-st"><i>게임 1</i>원판 돌리기</div>
      <div class="gm-cap">3,000원 할인권 10장이 기본으로 들어 있습니다. 이름과 수량은 자유롭게 고치세요. 수량이 많은 상품일수록 잘 나오고, 최대 ${MAX_ITEMS}가지입니다. 남은 수량은 손님 화면에 보이지 않습니다.</div>
      <div class="gm-rowh"><span>상품 이름</span><span>수량</span><span>남음</span></div>
      <div id="gm-items"></div>
      <button class="gm-add" id="gm-add">+ 상품 추가</button>
      <div class="gm-row gm-lose">
        <div class="gm-nm">꽝 (다음 기회에)</div>
        <input id="gm-lose" type="number" inputmode="numeric" min="0" value="${r.lose.qty || ''}" placeholder="0">
        <div class="gm-left">${started ? r.lose.left : '—'}</div>
      </div>
      <div class="gm-odds" id="gm-odds"></div>
      <button class="gm-go" id="gm-open1">저장하고 원판 돌리기 열기</button>
    </div>

    <div class="gm-sec">
      <div class="gm-st"><i>게임 2</i>10초 맞추기</div>
      <div class="gm-cap">손님이 버튼을 눌러 시작하고, 10.00초에 다시 눌러 멈춥니다.</div>
      <div class="gm-lv" id="gm-lv">
        ${Object.keys(LEVELS).map(k => `<button data-k="${k}" class="${t.level === k ? 'on' : ''}">
          <b>${LEVELS[k].name}</b><span>${LEVELS[k].desc}</span></button>`).join('')}
      </div>
      <div class="gm-rowh"><span>상품 이름</span><span>수량</span><span>남음</span></div>
      <div class="gm-row">
        <input id="gm-p1n" maxlength="14" placeholder="1등 · 정확히 10.00초" value="${esc(t.p1.name)}">
        <input id="gm-p1q" type="number" inputmode="numeric" min="0" value="${t.p1.qty || ''}" placeholder="0">
        <div class="gm-left">${started ? t.p1.left : '—'}</div>
      </div>
      <div class="gm-row">
        <input id="gm-p2n" maxlength="14" placeholder="2등 · 9.90~10.10초 (비워도 됩니다)" value="${esc(t.p2.name)}">
        <input id="gm-p2q" type="number" inputmode="numeric" min="0" value="${t.p2.qty || ''}" placeholder="0">
        <div class="gm-left">${started ? t.p2.left : '—'}</div>
      </div>
      <button class="gm-go" id="gm-open2">저장하고 10초 맞추기 열기</button>
    </div>

    <div class="gm-sec">
      <div class="gm-st">오늘 나간 상품 <em>${CFG.log.filter(x => x.p).length}건</em></div>
      <div class="gm-log">${CFG.log.filter(x => x.p).length
        ? CFG.log.filter(x => x.p).slice(0, 30).map(x =>
            `<div><span>${esc(x.t)}</span><span>${x.g === 'r' ? '원판' : '10초'}</span><b>${esc(x.p)}</b></div>`).join('')
        : '<p>아직 나간 상품이 없어요.</p>'}</div>
    </div>
    <div class="gm-foot">게임 화면에서 나올 때는 왼쪽 위 「닫기」를 길게 눌러 주세요. 손님이 실수로 나가지 않게 한 것입니다.</div>
  </div>`;

  DRAFT = r.items.map(it => ({ name: it.name, qty: it.qty }));
  drawItems(started);
  ROOT.querySelector('#gm-x').onclick = function(){ close(); };
  ROOT.querySelector('#gm-add').onclick = function(){
    readForm();
    if(DRAFT.length >= MAX_ITEMS){ toast('상품은 ' + MAX_ITEMS + '가지까지 넣을 수 있어요'); return; }
    DRAFT.push({ name: '', qty: 0 });
    drawItems(started);
  };
  ROOT.querySelector('#gm-lose').oninput = showOdds;
  ROOT.querySelectorAll('#gm-lv button').forEach(function(b){
    b.onclick = function(){
      ROOT.querySelectorAll('#gm-lv button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    };
  });
  ROOT.querySelector('#gm-open1').onclick = async function(){
    if(!applyForm()) return;
    if(!CFG.roulette.items.some(it => it.left > 0)){ toast('상품 이름과 수량을 하나 이상 적어 주세요'); return; }
    const ok = await save();
    if(!ok) toast('이 기기에만 저장했어요');
    showRoulette();
  };
  ROOT.querySelector('#gm-open2').onclick = async function(){
    if(!applyForm()) return;
    if(!(CFG.timer.p1.left > 0) && !(CFG.timer.p2.left > 0)){ toast('10초 게임 상품과 수량을 적어 주세요'); return; }
    const ok = await save();
    if(!ok) toast('이 기기에만 저장했어요');
    showTimer();
  };
  showOdds();
}

function drawItems(started){
  const host = ROOT.querySelector('#gm-items');
  host.innerHTML = DRAFT.map(function(it, i){
    const saved = savedItem(it.name);
    return `<div class="gm-row" data-i="${i}">
      <input class="gm-in-n" maxlength="14" placeholder="예: 음료 1캔" value="${esc(it.name)}">
      <input class="gm-in-q" type="number" inputmode="numeric" min="0" value="${it.qty || ''}" placeholder="0">
      <div class="gm-left">${started && saved ? saved.left : '—'}</div>
    </div>`;
  }).join('');
  host.querySelectorAll('input').forEach(el => { el.oninput = showOdds; });
}
function num(v){ const n = parseInt(v, 10); return isFinite(n) && n > 0 ? Math.min(n, 9999) : 0; }
/* 이미 저장된 오늘 상품 중 같은 이름을 찾는다 */
function savedItem(name){
  if(CFG.fresh || !name) return null;
  return CFG.roulette.items.find(it => it.name === name) || null;
}

/* 화면에 적힌 값을 읽기만 한다 (저장된 수량은 건드리지 않는다) */
function readForm(){
  DRAFT = [];
  ROOT.querySelectorAll('#gm-items .gm-row').forEach(function(el){
    DRAFT.push({ name: el.querySelector('.gm-in-n').value.trim(), qty: num(el.querySelector('.gm-in-q').value) });
  });
  return DRAFT;
}
/* 저장 직전에 반영한다.
   오늘 이미 쓰던 상품이면 수량을 늘리거나 줄인 만큼만 남은 수량을 움직이고,
   새 상품이면 적은 수량이 그대로 남은 수량이 된다. */
function applyForm(){
  const fresh = !!CFG.fresh;
  const rows = readForm().filter(it => it.name || it.qty);
  const names = {};
  for(const it of rows){
    if(!it.name){ toast('수량만 적힌 줄이 있어요. 상품 이름을 적어 주세요'); return false; }
    if(names[it.name]){ toast('같은 이름의 상품이 두 번 있어요'); return false; }
    names[it.name] = 1;
  }
  const next = rows.map(function(it){
    const old = savedItem(it.name);
    const left = old ? Math.max(0, old.left + (it.qty - old.qty)) : it.qty;
    return { name: it.name, qty: it.qty, left: Math.min(left, it.qty) };
  });
  CFG.roulette.items = next.length ? next : [{ name: '', qty: 0, left: 0 }];

  const move = function(obj, qty, name){
    const same = !fresh && (name === undefined || name === obj.name);
    const left = same ? Math.max(0, obj.left + (qty - obj.qty)) : qty;
    obj.qty = qty; obj.left = Math.min(left, qty);
    if(name !== undefined) obj.name = name;
  };
  move(CFG.roulette.lose, num(ROOT.querySelector('#gm-lose').value));
  move(CFG.timer.p1, num(ROOT.querySelector('#gm-p1q').value), ROOT.querySelector('#gm-p1n').value.trim());
  move(CFG.timer.p2, num(ROOT.querySelector('#gm-p2q').value), ROOT.querySelector('#gm-p2n').value.trim());
  if(!CFG.timer.p1.name){ CFG.timer.p1.qty = 0; CFG.timer.p1.left = 0; }
  if(!CFG.timer.p2.name){ CFG.timer.p2.qty = 0; CFG.timer.p2.left = 0; }
  const on = ROOT.querySelector('#gm-lv button.on');
  if(on) CFG.timer.level = on.dataset.k;
  CFG.notice = ROOT.querySelector('#gm-notice').value.replace(/\s+/g, ' ').trim();
  return true;
}
function showOdds(){
  const el = ROOT.querySelector('#gm-odds');
  if(!el) return;
  let win = 0;
  ROOT.querySelectorAll('#gm-items .gm-row').forEach(function(r){
    if(r.querySelector('.gm-in-n').value.trim()) win += num(r.querySelector('.gm-in-q').value);
  });
  const lose = num(ROOT.querySelector('#gm-lose').value);
  if(!win){ el.textContent = ''; return; }
  const pct = Math.round(win / (win + lose) * 100);
  el.textContent = lose
    ? '적은 수량 기준으로 손님 ' + (win + lose) + '명 중 ' + win + '명이 당첨됩니다. 당첨 확률은 약 ' + pct + '%입니다.'
    : '꽝이 없어서 돌리는 손님 모두 상품을 받습니다. 상품은 ' + win + '개입니다.';
}

/* ───────── 게임 화면 공통 틀 ───────── */
function playShell(title, sub, inner){
  ROOT.className = 'gm-play';
  ROOT.innerHTML = `
    ${sparkles()}
    <div class="gm-ptop">
      <button class="gm-hold" id="gm-hold"><span></span>닫기</button>
      <div class="gm-store">${esc(S.store.name || '')}</div>
    </div>
    ${CFG.notice ? '<div class="gm-notice">' + esc(CFG.notice) + '</div>' : ''}
    <div class="gm-ptitle">${title}</div>
    <div class="gm-psub">${sub}</div>
    ${inner}
    <div class="gm-priv">개인정보 및 전화번호는 취합하지 않습니다.</div>
    <div class="gm-pop" id="gm-pop"></div>`;
  /* 길게 눌러야 닫힌다 */
  const h = ROOT.querySelector('#gm-hold');
  let tm = null;
  const down = function(e){
    e.preventDefault();
    h.classList.add('ing');
    tm = setTimeout(function(){ h.classList.remove('ing'); showSetup(); }, 1200);
  };
  const up = function(){
    if(tm){ clearTimeout(tm); tm = null; }
    if(h.classList.contains('ing')){ h.classList.remove('ing'); toast('길게 누르면 닫혀요'); }
  };
  h.addEventListener('pointerdown', down);
  h.addEventListener('pointerup', up);
  h.addEventListener('pointerleave', up);
  h.addEventListener('pointercancel', up);
  keepAwake();
}
function popup(kind, head, body, btn, after){
  const p = ROOT.querySelector('#gm-pop');
  p.className = 'gm-pop on ' + kind;
  p.innerHTML = `<div class="gm-card">
      <div class="gm-ph">${head}</div>
      <div class="gm-pb">${body}</div>
      <button class="gm-pbtn">${btn}</button>
    </div>` + (kind === 'win' ? confetti() : '');
  p.querySelector('.gm-pbtn').onclick = function(){
    p.className = 'gm-pop'; p.innerHTML = '';
    if(after) after();
  };
}
/* 배경에서 반짝이는 별 */
function sparkles(){
  const cs = ['#FF5E7E', '#FFB13D', '#FFE94A', '#5BE584', '#4FC3FF', '#B07CFF', '#FFFFFF'];
  let h = '<div class="gm-sky">';
  for(let i = 0; i < 46; i++){
    const z = 6 + rnd(16);
    h += '<i style="left:' + rnd(100) + '%;top:' + rnd(100) + '%;width:' + z + 'px;height:' + z
       + 'px;color:' + cs[i % cs.length] + ';animation-delay:' + (rnd(3000) / 1000) + 's;animation-duration:'
       + (1.2 + rnd(1800) / 1000) + 's"></i>';
  }
  return h + '</div>';
}
/* 원판 둘레에서 번갈아 깜박이는 전구 */
function bulbs(){
  let h = '';
  for(let i = 0; i < 24; i++){
    const t = i * Math.PI * 2 / 24;
    h += '<b class="gm-bulb' + (i % 2 ? ' b2' : '') + '" style="left:' + (50 + Math.cos(t) * 47.7).toFixed(2)
       + '%;top:' + (50 + Math.sin(t) * 47.7).toFixed(2) + '%;animation-delay:' + ((i % 6) * 0.12).toFixed(2) + 's"></b>';
  }
  return h;
}
function confetti(){
  const cs = ['#FF5E7E', '#FFB13D', '#FFE94A', '#5BE584', '#4FC3FF', '#B07CFF', '#FFFFFF'];
  let h = '<div class="gm-conf">';
  for(let i = 0; i < 110; i++){
    h += '<i style="left:' + rnd(100) + '%;background:' + cs[i % cs.length]
       + ';animation-delay:' + (rnd(900) / 1000) + 's;animation-duration:' + (2.2 + rnd(1600) / 1000)
       + 's;transform:rotate(' + rnd(360) + 'deg)"></i>';
  }
  return h + '</div>';
}

/* ───────── 게임 1 : 원판 돌리기 ───────── */
let ROT = 0, SPINNING = false, SLICES = [];

function buildSlices(){
  const live = CFG.roulette.items.map((it, i) => ({ k: i, name: it.name, left: it.left })).filter(x => x.left > 0);
  const lose = CFG.roulette.lose.left > 0;
  let base = [];
  live.forEach(function(p){
    base.push({ k: p.k, name: p.name });
    if(lose) base.push({ k: -1, name: '꽝' });
  });
  if(!base.length) return [];
  let out = base.slice();
  const min = lose ? 6 : 4;
  while(out.length < min) out = out.concat(base);
  return out;
}
function drawWheel(){
  const cv = ROOT.querySelector('#gm-wheel');
  if(!cv) return;
  const N = SLICES.length, W = 1000, R = W / 2, ctx = cv.getContext('2d');
  cv.width = W; cv.height = W;
  ctx.clearRect(0, 0, W, W);
  const a = Math.PI * 2 / N;
  const prizeN = SLICES.filter(s => s.k >= 0).length;
  let pc = 0;
  for(let i = 0; i < N; i++){
    const s = SLICES[i];
    const st = -Math.PI / 2 + i * a;
    let fill, ink;
    if(s.k < 0){ fill = '#33215A'; ink = '#BFB0E6'; }
    else{
      /* 이웃한 칸과 색이 겹치지 않게 차례로 고른다 (마지막 칸이 첫 칸과 같아지면 한 칸 민다) */
      let n = pc % COLORS.length;
      if(pc === prizeN - 1 && pc > 0 && n === 0) n = 2;
      fill = COLORS[n]; ink = INK[n]; pc++;
    }
    ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R - 46, st, st + a); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 4; ctx.stroke();

    ctx.save();
    ctx.translate(R, R); ctx.rotate(st + a / 2);
    ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const label = s.name.length > 12 ? s.name.slice(0, 11) + '…' : s.name;
    /* 글자가 가운데 버튼 밑으로 들어가지 않게 폭에 맞춰 줄인다 */
    const FONT = 'px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    let fs = Math.min(s.k < 0 ? 46 : 54, a * 150);
    ctx.font = '800 ' + fs + FONT;
    while(fs > 20 && ctx.measureText(label).width > 245){ fs -= 2; ctx.font = '800 ' + fs + FONT; }
    ctx.fillText(label, R - 78, 0);
    ctx.restore();
  }
  /* 테두리와 전구 */
  ctx.beginPath(); ctx.arc(R, R, R - 23, 0, Math.PI * 2);
  ctx.lineWidth = 46; ctx.strokeStyle = '#2A1640'; ctx.stroke();
}
function showRoulette(){
  VIEW = 'roulette';
  SLICES = buildSlices();
  ROT = 0; SPINNING = false;
  playShell('원판을 돌려 주세요', '가운데 버튼을 누르면 돌아갑니다. 멈춘 칸의 상품을 드립니다.', `
    <div class="gm-rwrap">
      <div class="gm-wbox">
        <div class="gm-glow"></div>
        <div class="gm-pin"></div>
        <canvas id="gm-wheel"></canvas>
        ${bulbs()}
        <button class="gm-hub" id="gm-spin">돌리기</button>
      </div>
    </div>`);
  if(!SLICES.length){ soldOut(); return; }
  drawWheel();
  ROOT.querySelector('#gm-spin').onclick = spin;
}
function soldOut(){
  const b = ROOT.querySelector('.gm-wbox');
  if(b) b.innerHTML = '<div class="gm-end">오늘 준비한 상품이 모두 나갔습니다.<br>찾아 주셔서 감사합니다.</div>';
}
function spin(){
  if(SPINNING || !SLICES.length) return;
  const r = CFG.roulette;
  const total = r.items.reduce((s, it) => s + it.left, 0) + r.lose.left;
  if(total <= 0){ soldOut(); return; }
  SPINNING = true;

  /* 남은 수량 비율대로 결과를 먼저 정한다 */
  let pick = rnd(total), key = -1;
  for(let i = 0; i < r.items.length; i++){
    if(pick < r.items[i].left){ key = i; break; }
    pick -= r.items[i].left;
  }
  /* 원판에 그 결과가 그려진 칸 중 하나를 고른다 */
  const cand = [];
  SLICES.forEach((s, i) => { if(s.k === key) cand.push(i); });
  if(!cand.length){ SPINNING = false; return; }
  const idx = cand[rnd(cand.length)];
  const a = 360 / SLICES.length;
  const jitter = (rnd(1000) / 1000 - 0.5) * (a - 8);       /* 칸 가장자리는 피한다 */
  const target = 360 - (idx + 0.5) * a - jitter;
  const cur = ((ROT % 360) + 360) % 360;
  ROT += 360 * 6 + ((target - cur + 360) % 360);

  /* 결과는 돌기 전에 먼저 저장한다 (도는 중에 새로고침해도 수량이 맞게) */
  const name = key >= 0 ? r.items[key].name : '';
  if(key >= 0) r.items[key].left = Math.max(0, r.items[key].left - 1);
  else r.lose.left = Math.max(0, r.lose.left - 1);
  addLog('r', name);
  save();

  const cv = ROOT.querySelector('#gm-wheel');
  const hub = ROOT.querySelector('#gm-spin');
  hub.disabled = true;
  ROOT.querySelector('.gm-wbox').classList.add('spin');
  cv.style.transition = 'transform 5.4s cubic-bezier(.12,.68,.08,1)';
  cv.style.transform = 'rotate(' + ROT + 'deg)';
  setTimeout(function(){
    SPINNING = false;
    if(VIEW !== 'roulette' || !ROOT) return;
    const wb = ROOT.querySelector('.gm-wbox'); if(wb) wb.classList.remove('spin');
    const next = function(){
      const nextSlices = buildSlices();
      const changed = nextSlices.length !== SLICES.length
        || nextSlices.some((s, i) => s.k !== SLICES[i].k);
      if(!nextSlices.length){ SLICES = []; soldOut(); return; }
      if(changed){
        SLICES = nextSlices; ROT = 0;
        cv.style.transition = 'none'; cv.style.transform = 'rotate(0deg)';
        drawWheel();
      }
      hub.disabled = false;
    };
    if(name){
      popup('win', '축하합니다', '<b>' + esc(name) + '</b><span>직원에게 이 화면을 보여 주세요.</span>', '상품을 받았어요', next);
    }else{
      popup('lose', '아쉬워요', '<b>다음 기회에</b><span>다음에 오시면 다시 도전해 주세요.</span>', '확인', next);
    }
  }, 5600);
}

/* ───────── 게임 2 : 10초 맞추기 ───────── */
let T0 = 0, RAF = 0, RUN = false;

function timerPrizes(){
  const t = CFG.timer;
  let h = '';
  if(t.p1.name && t.p1.left > 0) h += `<div><span>정확히 10.00초</span><b>${esc(t.p1.name)}</b></div>`;
  if(t.p2.name && t.p2.left > 0) h += `<div><span>9.90 ~ 10.10초</span><b>${esc(t.p2.name)}</b></div>`;
  return h;
}
function showTimer(){
  VIEW = 'timer';
  RUN = false; cancelAnimationFrame(RAF);
  const lv = LEVELS[CFG.timer.level];
  playShell('10초를 맞혀 주세요', '버튼을 눌러 시작하고, 10.00초가 되는 순간 다시 눌러 멈춥니다.', `
    <div class="gm-twrap">
      <div class="gm-clock"><span id="gm-num">0.00</span><i>초</i></div>
      <button class="gm-tbtn" id="gm-tbtn">시작</button>
      <div class="gm-tlv">난이도 ${lv.name}</div>
      <div class="gm-list gm-tlist" id="gm-tlist">${timerPrizes()}</div>
    </div>`);
  const btn = ROOT.querySelector('#gm-tbtn');
  const numEl = ROOT.querySelector('#gm-num');
  if(!(CFG.timer.p1.left > 0) && !(CFG.timer.p2.left > 0)){
    ROOT.querySelector('.gm-clock').innerHTML = '<div class="gm-end">오늘 준비한 상품이 모두 나갔습니다.<br>찾아 주셔서 감사합니다.</div>';
    btn.style.display = 'none';
    return;
  }
  const now = () => (performance.now() - T0) / 1000 * lv.speed;
  const show = v => { numEl.textContent = (Math.floor(v * 100) / 100).toFixed(2); };
  const tick = function(){
    if(!RUN) return;
    const v = now();
    if(v >= 20){ stop(20); return; }
    show(v);
    RAF = requestAnimationFrame(tick);
  };
  const stop = function(v){
    RUN = false; cancelAnimationFrame(RAF);
    const val = Math.floor(v * 100) / 100;
    show(val);
    btn.textContent = '시작'; btn.classList.remove('run'); btn.disabled = true; numEl.parentNode.classList.remove('run');
    const t = CFG.timer;
    const diff = Math.abs(val - 10);
    let prize = '', perfect = false;
    if(val.toFixed(2) === '10.00' && t.p1.left > 0){ prize = t.p1.name; t.p1.left--; perfect = true; }
    else if(diff <= NEAR + 1e-9 && t.p2.left > 0){ prize = t.p2.name; t.p2.left--; }
    addLog('t', prize);
    save();
    const again = function(){
      if(VIEW !== 'timer' || !ROOT) return;
      numEl.textContent = '0.00'; btn.disabled = false;
      ROOT.querySelector('#gm-tlist').innerHTML = timerPrizes();
      if(!(t.p1.left > 0) && !(t.p2.left > 0)) showTimer();
    };
    setTimeout(function(){
      if(VIEW !== 'timer' || !ROOT) return;
      if(prize){
        popup('win', perfect ? '정확히 10.00초입니다' : '축하합니다',
          '<b>' + esc(prize) + '</b><span>기록 ' + val.toFixed(2) + '초 · 직원에게 이 화면을 보여 주세요.</span>', '상품을 받았어요', again);
      }else{
        const gap = diff.toFixed(2);
        popup('lose', val.toFixed(2) + '초', '<b>' + gap + '초 차이였어요</b><span>다음에 오시면 다시 도전해 주세요.</span>', '확인', again);
      }
    }, 500);
  };
  btn.addEventListener('pointerdown', function(e){
    e.preventDefault();
    if(btn.disabled) return;
    if(!RUN){
      RUN = true; T0 = performance.now();
      btn.textContent = '멈춤'; btn.classList.add('run'); numEl.parentNode.classList.add('run');
      RAF = requestAnimationFrame(tick);
    }else{
      stop(now());
    }
  });
}

/* ───────── 모양 ───────── */
function injectCss(){
  if(document.getElementById('bn-game-css')) return;
  const st = document.createElement('style');
  st.id = 'bn-game-css';
  st.textContent = `
#bn-game{position:fixed;inset:0;z-index:1500;overflow-y:auto;-webkit-overflow-scrolling:touch;
  font-family:'Pretendard Variable',Pretendard,-apple-system,system-ui,sans-serif;letter-spacing:-.02em}
#bn-game *{box-sizing:border-box}
#bn-game button{font-family:inherit;cursor:pointer}
.gm-load{padding:120px 20px;text-align:center;color:var(--ink3);background:var(--bg);min-height:100%}

/* 설정 */
#bn-game.gm-setup{background:var(--bg);color:var(--ink)}
.gm-hd{position:sticky;top:0;z-index:3;background:var(--card);border-bottom:1px solid var(--line);
  padding:calc(env(safe-area-inset-top) + 13px) 18px 13px;display:flex;align-items:center;gap:12px}
.gm-bk{font-size:22px;line-height:1;cursor:pointer;padding:0 4px}
.gm-tt{flex:1;font-size:17px;font-weight:700}
.gm-day{font-size:13px;color:var(--ink2);font-weight:600}
.gm-body{max-width:640px;margin:0 auto;padding:18px 18px 60px}
.gm-why{border-left:3px solid var(--ink);padding:2px 0 2px 14px;font-size:14px;line-height:1.7;color:var(--ink2)}
.gm-why b{display:block;color:var(--ink);font-size:15.5px;margin-bottom:4px}
.gm-why span{display:block;margin-top:8px;font-size:12.5px;color:var(--ink3)}
.gm-warn{margin-top:14px;padding:11px 13px;border:1px solid var(--amber);color:var(--amber);font-size:12.5px;font-weight:600;border-radius:8px}
.gm-sec{margin-top:30px;padding-top:22px;border-top:1px solid var(--line)}
.gm-st{font-size:18px;font-weight:800}
.gm-st i{font-style:normal;font-size:11.5px;font-weight:800;color:var(--card);background:var(--ink);
  padding:3px 7px;border-radius:4px;margin-right:8px;vertical-align:2px}
.gm-st em{font-style:normal;font-size:13px;font-weight:600;color:var(--ink3);margin-left:6px}
.gm-cap{font-size:13px;color:var(--ink2);margin:7px 0 16px;line-height:1.6}
.gm-rowh,.gm-row{display:grid;grid-template-columns:1fr 78px 52px;gap:8px;align-items:center}
.gm-rowh{font-size:11.5px;color:var(--ink3);font-weight:600;margin-bottom:6px}
.gm-rowh span:nth-child(n+2){text-align:center}
.gm-row{margin-bottom:8px}
.gm-row input{width:100%;min-width:0;padding:13px 12px;border:1px solid var(--line);border-radius:8px;
  font:inherit;font-size:15px;background:var(--card);color:var(--ink);outline:none}
.gm-row input:focus{border-color:var(--ink)}
.gm-row input[type=number]{text-align:center}
.gm-nm{padding:13px 12px;font-size:15px;color:var(--ink2);background:var(--soft);border-radius:8px}
.gm-left{text-align:center;font-size:14px;font-weight:700;color:var(--ink2)}
.gm-ta{width:100%;padding:13px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;font-size:15px;line-height:1.55;
  background:var(--card);color:var(--ink);outline:none;resize:vertical}
.gm-ta:focus{border-color:var(--ink)}
.gm-add{border:0;background:none;color:var(--ink);font-size:14px;font-weight:700;padding:8px 0 14px}
.gm-odds{font-size:13px;color:var(--ink);font-weight:600;margin:10px 0 2px;min-height:18px;line-height:1.55}
.gm-go{display:block;width:100%;margin-top:14px;padding:16px;border:0;border-radius:10px;
  background:var(--ink);color:var(--card);font-size:16px;font-weight:700}
.gm-go:active{opacity:.85}
.gm-lv{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.gm-lv button{border:1px solid var(--line);background:var(--card);color:var(--ink2);border-radius:8px;
  padding:12px 6px;text-align:center}
.gm-lv button b{display:block;font-size:15px;color:var(--ink)}
.gm-lv button span{display:block;font-size:11px;margin-top:4px;line-height:1.4}
.gm-lv button.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.gm-log{margin-top:12px;font-size:14px}
.gm-log div{display:grid;grid-template-columns:52px 44px 1fr;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
.gm-log span{color:var(--ink3)}
.gm-log p{color:var(--ink3);margin:8px 0}
.gm-foot{margin-top:26px;font-size:12.5px;color:var(--ink3);line-height:1.6}

/* 게임 화면 */
#bn-game.gm-play{background:radial-gradient(120% 90% at 50% 0%,#3A1466 0%,#1B0B3A 45%,#0B0620 100%);color:#fff;
  display:flex;flex-direction:column;align-items:center;
  padding:calc(env(safe-area-inset-top) + 10px) 16px calc(env(safe-area-inset-bottom) + 14px);
  user-select:none;-webkit-user-select:none;touch-action:manipulation;overflow-x:hidden}
#bn-game.gm-play > *{position:relative;z-index:1}
.gm-sky{position:absolute!important;inset:0;z-index:0!important;pointer-events:none;overflow:hidden}
.gm-sky i{position:absolute;background:currentColor;opacity:0;animation:gmTw ease-in-out infinite;
  clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)}
@keyframes gmTw{0%,100%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}
.gm-ptop{width:100%;display:flex;align-items:center;justify-content:space-between}
.gm-hold{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.3);background:transparent;color:rgba(255,255,255,.6);
  font-size:12px;font-weight:600;padding:7px 12px;border-radius:6px}
.gm-hold span{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.28)}
.gm-hold.ing span{width:100%;transition:width 1.2s linear}
.gm-store{font-size:13px;font-weight:700;color:rgba(255,255,255,.65)}
.gm-notice{margin-top:12px;max-width:min(94vw,900px);padding:12px 20px;border-radius:10px;text-align:center;
  font-size:clamp(15px,2.5vw,22px);font-weight:800;line-height:1.5;color:#1B0B3A;word-break:keep-all;
  background:linear-gradient(90deg,#FF8FA6,#FFC46B,#FFF07A,#8CF0A8,#7DD6FF,#C9A4FF,#FF8FA6);background-size:300% 100%;
  animation:gmSlide 6s linear infinite;box-shadow:0 0 22px rgba(255,220,120,.45)}
.gm-ptitle{margin-top:12px;font-size:clamp(28px,5.6vw,52px);font-weight:900;letter-spacing:-.04em;text-align:center;
  background:linear-gradient(90deg,#FF5E7E,#FFB13D,#FFE94A,#5BE584,#4FC3FF,#B07CFF,#FF5E7E);background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;animation:gmSlide 4s linear infinite;
  filter:drop-shadow(0 0 14px rgba(255,255,255,.28))}
@keyframes gmSlide{to{background-position:300% 0}}
.gm-psub{margin-top:6px;font-size:clamp(13px,2vw,17px);color:rgba(255,255,255,.72);text-align:center;line-height:1.5}
.gm-priv{margin-top:10px;font-size:12px;color:rgba(255,255,255,.5);text-align:center}

.gm-rwrap{flex:1;width:100%;display:flex;align-items:center;justify-content:center;margin-top:18px;padding-top:calc(min(86vw,60vh) * .05);min-height:0}
.gm-wbox{--w:min(86vw,60vh);position:relative;width:var(--w);aspect-ratio:1/1;flex:none}
.gm-glow{position:absolute;inset:-5%;border-radius:50%;z-index:0;filter:blur(calc(var(--w) * .035));opacity:.95;
  background:conic-gradient(#FF5E7E,#FFB13D,#FFE94A,#5BE584,#4FC3FF,#B07CFF,#FF5E7E);animation:gmTurn 3.2s linear infinite}
.gm-wbox.spin .gm-glow{animation-duration:.7s}
@keyframes gmTurn{to{transform:rotate(360deg)}}
.gm-wbox canvas{position:relative;z-index:1;width:100%;height:100%;display:block;border-radius:50%}
.gm-bulb{position:absolute;z-index:2;width:calc(var(--w) * .024);height:calc(var(--w) * .024);margin:calc(var(--w) * -.012) 0 0 calc(var(--w) * -.012);
  border-radius:50%;background:#fff;box-shadow:0 0 calc(var(--w) * .02) calc(var(--w) * .006) #FFE94A;animation:gmBulb .9s steps(1) infinite}
.gm-bulb.b2{animation-name:gmBulb2}
.gm-wbox.spin .gm-bulb{animation-duration:.24s}
@keyframes gmBulb{0%{background:#fff;box-shadow:0 0 12px 4px #FFE94A}17%{background:#FF8FA6;box-shadow:0 0 12px 4px #FF5E7E}
  34%{background:#8CF0A8;box-shadow:0 0 12px 4px #5BE584}50%{background:#3b2a1a;box-shadow:none}
  67%{background:#7DD6FF;box-shadow:0 0 12px 4px #4FC3FF}84%{background:#C9A4FF;box-shadow:0 0 12px 4px #B07CFF}}
@keyframes gmBulb2{0%{background:#3b2a1a;box-shadow:none}17%{background:#7DD6FF;box-shadow:0 0 12px 4px #4FC3FF}
  34%{background:#C9A4FF;box-shadow:0 0 12px 4px #B07CFF}50%{background:#fff;box-shadow:0 0 12px 4px #FFE94A}
  67%{background:#FF8FA6;box-shadow:0 0 12px 4px #FF5E7E}84%{background:#8CF0A8;box-shadow:0 0 12px 4px #5BE584}}
.gm-pin{position:absolute;left:50%;top:-3.5%;z-index:3;width:0;height:0;transform:translateX(-50%);
  border-left:calc(var(--w) * .045) solid transparent;border-right:calc(var(--w) * .045) solid transparent;
  border-top:calc(var(--w) * .105) solid #FFE94A;filter:drop-shadow(0 0 10px #FFE94A) drop-shadow(0 3px 0 rgba(0,0,0,.4))}
.gm-hub{position:absolute;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);width:27%;aspect-ratio:1/1;border-radius:50%;
  border:calc(var(--w) * .014) solid #fff;color:#1B0B3A;font-size:calc(var(--w) * .058);font-weight:900;
  background:linear-gradient(135deg,#FFE94A,#FFB13D 45%,#FF5E7E);box-shadow:0 0 calc(var(--w) * .06) rgba(255,233,74,.9),0 5px 0 rgba(0,0,0,.35);
  animation:gmPulse 1.1s ease-in-out infinite}
@keyframes gmPulse{50%{box-shadow:0 0 calc(var(--w) * .11) rgba(255,255,255,1),0 5px 0 rgba(0,0,0,.35);filter:brightness(1.15)}}
.gm-hub:active{transform:translate(-50%,-48%)}
.gm-hub:disabled{animation:none;filter:grayscale(.6) brightness(.8)}
.gm-end{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;height:100%;text-align:center;
  font-size:clamp(18px,3vw,26px);font-weight:800;line-height:1.6;color:#FFE94A}
.gm-list div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.18);font-size:16px}
.gm-list div span{font-weight:700;color:rgba(255,255,255,.8)}
.gm-list div b{font-weight:800;color:#FFE94A;white-space:nowrap}

.gm-twrap{flex:1;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;margin-top:10px}
.gm-clock{font-variant-numeric:tabular-nums;font-feature-settings:'tnum';font-weight:900;color:#FFE94A;
  font-size:clamp(84px,24vw,230px);line-height:1;letter-spacing:-.05em;min-height:1em;display:flex;align-items:baseline;
  text-shadow:0 0 30px rgba(255,233,74,.55)}
.gm-clock.run span{background:linear-gradient(90deg,#FF5E7E,#FFB13D,#FFE94A,#5BE584,#4FC3FF,#B07CFF,#FF5E7E);background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;animation:gmSlide 1.6s linear infinite;text-shadow:none;
  filter:drop-shadow(0 0 22px rgba(255,255,255,.45))}
.gm-clock i{font-style:normal;font-size:.22em;margin-left:.12em;color:rgba(255,255,255,.7);letter-spacing:0;text-shadow:none}
.gm-tbtn{width:min(70vw,360px);padding:26px 0;border:0;border-radius:14px;color:#1B0B3A;
  background:linear-gradient(135deg,#FFE94A,#FFB13D);font-size:clamp(24px,5vw,38px);font-weight:900;
  box-shadow:0 7px 0 #A8610A,0 0 34px rgba(255,200,80,.6);animation:gmPulse2 1.1s ease-in-out infinite}
@keyframes gmPulse2{50%{filter:brightness(1.18)}}
.gm-tbtn.run{background:linear-gradient(135deg,#FF5E7E,#D9382C);color:#fff;box-shadow:0 7px 0 #7A1E16,0 0 34px rgba(255,94,126,.7)}
.gm-tbtn:active{transform:translateY(4px)}
.gm-tbtn:disabled{opacity:.5;animation:none}
.gm-tlv{font-size:12.5px;font-weight:700;color:rgba(255,255,255,.6)}
.gm-tlist{width:min(86vw,420px)}

/* 결과 */
.gm-pop{display:none;position:fixed!important;inset:0;z-index:5!important;align-items:center;justify-content:center;background:rgba(8,3,24,.78);padding:20px}
.gm-pop.on{display:flex}
.gm-card{position:relative;z-index:2;width:min(92vw,540px);background:#FFFDF7;border-radius:14px;color:#2A1640;
  padding:36px 24px 26px;text-align:center;animation:gmIn .28s cubic-bezier(.2,1.3,.4,1)}
.gm-pop.win .gm-card::before{content:'';position:absolute;inset:-7px;z-index:-1;border-radius:20px;
  background:linear-gradient(90deg,#FF5E7E,#FFB13D,#FFE94A,#5BE584,#4FC3FF,#B07CFF,#FF5E7E);background-size:300% 100%;
  animation:gmSlide 2s linear infinite;box-shadow:0 0 50px rgba(255,255,255,.55)}
.gm-pop.win .gm-card::after{content:'';position:absolute;inset:0;z-index:-1;border-radius:14px;background:#FFFDF7}
.gm-ph{font-size:clamp(20px,3.6vw,28px);font-weight:800;color:#D9382C}
.gm-pop.lose .gm-ph{color:#6B5A8A}
.gm-pb b{display:block;margin:14px 0 10px;font-size:clamp(34px,7.4vw,62px);font-weight:900;letter-spacing:-.04em;line-height:1.2;color:#2A1640;word-break:keep-all}
.gm-pop.win .gm-pb b{background:linear-gradient(90deg,#E0245E,#F08A00,#1E9E55,#1877D6,#7A3FE0,#E0245E);background-size:300% 100%;
  -webkit-background-clip:text;background-clip:text;color:transparent;animation:gmSlide 3s linear infinite}
.gm-pb span{display:block;font-size:clamp(14px,2.2vw,18px);color:#6B5A8A;line-height:1.5}
.gm-pbtn{margin-top:24px;width:100%;padding:17px;border:0;border-radius:8px;background:#2A1640;color:#fff;font-size:17px;font-weight:800}
.gm-conf{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.gm-conf i{position:absolute;top:-20px;width:10px;height:16px;animation:gmFall linear forwards}
@keyframes gmFall{to{top:110%;transform:rotate(720deg)}}
@keyframes gmIn{from{transform:scale(.8);opacity:0}to{transform:none;opacity:1}}

@media (min-width:900px) and (orientation:landscape){ .gm-wbox{--w:min(60vw,62vh)} }
@media (prefers-reduced-motion:reduce){ .gm-conf,.gm-sky{display:none} .gm-glow,.gm-bulb,.gm-hub,.gm-tbtn{animation:none} }
`;
  document.head.appendChild(st);
}

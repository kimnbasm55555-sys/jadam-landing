/* 하단 탭 · 매장 · 본사 · 내정보 */
import { listStaff, currentUser, signOut, pendingCount, reviewCount,
         uploadDocPhoto, saveMemberPhoto, myProfileName , isFiveOrMore } from "../db.js";
import { $, esc, go, setPendingBadge, restart } from "./ui.js";
import { openGov } from "./gov.js";
import { openLeave } from "./leave.js";
import { openFinance } from "./finance.js";
import { openStoreInfo } from "./storeinfo.js";
import { openAtt } from "./att.js";
import { S } from "./state.js";
import { openSheet, openViewer, pauseOthers } from "./overlay.js";
import { openStaff } from "./staff.js";
import { openStoreQr } from "./storeqr.js";
import { openNotiSet } from "./notiset.js";
import { openSchedule } from "./schedule.js";
import { openContractList } from "./contract.js";
import { openDocs } from "./docs.js";
import { openPw, isFirstPw } from "./pw.js";
import { listNotices, markNoticeRead, db } from "../db.js";

export function initTabs(){
  document.querySelectorAll('nav button').forEach(function(b){
  b.onclick = function(){
    document.querySelectorAll('nav button').forEach(function(x){x.classList.remove('on')});
    document.querySelectorAll('.tpane').forEach(function(x){x.classList.remove('on')});
    b.classList.add('on');
    const el = document.getElementById('pane-' + b.dataset.p);
    if(el) el.classList.add('on');
    window.scrollTo(0,0);
    if(b.dataset.p === 'store') renderStoreTab();
    if(b.dataset.p === 'hq')    renderHqTab();
    if(b.dataset.p === 'me')    renderMeTab();
  };
});

/* 홈 화면 '자주 쓰는 기능' — 직원 · 국가지원 · 근무표 · 수익계산 · 매장 QR · 인수인계
   (화면에 적힌 순서와 여기 순서가 같아야 한다) */
const hg = document.querySelectorAll('#pane-home .grid .gi');
if(hg[0]) hg[0].onclick = openStaff;
if(hg[1]) hg[1].onclick = openGov;
if(hg[2]) hg[2].onclick = openSchedule;
if(hg[3]) hg[3].onclick = openFinance;
if(hg[4]) hg[4].onclick = openStoreQr;
if(hg[5]) hg[5].onclick = async function(){
  const { openHandoverLog } = await import('./handover.js');
  openHandoverLog();
};

}

async function renderStoreTab(){
  if(!S.store) return;
  $('store-sub').textContent = S.store.name + (S.store.addr ? ' · ' + S.store.addr : '');
  const gi = document.querySelectorAll('#pane-store .gi');
  if(gi[0]) gi[0].onclick = openStaff;
  if(gi[1]) gi[1].onclick = openSchedule;
  if(gi[2]) gi[2].onclick = openContractList;
  if(gi[3]) gi[3].onclick = openAtt;
  if(gi[4]) gi[4].onclick = function(){ openDocs(null, { onBack: function(){ go('s-home'); } }); };
  if(gi[5]) gi[5].onclick = openFinance;
  if(gi[6]) gi[6].onclick = openStoreQr;
  if(gi[7]) gi[7].onclick = openStoreInfo;
  /* 연차는 상시 5인 이상 매장에만 보인다 (근로기준법 11조) */
  const lv = document.getElementById('gi-leave');
  if(lv){
    lv.onclick = openLeave;
    isFiveOrMore(S.store.id)
      .then(function(on){ lv.style.display = on ? '' : 'none'; })
      .catch(function(){});
  }
  if(gi[9]) gi[9].onclick = openGov;
  /* 본사와 연결된 매장에서만 QCS 점검을 보여준다 */
  const gq = $('gi-qcs');
  if(gq){
    if(S.store && S.store.brand_id){
      gq.style.display = '';
      gq.style.cursor = 'pointer';
      gq.onclick = function(){ openSheet('/qcs.html'); };
    }else{
      gq.style.display = 'none';
    }
  }
  /* 고객 게임 (원판 돌리기 · 10초 맞추기) */
  const gg = $('gi-game');
  if(gg){
    gg.style.cursor = 'pointer';
    gg.onclick = async function(){
      const { openGame } = await import('./game.js');
      openGame();
    };
  }
  try{
    const [p, r] = await Promise.all([pendingCount(S.store.id), reviewCount(S.store.id)]);
    setPendingBadge(p + r);
  }catch(e){}
  try{
    const rows = await listStaff(S.store.id);
    const staff = rows.filter(m => m.role !== 'owner');
    $('store-staff-n').textContent = staff.length ? staff.length + '명' : '';
    $('store-staff').innerHTML = staff.length
      ? staff.map(function(m,n){
          return `<div class="row">${avatar(m, n)}
            <div class="tx"><b>${esc(m.name)}</b><span>${m.role==='manager'?'매니저':'아르바이트'}${m.wage?' · 시급 '+Number(m.wage).toLocaleString()+'원':''}</span></div>
            <span class="go">›</span></div>`;
        }).join('')
      : '<div style="padding:30px 0;text-align:center;color:var(--ink3);font-size:14px">아직 등록된 직원이 없어요</div>';
    /* 줄을 누르면 직원 관리로 (화살표가 실제로 동작하게) */
    $('store-staff').querySelectorAll('.row').forEach(function(el){
      el.style.cursor = 'pointer';
      el.onclick = openStaff;
    });
  }catch(e){}
}

function renderHqTab(){
  const gi = document.querySelectorAll('#pane-hq .gi');
  const go = { '공지': openNoticeList,
               'QCS 점검': function(){ openSheet('/qcs.html'); },
               '본사 광고': function(){ openSheet('/brand.html?v=ads'); },
               '브랜드 뉴스': function(){ openSheet('/brand.html?v=news'); } };
  gi.forEach(function(el){
    const lb = (el.querySelector('.lb') || {}).textContent;
    const fn = go[(lb || '').trim()];
    if(fn){ el.style.cursor = 'pointer'; el.onclick = fn; }
  });
  /* 연결 여부는 매장 정보만으로 정한다. 홈을 다 불러오기 전에 탭을 눌러도 맞게 보이도록 먼저 쓴다 */
  $('hq-sub').textContent = S.store && S.store.brand_id ? '본사와 연결되어 있어요' : '연결된 본사가 없어요';
  renderHqAd();
  if(!S.home) return;
  $('hq-n').textContent = S.home.notices.length ? S.home.notices.length + '건' : '';
  $('hq-notices').innerHTML = S.home.notices.length
    ? S.home.notices.map(function(n){
        return `<div class="nt"><span class="tag">${n.kind==='qcs'?'점검':'공지'}</span>
          <div class="tx"><b style="font-weight:500">${esc(n.title)}</b></div><span class="go">›</span></div>`;
      }).join('')
    : '<div style="padding:30px 0;text-align:center;color:var(--ink3);font-size:14px">받은 공지가 없어요</div>';

  /* 공지를 누르면 본문을 펼치고 읽음으로 표시한다 */
  const host = $('hq-notices');
  host.querySelectorAll('.nt').forEach(function(el, i){
    el.onclick = function(){ toggleNotice(el, S.home.notices[i]); };
  });
  /* 가장 최근 공지는 처음부터 펼쳐서 보여준다 */
  const first = host.querySelector('.nt');
  if(first && S.home.notices[0]) toggleNotice(first, S.home.notices[0], { inline:true });
}

const ytId = u => (String(u||'').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/) || [])[1];

/* 손가락·마우스로 끌어서 넘기기 */
function makeDraggable(el){
  if(!el || el._drag) return;
  el._drag = true;
  let down = false, x0 = 0, l0 = 0;
  el.addEventListener('pointerdown', function(e){
    if(e.target.tagName === 'IFRAME') return;
    down = true; x0 = e.clientX; l0 = el.scrollLeft; el.classList.add('drag');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', function(e){
    if(down) el.scrollLeft = l0 - (e.clientX - x0);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    el.addEventListener(ev, function(){ down = false; el.classList.remove('drag'); });
  });
}

function noticeMedia(list){
  const arr = Array.isArray(list) ? list : [];
  if(!arr.length) return '';
  return '<div class="ntrail">' + arr.map(function(m){
    const v = m.youtube ? ytId(m.youtube) : null;
    return v
      ? `<iframe src="https://www.youtube.com/embed/${esc(v)}?rel=0&playsinline=1" allowfullscreen loading="lazy"></iframe>`
      : `<div><img src="${esc(m.image)}" loading="lazy"></div>`;
  }).join('') + '</div>';
}

async function toggleNotice(el, n, opts){
  if(!n) return;
  /* 눌러서 열 때는 큰 화면으로 보여준다 (사진은 손가락으로 좌우로 넘긴다) */
  if(!(opts && opts.inline)){
    openViewer({ title: n.title, body: n.body || '내용이 없는 공지예요.',
                 items: Array.isArray(n.media) ? n.media : [] });
    try{
      await markNoticeRead(n.id, S.store.id);
      el.classList.remove('unread');
      const { renderNoticeBox } = await import('./home.js');
      renderNoticeBox && renderNoticeBox();
    }catch(e){}
    return;
  }

  const open = el.nextElementSibling && el.nextElementSibling.classList.contains('ntbody');
  if(open){ el.nextElementSibling.remove(); return; }

  const box = document.createElement('div');
  box.className = 'ntbody';
  box.innerHTML = '<div class="tx">' + esc(n.body || '내용이 없는 공지예요.') + '</div>'
    + noticeMedia(n.media);
  el.after(box);
  const rail0 = box.querySelector('.ntrail');
  makeDraggable(rail0);
  if(rail0){
    let tm0 = null;
    rail0.addEventListener('scroll', function(){
      clearTimeout(tm0);
      tm0 = setTimeout(function(){
        const i = Math.round(rail0.scrollLeft / 249);
        pauseOthers(rail0, i);
      }, 140);
    }, { passive:true });
  }

  /* 작은 사진을 누르면 큰 화면으로 */
  const media = Array.isArray(n.media) ? n.media : [];
  box.querySelectorAll('.ntrail > *').forEach(function(cell, k){
    if(cell.tagName === 'IFRAME') return;
    cell.style.cursor = 'zoom-in';
    cell.onclick = function(){
      openViewer({ title: n.title, body: n.body || '', items: media, start: k });
    };
  });

  try{
    await markNoticeRead(n.id, S.store.id);
    el.classList.remove('unread');
    const { renderNoticeBox } = await import('./home.js');
    renderNoticeBox && renderNoticeBox();
  }catch(e){}
}

/* 홈의 '새 공지' 카드에서 넘어올 때 */
export function goNotices(){
  const b = document.querySelector('nav button[data-p="hq"]');
  if(b) b.click();
  setTimeout(openNoticeList, 60);
}

/* 공지 전체 보기 */
async function openNoticeList(){
  const host = $('hq-notices');
  host.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--ink3);font-size:14px">불러오는 중…</div>';
  let rows = [];
  try{ rows = await listNotices(30, S.store && S.store.brand_id); }catch(e){}
  if(!rows.length){
    host.innerHTML = '<div style="padding:30px 0;text-align:center;color:var(--ink3);font-size:14px">받은 공지가 없어요</div>';
    return;
  }
  $('hq-n').textContent = rows.length + '건';
  host.innerHTML = rows.map(function(n){
    const d = new Date(n.published_at);
    return `<div class="nt"><span class="tag">${n.kind==='qcs'?'점검':'공지'}</span>
      <div class="tx"><b style="font-weight:500">${esc(n.title)}</b>
      <span style="display:block;font-size:12px;color:var(--ink3);margin-top:2px">${d.getMonth()+1}월 ${d.getDate()}일</span></div>
      <span class="go">›</span></div>`;
  }).join('');
  host.querySelectorAll('.nt').forEach(function(el, i){
    el.onclick = function(){ toggleNotice(el, rows[i]); };
  });
  host.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function renderMeTab(){
  const rows = document.querySelectorAll('#pane-me .row');
  if(rows[0]) rows[0].onclick = openNotiSet;
  const u = await currentUser();
  $('me-sub').textContent = prettyId(u && u.email);
  $('me-logout').onclick = async function(){ await signOut(); restart(); };
  $('me-pw').onclick = () => openPw(function(){ go('s-home'); });
  isFirstPw().then(function(first){
    $('me-pw-sub').textContent = first
      ? '처음 받은 비밀번호를 쓰고 계세요' : '';
    $('me-pw').classList.toggle('blink', first);
  });

  let nm = '';
  try{ nm = (await myProfileName()) || ''; }catch(e){}
  $('own-name').textContent = nm || (S.store && S.store.my_name) || '사장님';
  setOwnPhoto(S.store && S.store.my_photo);

  $('own-photo-btn').onclick = () => $('own-photo-file').click();
  $('own-photo-box').onclick = () => $('own-photo-file').click();
  $('own-photo-file').onchange = pickOwnPhoto;
}

function setOwnPhoto(url){
  const img = $('own-photo'), ph = $('own-photo-ph');
  if(url){ img.src = url; img.style.display = 'block'; ph.style.display = 'none'; }
  else   { img.removeAttribute('src'); img.style.display = 'none'; ph.style.display = 'flex'; }
}

async function pickOwnPhoto(e){
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!f || !S.store || !S.store.membership_id) return;
  const btn = $('own-photo-btn');
  btn.textContent = '올리는 중…';
  try{
    const url = await uploadDocPhoto(S.store.id, S.store.membership_id, f);
    await saveMemberPhoto(S.store.membership_id, url);
    S.store.my_photo = url;
    setOwnPhoto(url);
  }catch(err){
    alert((err && err.message) || '사진을 올리지 못했어요');
  }finally{
    btn.textContent = '사진 바꾸기';
  }
}

/** 사진이 있으면 사진, 없으면 기본 아바타 */
export function avatar(m, n){
  return m && m.photo_url
    ? `<img class="av lg ph" src="${esc(m.photo_url)}" alt="">`
    : `<svg class="av lg"><use href="#c${((n||0)%4)+1}"/></svg>`;
}


/* ── 본사 탭 맨 위 광고 영상 ───────────────── */
let HQAD_DONE = false;
/* 본사에서 발급한 계정은 01012345678@phone.brandplus.co.kr 형태다.
   화면에는 아이디 대신 휴대폰 번호로 보여준다. */
function prettyId(email){
  const s = String(email || '');
  if(!s) return '';
  const m = s.match(/^(01[0-9]{8,9})@/);
  if(!m) return s;
  const n = m[1];
  return n.length === 11
    ? n.slice(0,3) + '-' + n.slice(3,7) + '-' + n.slice(7)
    : n.slice(0,3) + '-' + n.slice(3,6) + '-' + n.slice(6);
}

export async function renderHqAd(){
  const host = $('hqAd');
  if(!host || !S.store || HQAD_DONE) return;

  let url = null;
  try{
    const { data } = await db.from('hq_assets').select('media')
      .eq('brand_id', S.store.brand_id).eq('kind', 'ad_video')
      .eq('active', true).limit(1);
    const m = data && data[0] && (data[0].media || [])[0];
    url = m && m.youtube;
  }catch(e){}

  const id = ytId(url || '');
  if(!id){
    host.innerHTML = '<div class="advnone">본사 광고 영상이 등록되면 이 자리에 나옵니다</div>';
    return;
  }

  HQAD_DONE = true;
  const q = 'autoplay=1&mute=1&loop=1&playlist=' + id
    + '&controls=0&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3'
    + '&disablekb=1&fs=0';
  host.innerHTML = '<div class="advbox">'
    + '<iframe src="https://www.youtube.com/embed/' + esc(id) + '?' + q
    + '" allow="autoplay; encrypted-media" allowfullscreen></iframe>'
    + '<div class="hit"></div>'
    + '<button type="button" class="more">광고 자세히 보기</button></div>';
  host.querySelector('.hit').onclick   = function(){ location.href = '/brand.html?v=ads'; };
  host.querySelector('.more').onclick  = function(){ location.href = '/brand.html?v=ads'; };
}

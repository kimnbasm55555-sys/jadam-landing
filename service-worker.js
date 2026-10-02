// ============================================================
// 브랜드노트 Service Worker (2026-07-29)
// 근본 해결: 앱 업데이트 시 예전 캐시가 섞이지 않도록 관리
//
// [전략]
//  1. HTML 파일은 캐시하지 않음 (항상 서버에서 최신을 가져옴)
//     → 코드가 바뀌면 사용자는 무조건 최신 코드를 받음
//  2. 버전 번호로 캐시를 관리 → 새 버전 배포 시 예전 캐시 완전 삭제
//  3. 이미지·폰트 등 무거운 자원만 캐시 → 속도 유지
//
// [업데이트 방법]
//  코드를 바꿔서 배포할 때마다 아래 CACHE_VERSION 숫자를 올리세요.
//  (예: v1 → v2 → v3 ...) 그러면 예전 캐시가 자동으로 싹 지워집니다.
// ============================================================

const CACHE_VERSION = "v239";                       // ★ 배포할 때마다 숫자를 올리세요
const CACHE_NAME = "brandnote-" + CACHE_VERSION;

// 캐시할 정적 자원 (이미지·아이콘 등 잘 안 바뀌는 것만)
const STATIC_ASSETS = [
  "/vendor/supabase.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-180.png",
  "/icons/badge-96.png",
  "/manifest.json"
];

// ── 설치: 새 버전이 준비되면 바로 대기 상태로 ──
self.addEventListener("install", function(event){
  // 새 워커가 설치되면 즉시 활성화 대기를 건너뛴다 (기존 워커 교체 준비)
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // 정적 자원 미리 캐시 (실패해도 앱은 동작)
      return cache.addAll(STATIC_ASSETS).catch(function(){});
    })
  );
});

// ── 활성화: 예전 버전 캐시를 모두 삭제 (근본 해결!) ──
self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.map(function(key){
          // 지금 버전(CACHE_NAME)이 아닌 모든 예전 캐시를 삭제
          if(key !== CACHE_NAME){
            return caches.delete(key);
          }
        })
      );
    }).then(function(){
      // 새 워커가 열려있는 모든 탭을 즉시 제어 (예전 코드 흔적 제거)
      return self.clients.claim();
    })
  );
});

// ── 요청 가로채기: HTML은 네트워크 우선, 자원은 캐시 우선 ──
self.addEventListener("fetch", function(event){
  const req = event.request;

  // GET 요청만 처리 (POST 등은 그대로 통과)
  if(req.method !== "GET"){ return; }

  const url = new URL(req.url);

  // ── 외부 CDN 라이브러리는 캐시해 둔다 ──
  //    supabase 를 esm.sh 에서 받아오는데, CDN 이 느리면 앱이 아예 안 열린다.
  //    한 번 받아두면 다음부터는 캐시로 즉시 열고, 새 버전은 뒤에서 조용히 받는다.
  if(url.hostname === "esm.sh" || url.hostname === "cdn.jsdelivr.net"){
    event.respondWith(
      caches.match(req).then(function(cached){
        const net = fetch(req).then(function(res){
          if(res && (res.status === 200 || res.type === "opaque")){
            const clone = res.clone();
            caches.open(CACHE_NAME).then(function(c){ c.put(req, clone).catch(function(){}); });
          }
          return res;
        }).catch(function(){ return cached; });
        return cached || net;
      })
    );
    return;
  }

  // 그 밖의 외부 도메인(Supabase API 등)은 건드리지 않음 (항상 네트워크)
  if(url.origin !== self.location.origin){ return; }

  const isHTML =
    req.mode === "navigate" ||
    req.destination === "document" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/";

  if(isHTML){
    // ── HTML: 항상 네트워크에서 최신을 가져온다 (브라우저 캐시까지 우회) ──
    //    → 코드가 바뀌면 사용자는 무조건 최신 버전을 받음
    //    ★ HTML은 캐시에 저장하지도, 캐시에서 꺼내 쓰지도 않는다.
    //      (예전에는 오프라인 대비로 캐시를 꺼내 썼는데, 그 때문에
    //       한동안 앱을 안 쓰다 열면 예전 화면이 먼저 나오는 일이 있었음)
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(function(){
        // 네트워크가 아예 안 될 때만 간단한 안내 (예전 화면을 되살리지 않음)
        return new Response(
          "<!doctype html><meta charset='utf-8'>"+
          "<div style=\"font-family:sans-serif;padding:40px 24px;text-align:center;color:#555\">"+
          "<div style='font-size:17px;font-weight:700;margin-bottom:8px'>인터넷 연결을 확인해 주세요</div>"+
          "<div style='font-size:13.5px;line-height:1.6'>연결되면 자동으로 최신 화면이 열려요.</div>"+
          "<button onclick='location.reload()' style='margin-top:18px;padding:12px 20px;border:none;border-radius:10px;background:#3182f6;color:#fff;font-size:14px;font-weight:700'>다시 시도</button>"+
          "</div>",
          { headers:{ "Content-Type":"text/html; charset=utf-8" } }
        );
      })
    );
    return;
  }

  // vendor 라이브러리는 잘 안 바뀌므로 캐시 우선 (앱 여는 속도에 직결)
  if(url.pathname.startsWith("/vendor/")){
    event.respondWith(
      caches.match(req).then(function(cached){
        if(cached) return cached;
        return fetch(req).then(function(res){
          if(res && res.status === 200){
            const clone = res.clone();
            caches.open(CACHE_NAME).then(function(c){ c.put(req, clone).catch(function(){}); });
          }
          return res;
        });
      })
    );
    return;
  }

  // JS·CSS 는 네트워크 우선 (코드와 화면이 항상 최신이어야 한다)
  //   CSS 를 캐시 우선으로 두면 배포해도 예전 화면이 그대로 나온다.
  //   실제로 다크모드를 넣었는데 폰에서 안 바뀌는 일이 있었다.
  if((url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))
      && !url.pathname.includes("service-worker")){
    event.respondWith(
      fetch(req).catch(function(){ return caches.match(req); })
    );
    return;
  }

  // ── 그 외(이미지·폰트·아이콘): 캐시 우선 (속도) ──
  event.respondWith(
    caches.match(req).then(function(cached){
      if(cached){ return cached; }
      return fetch(req).then(function(res){
        // 성공 응답이면 캐시에 저장
        if(res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(req, clone).catch(function(){});
          });
        }
        return res;
      });
    })
  );
});

// ── 메시지: 앱에서 "지금 새 버전 적용해줘" 요청 시 ──
self.addEventListener("message", function(event){
  if(event.data && event.data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});

/* ---------- 웹푸시 ----------
   서버가 보낸 알림을 받아 폰 알림창에 띄운다.
   앱이 꺼져 있어도 서비스워커는 깨어나므로 여기서 처리한다. */

self.addEventListener("push", function(event){
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch(e) { d = {}; }

  var title = d.title || "브랜드노트";
  var opts = {
    body: d.body || "",
    /* badge = 상단 상태표시줄·AOD(꺼진 검정 화면)에 보이는 작은 로고.
               안드로이드는 badge 의 '투명도'만 읽어 흰색으로 칠한다.
               꽉 찬 컬러 아이콘을 넣으면 흰 네모로 나와 어떤 앱인지 알 수 없다.
               그래서 투명 배경 + 흰 글자 BN 전용 파일을 쓴다.
       icon  = 알림 오른쪽 썸네일 자리. 다른 앱은 여기에 상품 사진처럼 내용 이미지를 넣는다.
               앱 로고는 왼쪽에 폰이 알아서 붙이므로, 여기에 로고를 또 넣으면
               로고가 두 번 나와 어수선하다. 그래서 기본은 비우고,
               보낼 사진이 있을 때(d.thumb)만 넣는다. */
    badge: "/icons/badge-96.png",
    timestamp: Date.now(),
    tag: d.tag || "bn",
    renotify: true,
    requireInteraction: !!d.sticky,
    silent: false,
    data: { link: d.link || "home", kind: d.kind || "", tel: d.tel || "" },
    vibrate: [120, 60, 120]
  };

  if (d.thumb) opts.icon = d.thumb;

  /* 알림에 버튼을 붙인다. 알림창에서 바로 행동하면 열어볼 이유가 생긴다.
     안드로이드 크롬은 버튼 2개까지 보여준다. */
  if (d.tel) {
    opts.actions = [
      { action: "call", title: "전화 걸기" },
      { action: "open", title: "확인" }
    ];
  } else if (d.link && d.link !== "home") {
    opts.actions = [{ action: "open", title: "열어보기" }];
  }

  /* 홈 화면 아이콘에 숫자를 올린다. 알림을 놓쳐도 아이콘에 남는다. */
  if (typeof d.badge_count === "number" && self.navigator && self.navigator.setAppBadge) {
    try {
      if (d.badge_count > 0) self.navigator.setAppBadge(d.badge_count);
      else self.navigator.clearAppBadge();
    } catch (e) {}
  }

  /* 소리와 진동을 확실히 켠다 (안드로이드는 채널 설정을 따르지만 기본값을 막지 않는다) */
  opts.silent = false;
  opts.vibrate = [200, 80, 200];
  opts.renotify = true;
  if (!opts.tag) opts.tag = "bn-" + (d.link || "home");

  /* 앱을 보고 있으면 화면 안에 배너도 함께 띄운다.
     단, 시스템 알림은 언제나 소리 있는 '일반 알림'으로 낸다.
     예전에는 앱이 보이는 중이면 조용한 알림(silent)으로 바꿨는데,
     폰 화면을 끈 직후에도 크롬이 '보이는 중'으로 판단하는 경우가 있었다.
     그러면 조용한 알림이 되고, 갤럭시는 조용한 알림을 잠금화면에 보여주지 않아
     점주가 알림을 놓쳤다. 그래서 조용한 알림으로 바꾸는 처리를 없앴다. */
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      var live = list.filter(function(c){ return c.visibilityState === "visible"; });
      live.forEach(function(c){
        c.postMessage({ bn: "banner", title: title, body: d.body || "", link: d.link || "home" });
      });
      return self.registration.showNotification(title, opts);
    })
  );
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  var data = event.notification.data || {};
  var link = data.link || "home";

  /* 전화 버튼은 앱을 열지 않고 바로 전화 앱으로 넘긴다 */
  if (event.action === "call" && data.tel) {
    event.waitUntil(self.clients.openWindow("tel:" + data.tel));
    return;
  }

  /* 본사 알림은 화면 주소("/qcs.html?store=…", "/hq.html")를 그대로 들고 온다.
     매장 앱 안쪽 화면 이름이 아니므로 그 주소로 바로 연다. */
  if (link.charAt(0) === "/") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (c.url.indexOf(self.location.origin) === 0 && "navigate" in c) {
            return c.focus().then(function(w){ return (w || c).navigate(link); })
                            .catch(function(){ return self.clients.openWindow(link); });
          }
        }
        return self.clients.openWindow(link);
      })
    );
    return;
  }

  var url = "/?n=" + encodeURIComponent(link);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      /* 이미 열려 있으면 그 창을 쓴다. 창을 여러 개 만들지 않는다. */
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.location.origin) === 0) {
          list[i].postMessage({ bn: "open", link: link });
          return list[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

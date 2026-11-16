// GS동해전력 안전교육 — 구글 드라이브 영상 조각 받기 (index.html과 같은 폴더에 올려야 함)
//
// 왜 필요한가:
//   브라우저의 영상 플레이어는 "영상 전체를 달라(Range: bytes=0-)"고 요청하는데,
//   구글 드라이브는 이런 큰 요청을 '다운로드'로 보고 용량 제한(downloadQuotaExceeded, 403)으로 막는다.
//   작은 구간 요청은 허용하므로, 이 파일이 영상 요청을 가로채 8MB 조각으로 나눠 받아 플레이어에 넘겨준다.
//   영상은 계속 구글 드라이브에 있고, 별도 저장소나 비용은 없다.

const CHUNK = 8 * 1024 * 1024;           // 한 번에 받는 크기(8MB). 32MB까지는 허용되는 것을 확인함
const API_HOST = 'www.googleapis.com';
const sizeCache = new Map();             // 파일 ID → 전체 크기(바이트)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // 드라이브 영상 요청(…/drive/v3/files/파일ID?alt=media)만 처리. 나머지는 건드리지 않음
  if (u.hostname !== API_HOST || !u.pathname.startsWith('/drive/v3/files/') || u.searchParams.get('alt') !== 'media') return;
  e.respondWith(handle(e.request, u));
});

async function totalSize(u) {
  const id = u.pathname.split('/').pop();
  if (sizeCache.has(id)) return sizeCache.get(id);
  const metaUrl = u.origin + '/drive/v3/files/' + id + '?fields=size&key=' + encodeURIComponent(u.searchParams.get('key') || '');
  const r = await fetch(metaUrl);
  if (!r.ok) throw new Error('meta ' + r.status);
  const size = parseInt((await r.json()).size, 10);
  if (!(size > 0)) throw new Error('no size');
  sizeCache.set(id, size);
  return size;
}

async function handle(req, u) {
  try {
    const total = await totalSize(u);
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || 'bytes=0-');
    const start = m ? parseInt(m[1], 10) : 0;
    if (start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    end = Math.min(end, start + CHUNK - 1, total - 1);   // 요청이 크면 8MB까지만 잘라서 받음 → 플레이어가 이어서 다음 조각을 요청함

    const r = await fetch(u.href, { headers: { Range: 'bytes=' + start + '-' + end } });
    if (r.status !== 206 && r.status !== 200) return r;   // 실패(403 등)는 그대로 전달 → 사이트가 드라이브 플레이어로 자동 전환
    return new Response(r.body, {
      status: 206, statusText: 'Partial Content',
      headers: {
        'Content-Type': r.headers.get('content-type') || 'video/mp4',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response('sw error: ' + err, { status: 502 });
  }
}

import { BASE, CATEGORIES, CATEGORY_MAP } from './config.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmtDay = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});

export function timeAgo(ts, now = Date.now()) {
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return fmt.format(ts);
}

export const dayLabel = (day) => fmtDay.format(new Date(`${day}T12:00:00+08:00`));

const catName = (slug) => CATEGORY_MAP[slug]?.name || '新聞';
const catColor = (slug) => CATEGORY_MAP[slug]?.color || '#f00069';
const articleHref = (a) => `${BASE}/article/${a.id}`;

function thumb(a, cls = '') {
  if (a.image) {
    return `<div class="thumb ${cls}"><img src="${esc(a.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ph" style="--c:${catColor(a.category)}">${esc(catName(a.category))}</span></div>`;
  }
  return `<div class="thumb ${cls}"><span class="ph" style="--c:${catColor(a.category)}">${esc(catName(a.category))}</span></div>`;
}

const tag = (a) =>
  `<a class="tag" href="${BASE}/category/${a.category}" style="--c:${catColor(a.category)}">${esc(catName(a.category))}</a>`;

const meta = (a) =>
  `<div class="meta"><time datetime="${new Date(a.published_at).toISOString()}">${timeAgo(a.published_at)}</time></div>`;

export function card(a, { big = false, showSummary = false } = {}) {
  return `<article class="card${big ? ' big' : ''}">
  <a href="${articleHref(a)}" class="card-link" aria-label="${esc(a.title)}">${thumb(a)}</a>
  <div class="card-body">${tag(a)}<h3><a href="${articleHref(a)}">${esc(a.title)}</a></h3>${showSummary && a.summary ? `<p class="sum">${esc(a.summary)}</p>` : ''}${meta(a)}</div>
</article>`;
}

export function row(a) {
  return `<li class="row"><a href="${articleHref(a)}">${thumb(a, 'sm')}</a><div><h4><a href="${articleHref(a)}">${esc(a.title)}</a></h4>${meta(a)}</div></li>`;
}

export function listItem(a) {
  return `<li class="li"><time>${timeAgo(a.published_at)}</time><a href="${articleHref(a)}">${esc(a.title)}</a></li>`;
}

export function pager(base, page, hasMore, extra = '') {
  if (page <= 1 && !hasMore) return '';
  const q = (p) => `${base}?page=${p}${extra}`;
  return `<nav class="pager">${page > 1 ? `<a href="${q(page - 1)}">‹ 上一頁</a>` : '<span></span>'}<span>第 ${page} 頁</span>${hasMore ? `<a href="${q(page + 1)}">下一頁 ›</a>` : '<span></span>'}</nav>`;
}

const CSS = `
:root{--pink:#f00069;--blue:#0075ff;--gold:#fcb424;--bg:#f5f5f7;--card:#fff;--ink:#16161a;--sub:#5a5a5a;--line:#e6e6ea;--chip:#fff6f6;--shadow:0 1px 3px rgba(0,0,0,.06),0 4px 14px rgba(0,0,0,.04)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111114;--card:#1b1b20;--ink:#ececf1;--sub:#a0a0aa;--line:#2c2c33;--chip:#2a1520;--shadow:none}}
:root[data-theme=dark]{--bg:#111114;--card:#1b1b20;--ink:#ececf1;--sub:#a0a0aa;--line:#2c2c33;--chip:#2a1520;--shadow:none}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif}
a{color:inherit;text-decoration:none}a:hover{color:var(--pink)}
img{max-width:100%;display:block}
.wrap{max-width:1240px;margin:0 auto;padding:0 16px}
.top{background:var(--card);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:16px;min-height:68px;flex-wrap:wrap}
.logo{display:flex;align-items:center;gap:10px;font-weight:900;font-size:26px;letter-spacing:1px;color:var(--pink)}
.logo i{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--pink),#ff6aa6);color:#fff;font-style:normal;font-size:20px}
.logo small{display:block;font-size:11px;font-weight:500;color:var(--sub);letter-spacing:0}
.today{margin-left:auto;color:var(--sub);font-size:14px}
.search{display:flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--bg)}
.search input{border:0;background:transparent;padding:7px 14px;width:170px;color:var(--ink);font:inherit;font-size:14px;outline:0}
.search button{border:0;background:var(--pink);color:#fff;padding:0 14px;font-size:14px;cursor:pointer}
.nav{background:var(--pink);position:sticky;top:0;z-index:10;box-shadow:0 2px 8px rgba(240,0,105,.25)}
.nav .wrap{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}.nav .wrap::-webkit-scrollbar{display:none}
.nav a{color:#fff;padding:11px 14px;white-space:nowrap;font-weight:600;font-size:15px}
.nav a:hover,.nav a.on{background:rgba(0,0,0,.18);color:#fff}
main{padding:22px 0 40px}
.hero{display:grid;grid-template-columns:2fr 1fr 1fr;grid-template-rows:230px 230px;gap:10px;margin-bottom:28px}
.hero .card{grid-column:span 1}.hero .card.big{grid-row:span 2}
.hero .card{position:relative;border-radius:12px;overflow:hidden;background:#222}
.hero .card .thumb{position:absolute;inset:0;aspect-ratio:auto;border-radius:0}
.hero .card .card-body{position:absolute;z-index:2;left:0;right:0;bottom:0;padding:40px 16px 14px;background:linear-gradient(transparent,rgba(0,0,0,.85));color:#fff}
.hero .card h3{font-size:17px;margin:6px 0 4px;line-height:1.4}.hero .card.big h3{font-size:26px}
.hero .card .meta,.hero .card .meta a{color:rgba(255,255,255,.8)}.hero .card .meta{white-space:nowrap;overflow:hidden}
.hero .card a:hover{color:#fff;text-decoration:underline}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px}
.sec{margin-bottom:34px}
.sec-h{display:flex;align-items:center;gap:10px;margin:0 0 14px;border-bottom:2px solid var(--line)}
.sec-h h2{margin:0 0 -2px;padding:4px 2px 8px;font-size:21px;border-bottom:3px solid var(--c,var(--pink))}
.sec-h .more{margin-left:auto;font-size:14px;color:var(--blue)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.grid.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.card{background:var(--card);border-radius:12px;overflow:hidden;box-shadow:var(--shadow);display:flex;flex-direction:column}
.card-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:4px;flex:1}
.card h3{margin:2px 0;font-size:16.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card .sum{margin:0;color:var(--sub);font-size:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .meta{margin-top:auto}
.thumb{position:relative;aspect-ratio:16/10;background:var(--line);overflow:hidden}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;transition:transform .4s}
.card:hover .thumb img{transform:scale(1.04)}
.thumb .ph{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-weight:800;font-size:22px;letter-spacing:4px;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 55%,#000))}
.thumb.sm{width:108px;flex:none;aspect-ratio:4/3;border-radius:8px}.thumb.sm .ph{font-size:13px;letter-spacing:1px}
.tag{align-self:flex-start;font-size:12px;font-weight:700;color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);padding:1px 8px;border-radius:4px}
.hero .tag{color:#fff;background:var(--c)}
.meta{display:flex;gap:6px;font-size:13px;color:var(--sub)}.meta a{color:var(--sub)}
.split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px}
.split ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.row{display:flex;gap:12px;align-items:flex-start}
.row h4{margin:0 0 4px;font-size:15px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
aside .box{background:var(--card);border-radius:12px;padding:16px;box-shadow:var(--shadow);margin-bottom:20px}
aside h3{margin:0 0 10px;font-size:17px;display:flex;align-items:center;gap:8px}
aside h3::before{content:"";width:4px;height:18px;background:var(--pink);border-radius:2px}
.list{list-style:none;margin:0;padding:0}
.li{display:grid;grid-template-columns:auto 1fr;column-gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:14.5px;line-height:1.5}
.li:last-child{border:0}.li time{color:var(--pink);font-size:12px;font-weight:700;padding-top:2px;white-space:nowrap}
.rank{counter-reset:r}.rank .li{grid-template-columns:24px 1fr}.rank .li time{display:none}
.rank .li::before{counter-increment:r;content:counter(r);display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--chip);color:var(--pink);font-weight:800;font-size:12px;grid-row:span 2}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips a{padding:5px 12px;border-radius:999px;background:var(--chip);font-size:14px;border:1px solid transparent}
.chips a:hover,.chips a.on{border-color:var(--pink);color:var(--pink)}
.page-h{margin:0 0 18px}.page-h h1{margin:0;font-size:28px}.page-h p{margin:4px 0 0;color:var(--sub)}
.pager{display:flex;justify-content:space-between;align-items:center;margin:26px 0;font-size:15px}
.pager a{padding:8px 18px;border-radius:999px;background:var(--blue);color:#fff}.pager a:hover{color:#fff;opacity:.9}
.article{background:var(--card);border-radius:14px;padding:26px;box-shadow:var(--shadow)}
.article h1{font-size:30px;line-height:1.4;margin:10px 0}
.article .cover{border-radius:10px;overflow:hidden;margin:18px 0;aspect-ratio:16/9}
.article .lead{font-size:18px;line-height:1.9}
.content{font-size:18px;line-height:1.95;margin-top:18px;overflow-wrap:anywhere}
.content p{margin:0 0 1.1em}.content h2{font-size:21px;margin:1.6em 0 .6em;line-height:1.5}
.content ul{margin:0 0 1.1em;padding-left:1.4em}.content li{margin:.3em 0}
.content figure{margin:1.4em 0}.content figure img{width:100%;height:auto;border-radius:10px;background:var(--line)}
.content .src-url{font-size:15px;color:var(--sub);word-break:break-all}.content .src-url a{color:var(--blue)}
.content figcaption{font-size:14px;color:var(--sub);margin-top:6px;line-height:1.6}
.btn{display:inline-block;padding:11px 24px;border-radius:999px;background:var(--blue);color:#fff;font-weight:700}.btn:hover{color:#fff;opacity:.92}
.note{font-size:13px;color:var(--sub);margin-top:14px}
.days{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.days a{display:block;background:var(--card);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow)}
.days b{display:block;font-size:17px}.days span{color:var(--sub);font-size:13px}
.empty{padding:50px 20px;text-align:center;color:var(--sub);background:var(--card);border-radius:12px}
footer{background:#0a0500;color:#bbb;padding:30px 0;font-size:14px}
footer a{color:#fff}footer .cols{display:flex;flex-wrap:wrap;gap:10px 22px;margin-bottom:12px}
.theme{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;width:34px;height:34px;cursor:pointer}
@media (max-width:1000px){.layout{grid-template-columns:1fr}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}
 .hero{grid-template-columns:1fr 1fr;grid-template-rows:260px 180px 180px}.hero .card.big{grid-column:span 2;grid-row:span 1}}
@media (max-width:640px){.grid,.grid.g3{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.split{grid-template-columns:1fr}
 .hero{grid-template-columns:1fr 1fr;grid-template-rows:230px 150px 150px;gap:8px}.hero .card.big h3{font-size:20px}.hero .card h3{font-size:14px}
 .content{font-size:17px}.today{display:none}.theme{margin-left:auto}.search{order:3;flex:1 1 100%}.search input{flex:1;width:auto;min-width:0}.top .wrap{padding-bottom:12px}.article{padding:18px}.article h1{font-size:23px}
 .card h3{font-size:15px}.card-body{padding:10px}}
`;

export function layout(env, { title, description, body, active = '', canonical = '', status = 200, head = '', sMaxAge = 180 }) {
  const site = env.SITE_NAME || '尋夢新聞';
  const fullTitle = title ? `${title} - ${site}` : `${site} - ${env.SITE_TAGLINE || ''}`;
  const desc = description || `${site}：政治、財經、社會、生活、國際、娛樂、體育、科技、健康、旅遊即時新聞，完整分類、每日自動更新。`;
  const nav = [`<a href="${BASE}"${active === 'home' ? ' class="on"' : ''}>首頁</a>`, `<a href="${BASE}/latest"${active === 'latest' ? ' class="on"' : ''}>即時</a>`]
    .concat(CATEGORIES.map((c) => `<a href="${BASE}/category/${c.slug}"${active === c.slug ? ' class="on"' : ''}>${c.name}</a>`))
    .concat(`<a href="${BASE}/daily"${active === 'daily' ? ' class="on"' : ''}>每日新聞</a>`)
    .join('');
  const html = `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:site_name" content="${esc(site)}">
<meta name="theme-color" content="#f00069">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${esc(site)}" href="${BASE}/feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2224%22 fill=%22%23f00069%22/><text x=%2250%22 y=%2270%22 font-size=%2260%22 text-anchor=%22middle%22 fill=%22white%22 font-family=%22sans-serif%22 font-weight=%22bold%22>夢</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${CSS}</style>
${head}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="${BASE}"><i>夢</i><span>${esc(site)}<small>${esc(env.SITE_TAGLINE || '')}</small></span></a>
  <span class="today">${fmtDay.format(Date.now())}</span>
  <form class="search" action="${BASE}/search" role="search"><input name="q" placeholder="搜尋新聞…" aria-label="搜尋新聞"><button>搜尋</button></form>
  <button class="theme" title="切換深淺色" aria-label="切換深淺色" onclick="var d=document.documentElement,n=(d.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))==='dark'?'light':'dark';d.dataset.theme=n;try{localStorage.setItem('theme',n)}catch(e){}">◐</button>
</div></header>
<nav class="nav" aria-label="新聞分類"><div class="wrap">${nav}</div></nav>
<main><div class="wrap">${body}</div></main>
<footer><div class="wrap">
  <div class="cols">${CATEGORIES.map((c) => `<a href="${BASE}/category/${c.slug}">${c.name}</a>`).join('')}</div>
  <p>© ${new Date().getFullYear()} ${esc(site)} · <a href="${BASE}/feed.xml">RSS</a> · <a href="${BASE}/sitemap.xml">Sitemap</a></p>
</div></footer>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': status === 200 ? `public, max-age=60, s-maxage=${sMaxAge}` : 'no-store',
    },
  });
}

export const sectionHead = (title, href, color) =>
  `<div class="sec-h" style="--c:${color || 'var(--pink)'}"><h2>${esc(title)}</h2>${href ? `<a class="more" href="${href}">更多 ›</a>` : ''}</div>`;

export function sidebar({ latest = [] } = {}) {
  return `<aside>
  ${latest.length ? `<div class="box"><h3>即時新聞</h3><ul class="list">${latest.map(listItem).join('')}</ul><p style="margin:10px 0 0"><a href="${BASE}/latest" style="color:var(--blue)">看全部即時新聞 ›</a></p></div>` : ''}
  <div class="box"><h3>新聞分類</h3><div class="chips">${CATEGORIES.map((c) => `<a href="${BASE}/category/${c.slug}">${c.name}</a>`).join('')}</div></div>
</aside>`;
}

export const empty = (msg = '目前還沒有新聞，排程更新後就會出現。') => `<div class="empty">${esc(msg)}</div>`;

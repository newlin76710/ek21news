import { BASE, CATEGORIES, CATEGORY_MAP, EXCERPT_CHARS, SOURCE_MAP, SUBDOMAIN_TO_APEX } from './config.js';
import { JOBS, fetchContent, getState, isRssOnly, jobsFor, needsRefresh, runJob, twDay } from './ingest.js';
import { excerptHtml, extractFromUrl, ruleFor } from './extract.js';
import { loadFront } from './state.js';
import { card, dayLabel, empty, esc, layout, listItem, pager, row, sectionHead, sidebar } from './render.js';

const PER_PAGE = 24;
const SEARCH_ROWS = 2000;
const COLS = 'id, url, title, summary, image, source, category, published_at';

const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await q(env, sql, ...args).all()).results;

function pageNum(url) {
  const p = parseInt(url.searchParams.get('page') || '1', 10);
  return Number.isFinite(p) && p > 0 && p < 500 ? p : 1;
}

const latest = (env, n = 12) => all(env, `SELECT ${COLS} FROM articles ORDER BY published_at DESC LIMIT ?1`, n);

// 首頁、側欄、相關新聞用排程預先整理好的 front（讀 1 列），不查文章表。
// 還沒有 front 時（剛部署、排程還沒跑）回傳空資料，頁面照樣能顯示
async function front(env) {
  return (await settle(loadFront(env.DB), null)) || { items: [], days: {} };
}
const sideOf = (f, n = 10) => f.items.slice(0, n);

// ─── 頁面 ───────────────────────────────────────────────────────────

async function home(env) {
  const f = await front(env);
  const now = Date.now();
  const since = now - 3 * 86400_000;
  const heroRows = f.items.filter((a) => a.image && a.published_at > now - 86400_000).slice(0, 40);
  const side = sideOf(f, 15);
  // 每個分類取三天內最新 20 篇，有圖的優先，前 7 篇
  const perCat = CATEGORIES.flatMap((c) =>
    f.items
      .filter((a) => a.category === c.slug && a.published_at > since)
      .slice(0, 20)
      .sort((a, b) => (a.image ? 0 : 1) - (b.image ? 0 : 1) || b.published_at - a.published_at)
      .slice(0, 7),
  ).sort((a, b) => b.published_at - a.published_at);

  // 頭條：每個來源輪流挑一則，避免版面被單一來源佔滿
  const hero = [];
  const seen = new Set();
  for (const a of heroRows) {
    if (hero.length >= 5) break;
    if (!seen.has(a.source)) {
      hero.push(a);
      seen.add(a.source);
    }
  }
  for (const a of heroRows) if (hero.length < 5 && !hero.includes(a)) hero.push(a);
  const heroIds = new Set(hero.map((a) => a.id));

  const groups = Object.fromEntries(CATEGORIES.map((c) => [c.slug, []]));
  for (const a of perCat) if (!heroIds.has(a.id)) groups[a.category]?.push(a);

  const sections = CATEGORIES.filter((c) => groups[c.slug].length)
    .map((c, i) => {
      const items = groups[c.slug];
      const body =
        i % 2 === 0
          ? `<div class="grid">${items.slice(0, 4).map((a) => card(a)).join('')}</div>`
          : `<div class="split">${card(items[0], { showSummary: true })}<ul>${items.slice(1, 6).map(row).join('')}</ul></div>`;
      return `<section class="sec">${sectionHead(c.name, `${BASE}/category/${c.slug}`, c.color)}${body}</section>`;
    })
    .join('');

  const heroHtml = hero.length
    ? `<section class="hero">${hero.map((a, i) => card(a, { big: i === 0 })).join('')}</section>`
    : '';
  const body = `${heroHtml}<div class="layout"><div>${sections || empty()}</div>${sidebar({ latest: side })}</div>`;
  return layout(env, { body, active: 'home' });
}

async function listPage(env, url, { title, subtitle, where, args, active, base, pre = '', from = 'articles' }) {
  const page = pageNum(url);
  const [rows, side] = await Promise.all([
    all(
      env,
      `SELECT ${COLS} FROM ${from} ${where} ORDER BY published_at DESC LIMIT ?${args.length + 1} OFFSET ?${args.length + 2}`,
      ...args,
      PER_PAGE + 1,
      (page - 1) * PER_PAGE,
    ),
    active === 'latest' ? [] : front(env).then((f) => sideOf(f)),
  ]);
  const hasMore = rows.length > PER_PAGE;
  const items = rows.slice(0, PER_PAGE);
  const extra = ['q', 'category']
    .filter((k) => url.searchParams.get(k))
    .map((k) => `&${k}=${encodeURIComponent(url.searchParams.get(k))}`)
    .join('');
  const body = `<div class="page-h"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${pre}
<div class="layout"><div>${items.length ? `<div class="grid g3">${items.map((a) => card(a, { showSummary: true })).join('')}</div>` : empty('找不到相關新聞。')}
${pager(base, page, hasMore, extra)}</div>${sidebar({ latest: side })}</div>`;
  return layout(env, { title: page > 1 ? `${title}（第 ${page} 頁）` : title, body, active });
}

async function categoryPage(env, url, slug) {
  const c = CATEGORY_MAP[slug];
  if (!c) return notFound(env);
  return listPage(env, url, {
    title: `${c.name}新聞`,
    subtitle: `最新${c.name}新聞`,
    where: 'WHERE category = ?1',
    args: [slug],
    active: slug,
    base: `${BASE}/category/${slug}`,
  });
}

async function sourcePage(env, url, id) {
  const s = SOURCE_MAP[id];
  if (!s) return notFound(env);
  const cat = url.searchParams.get('category');
  const chips = `<div class="chips" style="margin-bottom:18px"><a href="${BASE}/source/${id}"${!cat ? ' class="on"' : ''}>全部</a>${CATEGORIES.map(
    (c) => `<a href="${BASE}/source/${id}?category=${c.slug}"${cat === c.slug ? ' class="on"' : ''}>${c.name}</a>`,
  ).join('')}</div>`;
  return listPage(env, url, {
    title: s.name,
    subtitle: `來自 ${s.name}（${new URL(s.home).hostname}）的最新新聞`,
    where: CATEGORY_MAP[cat] ? 'WHERE source = ?1 AND category = ?2' : 'WHERE source = ?1',
    args: CATEGORY_MAP[cat] ? [id, cat] : [id],
    base: `${BASE}/source/${id}`,
    pre: chips,
  });
}

async function searchPage(env, url) {
  const term = (url.searchParams.get('q') || '').trim().slice(0, 50);
  if (!term) return listPage(env, url, { title: '搜尋', subtitle: '請輸入關鍵字', where: 'WHERE 0', args: [], base: `${BASE}/search` });
  const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  return listPage(env, url, {
    title: `「${term}」的搜尋結果`,
    where: "WHERE title LIKE ?1 ESCAPE '\\' OR summary LIKE ?1 ESCAPE '\\'",
    args: [like],
    // 模糊搜尋無法用索引，只搜最新的 SEARCH_ROWS 篇，避免每次搜尋掃過整張表
    from: `(SELECT ${COLS} FROM articles ORDER BY published_at DESC LIMIT ${SEARCH_ROWS})`,
    base: `${BASE}/search`,
  });
}

async function dailyIndex(env) {
  const f = await front(env);
  const days = Object.entries(f.days)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 60)
    .map(([day, n]) => ({ day, n }));
  const body = `<div class="page-h"><h1>每日新聞</h1><p>每天自動整理當日新聞，依分類編成一份日報。</p></div>
${days.length ? `<div class="days">${days.map((d) => `<a href="${BASE}/daily/${d.day}"><b>${esc(dayLabel(d.day))}</b><span>共 ${d.n} 則新聞</span></a>`).join('')}</div>` : empty()}`;
  return layout(env, { title: '每日新聞', body, active: 'daily' });
}

async function dailyPage(env, day) {
  const [start, end] = dayRange(day);
  const rows = await all(env, `SELECT ${COLS} FROM articles WHERE published_at >= ?1 AND published_at < ?2 ORDER BY published_at DESC LIMIT 2000`, start, end);
  if (!rows.length) return notFound(env, '這一天沒有新聞資料。');
  const groups = Object.fromEntries(CATEGORIES.map((c) => [c.slug, []]));
  for (const a of rows) groups[a.category]?.push(a);
  const toc = `<div class="chips" style="margin-bottom:22px">${CATEGORIES.filter((c) => groups[c.slug].length)
    .map((c) => `<a href="#${c.slug}">${c.name}（${groups[c.slug].length}）</a>`)
    .join('')}</div>`;
  const sections = CATEGORIES.filter((c) => groups[c.slug].length)
    .map((c) => {
      const items = groups[c.slug];
      const withImg = items.filter((a) => a.image).slice(0, 4);
      const rest = items.filter((a) => !withImg.includes(a));
      return `<section class="sec" id="${c.slug}">${sectionHead(`${c.name}（${items.length}）`, `${BASE}/category/${c.slug}`, c.color)}
${withImg.length ? `<div class="grid">${withImg.map((a) => card(a)).join('')}</div>` : ''}
${rest.length ? `<ul class="list" style="margin-top:12px;background:var(--card);border-radius:12px;padding:4px 16px">${rest.map(listItem).join('')}</ul>` : ''}</section>`;
    })
    .join('');
  const prev = new Date(Date.parse(day + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
  const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400_000).toISOString().slice(0, 10);
  const body = `<div class="page-h"><h1>${esc(dayLabel(day))} 新聞日報</h1><p>共 ${rows.length} 則新聞</p></div>
${toc}${sections}<nav class="pager"><a href="${BASE}/daily/${prev}">‹ 前一天</a><a href="${BASE}/daily">所有日報</a>${next <= twDay(Date.now()) ? `<a href="${BASE}/daily/${next}">後一天 ›</a>` : '<span></span>'}</nav>`;
  return layout(env, { title: `${dayLabel(day)} 新聞日報`, description: `${dayLabel(day)}新聞彙整，共 ${rows.length} 則。`, body, active: 'daily' });
}

/** 台灣時間某一天的起訖時間（毫秒），用 published_at 的索引查詢 */
function dayRange(day) {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return [start, start + 86400_000];
}

const redirect = (to) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
const settle = (p, fallback) => p.catch((e) => (console.error(e), fallback));

// 標題的二字詞組，用來找相似新聞
function bigrams(s) {
  const t = String(s || '').replace(/[^\p{L}\p{N}]+/gu, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 找一篇有內容可看的相似新聞（同分類、標題最相近）；找不到回傳 null */
async function similarArticle(env, a) {
  const rows = (await front(env)).items.filter((r) => r.category === a.category && r.id !== a.id && r.summary);
  if (!rows.length) return null;
  const mine = bigrams(a.title);
  let best = rows[0];
  let bestScore = -1;
  for (const r of rows) {
    let score = 0;
    for (const g of bigrams(r.title)) if (mine.has(g)) score++;
    if (score > bestScore) (best = r), (bestScore = score);
  }
  return best.id;
}

// 即時擷取全文最多等這麼久，逾時先顯示現有內容，擷取在背景繼續完成並存檔
const LIVE_FETCH_BUDGET = 6000;

/** 全文不會再重抓（RSS 內容來源、或已過了重抓期間）的文章 */
function stable(a, now = Date.now()) {
  if (isRssOnly(a.source) || !ruleFor(a.url)) return true;
  return a.content_status === 1 && now - a.published_at > 24 * 3600_000;
}

async function articlePage(env, url, id, ctx) {
  const a = await q(env, `SELECT ${COLS}, content, content_status, content_at FROM articles WHERE id = ?1`, id).first();
  // 文章不存在（例如超過保存期限被清掉）→ 回首頁
  if (!a) return redirect(`${BASE}/`);
  // 還沒擷取過全文的文章，第一次被打開時即時擷取並存檔（只用 RSS 內容的來源不抓原網站）
  if (!isRssOnly(a.source) && ruleFor(a.url) && (a.content_status === 0 || needsRefresh(a))) {
    const job = settle(fetchContent(env.DB, a), null);
    const got = await Promise.race([job, new Promise((r) => setTimeout(() => r(undefined), LIVE_FETCH_BUDGET))]);
    if (got === undefined) ctx?.waitUntil(job);
    else if (got) a.content = got;
  }
  // 沒有全文也沒有摘要：導到一篇相似的新聞，再不行就回首頁，確保讀者有內容可看
  const hasText = (a.content || '').replace(/<[^>]+>/g, '').trim().length > 0 || (a.summary || '').trim().length > 0;
  if (!hasText) {
    const alt = await similarArticle(env, a);
    return redirect(alt ? `${BASE}/article/${alt}` : `${BASE}/`);
  }
  const f = await front(env);
  const related = f.items.filter((r) => r.category === a.category && r.id !== a.id).slice(0, 6);
  const side = sideOf(f);
  const c = CATEGORY_MAP[a.category];
  const s = SOURCE_MAP[a.source];
  const published = new Date(a.published_at).toISOString();
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title,
    datePublished: published,
    image: a.image ? [a.image] : undefined,
    publisher: { '@type': 'Organization', name: env.SITE_NAME || '尋夢新聞' },
    mainEntityOfPage: `${url.origin}${BASE}/article/${a.id}`,
  };
  // 內文最多顯示 EXCERPT_CHARS 字（RSS 提供全文的來源顯示全文），文末附原文網址
  const full = s?.fullText === true;
  const excerpt = a.content
    ? full
      ? a.content
      : excerptHtml(a.content, EXCERPT_CHARS).html
    : a.summary
      ? `<p>${esc(full ? a.summary : a.summary.slice(0, EXCERPT_CHARS))}</p>`
      : '';
  let shownUrl = a.url;
  try {
    shownUrl = decodeURI(a.url);
  } catch {}
  const sourceLink = `<p class="src-url">原文網址：<a href="${esc(a.url)}" target="_blank" rel="noopener nofollow">${esc(shownUrl)}</a></p>`;
  const bodyHtml = `<div class="content">${excerpt}${sourceLink}</div>`;
  // 內文裡已有圖片時不另外放封面，避免同一張圖出現兩次
  const showCover = a.image && !excerpt.includes('<figure>');
  const body = `<div class="layout"><div>
<article class="article">
  <a class="tag" href="${BASE}/category/${a.category}" style="--c:${c?.color}">${esc(c?.name)}</a>
  <h1>${esc(a.title)}</h1>
  <div class="meta"><time datetime="${published}">${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'long', timeStyle: 'short' }).format(a.published_at)}</time></div>
  ${showCover ? `<div class="cover thumb"><img src="${esc(a.image)}" alt="${esc(a.title)}" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ''}
  ${bodyHtml}
  <p class="note">本文標題與摘要取自${esc(s?.name)}公開資訊，完整內容與版權屬原媒體所有。</p>
</article>
${related.length ? `<section class="sec" style="margin-top:28px">${sectionHead(`更多${c?.name}新聞`, `${BASE}/category/${a.category}`, c?.color)}<div class="grid g3">${related.map((r) => card(r)).join('')}</div></section>` : ''}
</div>${sidebar({ latest: side })}</div>`;
  return layout(env, {
    title: a.title,
    description: a.summary || a.title,
    canonical: `${url.origin}${BASE}/article/${a.id}`,
    body,
    // 內容已經不會再重抓的文章，快取一天
    sMaxAge: stable(a) ? 86400 : 180,
    head: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>${a.image ? `<meta property="og:image" content="${esc(a.image)}">` : ''}`,
  });
}

function notFound(env, msg = '找不到這個頁面。') {
  return layout(env, { title: '找不到頁面', body: empty(msg), status: 404 });
}

// ─── 機器可讀輸出 ───────────────────────────────────────────────────

const xmlEsc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

async function feed(env, origin, category) {
  const rows = category
    ? await all(env, `SELECT ${COLS} FROM articles WHERE category = ?1 ORDER BY published_at DESC LIMIT 50`, category)
    : await latest(env, 50);
  const site = env.SITE_NAME || '尋夢新聞';
  const title = category ? `${CATEGORY_MAP[category].name} - ${site}` : site;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${xmlEsc(title)}</title><link>${origin}${BASE}/</link><description>${xmlEsc(env.SITE_TAGLINE || '')}</description><language>zh-TW</language>
${rows
  .map(
    (a) => `<item><title>${xmlEsc(a.title)}</title><link>${origin}${BASE}/article/${a.id}</link><guid isPermaLink="false">${a.id}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><category>${xmlEsc(CATEGORY_MAP[a.category]?.name)}</category><description>${xmlEsc(a.summary || '')}</description>${a.image ? `<enclosure url="${xmlEsc(a.image)}" type="image/jpeg" length="0"/>` : ''}</item>`,
  )
  .join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

async function sitemap(env, origin) {
  const [rows, days] = await Promise.all([
    all(env, 'SELECT id, published_at FROM articles ORDER BY published_at DESC LIMIT 2000'),
    front(env).then((f) => Object.keys(f.days).sort().reverse().slice(0, 60).map((day) => ({ day }))),
  ]);
  const urls = [
    `${origin}${BASE}/`,
    `${origin}${BASE}/latest`,
    `${origin}${BASE}/daily`,
    ...CATEGORIES.map((c) => `${origin}${BASE}/category/${c.slug}`),
    ...days.map((d) => `${origin}${BASE}/daily/${d.day}`),
  ].map((u) => `<url><loc>${u}</loc></url>`);
  for (const r of rows) urls.push(`<url><loc>${origin}${BASE}/article/${r.id}</loc><lastmod>${new Date(r.published_at).toISOString()}</lastmod></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' },
  });
}

async function api(env, url) {
  const where = [];
  const args = [];
  const cat = url.searchParams.get('category');
  const src = url.searchParams.get('source');
  const day = url.searchParams.get('day');
  if (CATEGORY_MAP[cat]) where.push(`category = ?${args.push(cat)}`);
  if (SOURCE_MAP[src]) where.push(`source = ?${args.push(src)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day || '')) {
    const [start, end] = dayRange(day);
    where.push(`published_at >= ?${args.push(start)} AND published_at < ?${args.push(end)}`);
  }
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), 200);
  const rows = await all(
    env,
    `SELECT ${COLS} FROM articles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY published_at DESC LIMIT ?${args.length + 1}`,
    ...args,
    limit,
  );
  const data = rows.map((a) => ({
    ...a,
    published_at: new Date(a.published_at).toISOString(),
    category_name: CATEGORY_MAP[a.category]?.name,
    source_name: SOURCE_MAP[a.source]?.name,
  }));
  return Response.json({ count: data.length, data }, { headers: { 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' } });
}

async function status(env) {
  const st = await getState(env.DB);
  const iso = (t) => (t ? new Date(t).toISOString() : null);
  return Response.json(
    {
      updated: iso(st.front.at),
      newest: Object.fromEntries(Object.entries(st.meta.newest).map(([k, v]) => [k, iso(v)])),
      days: st.front.days,
      todo: {
        total: st.meta.todo.length,
        image: st.meta.todo.filter((t) => t.img).length,
        content: st.meta.todo.filter((t) => t.c).length,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

async function refresh(env, url) {
  const token = url.searchParams.get('token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response('forbidden', { status: 403 });
  const job = url.searchParams.get('job') || 'all';
  // 從文章表重建 state（首頁資料、每日篇數、待辦清單）
  if (job === 'rebuild') {
    const st = await getState(env.DB, true);
    return Response.json({ items: st.front.items.length, days: Object.keys(st.front.days).length, todo: st.meta.todo.length });
  }
  const jobs = job === 'all' ? JOBS : [job];
  const out = {};
  for (const j of jobs) {
    try {
      out[j] = await runJob(env, j);
    } catch (e) {
      out[j] = { error: String(e.message || e) };
    }
  }
  return Response.json(out);
}

// ─── 入口 ───────────────────────────────────────────────────────────

/** 去掉 /news 前綴後的站內路徑；不在 /news 底下時回傳 null */
function sitePath(pathname) {
  if (pathname !== BASE && !pathname.startsWith(BASE + '/')) return null;
  return pathname.slice(BASE.length).replace(/\/+$/, '') || '/';
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = sitePath(url.pathname);
  let m;
  if (path === '/') return home(env);
  if (path === '/latest') return listPage(env, url, { title: '即時新聞', subtitle: '最新新聞，依時間排序', where: '', args: [], active: 'latest', base: `${BASE}/latest` });
  if ((m = path.match(/^\/category\/([a-z]+)\/feed\.xml$/)) && CATEGORY_MAP[m[1]]) return feed(env, url.origin, m[1]);
  if ((m = path.match(/^\/category\/([a-z]+)$/))) return categoryPage(env, url, m[1]);
  if ((m = path.match(/^\/source\/([a-z0-9]+)$/))) return sourcePage(env, url, m[1]);
  if ((m = path.match(/^\/article\/([0-9a-f]{16})$/))) return articlePage(env, url, m[1], ctx);
  if (path === '/daily') return dailyIndex(env);
  if ((m = path.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/))) return dailyPage(env, m[1]);
  if (path === '/search') return searchPage(env, url);
  if (path === '/feed.xml' || path === '/rss') return feed(env, url.origin);
  if (path === '/sitemap.xml') return sitemap(env, url.origin);
  if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${url.origin}${BASE}/sitemap.xml\n`);
  if (path === '/api/news') return api(env, url);
  if (path === '/api/status') return status(env);
  if (path === '/admin/refresh') return refresh(env, url);
  if (path === '/admin/extract') {
    if (!env.ADMIN_TOKEN || url.searchParams.get('token') !== env.ADMIN_TOKEN) return new Response('forbidden', { status: 403 });
    let html;
    try {
      html = (await extractFromUrl(url.searchParams.get('url') || '')) || '(擷取失敗：內容太少)';
    } catch (e) {
      html = `(擷取失敗：${e?.stack || e})`;
    }
    return new Response(html, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return notFound(env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // news.ek21.com 等子網域 → 主網域的 /news（與 dating 相同做法）
    const apex = SUBDOMAIN_TO_APEX[url.hostname];
    if (apex) {
      return Response.redirect(`https://${apex}${BASE}${url.pathname === '/' ? '' : url.pathname}${url.search}`, 308);
    }
    const path = sitePath(url.pathname);
    if (path === null) {
      // workers.dev 測試網址：導到 /news
      if (url.hostname.endsWith('.workers.dev')) return Response.redirect(`${url.origin}${BASE}${url.pathname === '/' ? '' : url.pathname}`, 302);
      // 路由 ek21.com/news* 也會比對到 /newsletter 之類不屬於本站的路徑，交回原本的伺服器
      return fetch(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    // 自訂網域上用 Cache API 快取頁面；workers.dev 上 Cache API 不生效也不影響功能
    const cache = caches.default;
    const cacheable = !path.startsWith('/admin') && path !== '/api/status';
    if (cacheable) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    try {
      const res = await route(request, env, ctx);
      if (cacheable && res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    } catch (e) {
      console.error(e);
      if (String(e.message || e).includes('no such table')) {
        return new Response('資料庫尚未初始化，請執行：npm run db:init', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      // 機器可讀的輸出照實回報錯誤；網頁則不讓讀者看到錯誤：先回首頁，首頁也失敗時顯示會自動重試的頁面（間隔拉長，避免大量讀者一起重試）
      if (/^\/(api|admin)\/|\.xml$|^\/rss$|^\/robots\.txt$/.test(path)) {
        return new Response('伺服器錯誤', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      if (path !== '/') return redirect(`${BASE}/`);
      return layout(env, {
        title: '新聞整理中',
        body: `${empty('新聞正在更新中，頁面將自動重新整理…')}<script>setTimeout(function(){location.reload()},60000)</script>`,
        status: 503,
      });
    }
  },

  async scheduled(event, env, ctx) {
    for (const job of jobsFor(env, event.scheduledTime)) {
      try {
        const stats = await runJob(env, job);
        console.log(`[cron] ${job}`, JSON.stringify(stats));
      } catch (e) {
        console.error(`[cron] ${job} failed`, e);
      }
    }
  },
};

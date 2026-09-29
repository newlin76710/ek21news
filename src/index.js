import { CATEGORIES, CATEGORY_MAP, SOURCE_MAP } from './config.js';
import { JOBS, fetchContent, jobsFor, runJob, twDay } from './ingest.js';
import { extractFromUrl } from './extract.js';
import { card, dayLabel, empty, esc, layout, listItem, pager, row, sectionHead, sidebar } from './render.js';

const PER_PAGE = 24;
const COLS = 'id, url, title, summary, image, source, category, published_at';

const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await q(env, sql, ...args).all()).results;

function pageNum(url) {
  const p = parseInt(url.searchParams.get('page') || '1', 10);
  return Number.isFinite(p) && p > 0 && p < 500 ? p : 1;
}

const latest = (env, n = 12) => all(env, `SELECT ${COLS} FROM articles ORDER BY published_at DESC LIMIT ?1`, n);

// ─── 頁面 ───────────────────────────────────────────────────────────

async function home(env) {
  const since = Date.now() - 3 * 86400_000;
  const [heroRows, side, perCat] = await Promise.all([
    all(env, `SELECT ${COLS} FROM articles WHERE image IS NOT NULL AND published_at > ?1 ORDER BY published_at DESC LIMIT 40`, Date.now() - 86400_000),
    latest(env, 15),
    all(
      env,
      `SELECT ${COLS} FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY (image IS NULL), published_at DESC) AS rn
         FROM articles WHERE published_at > ?1
       ) WHERE rn <= 7 ORDER BY published_at DESC`,
      since,
    ),
  ]);

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
      return `<section class="sec">${sectionHead(c.name, `/category/${c.slug}`, c.color)}${body}</section>`;
    })
    .join('');

  const heroHtml = hero.length
    ? `<section class="hero">${hero.map((a, i) => card(a, { big: i === 0 })).join('')}</section>`
    : '';
  const body = `${heroHtml}<div class="layout"><div>${sections || empty()}</div>${sidebar({ latest: side })}</div>`;
  return layout(env, { body, active: 'home' });
}

async function listPage(env, url, { title, subtitle, where, args, active, base, pre = '' }) {
  const page = pageNum(url);
  const [rows, side] = await Promise.all([
    all(
      env,
      `SELECT ${COLS} FROM articles ${where} ORDER BY published_at DESC LIMIT ?${args.length + 1} OFFSET ?${args.length + 2}`,
      ...args,
      PER_PAGE + 1,
      (page - 1) * PER_PAGE,
    ),
    active === 'latest' ? [] : latest(env, 10),
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
    base: `/category/${slug}`,
  });
}

async function sourcePage(env, url, id) {
  const s = SOURCE_MAP[id];
  if (!s) return notFound(env);
  const cat = url.searchParams.get('category');
  const chips = `<div class="chips" style="margin-bottom:18px"><a href="/source/${id}"${!cat ? ' class="on"' : ''}>全部</a>${CATEGORIES.map(
    (c) => `<a href="/source/${id}?category=${c.slug}"${cat === c.slug ? ' class="on"' : ''}>${c.name}</a>`,
  ).join('')}</div>`;
  return listPage(env, url, {
    title: s.name,
    subtitle: `來自 ${s.name}（${new URL(s.home).hostname}）的最新新聞`,
    where: CATEGORY_MAP[cat] ? 'WHERE source = ?1 AND category = ?2' : 'WHERE source = ?1',
    args: CATEGORY_MAP[cat] ? [id, cat] : [id],
    base: `/source/${id}`,
    pre: chips,
  });
}

async function searchPage(env, url) {
  const term = (url.searchParams.get('q') || '').trim().slice(0, 50);
  if (!term) return listPage(env, url, { title: '搜尋', subtitle: '請輸入關鍵字', where: 'WHERE 0', args: [], base: '/search' });
  const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
  return listPage(env, url, {
    title: `「${term}」的搜尋結果`,
    where: "WHERE title LIKE ?1 ESCAPE '\\' OR summary LIKE ?1 ESCAPE '\\'",
    args: [like],
    base: '/search',
  });
}

async function dailyIndex(env) {
  const days = await all(env, 'SELECT day, COUNT(*) AS n FROM articles GROUP BY day ORDER BY day DESC LIMIT 60');
  const body = `<div class="page-h"><h1>每日新聞</h1><p>每天自動整理當日新聞，依分類編成一份日報。</p></div>
${days.length ? `<div class="days">${days.map((d) => `<a href="/daily/${d.day}"><b>${esc(dayLabel(d.day))}</b><span>共 ${d.n} 則新聞</span></a>`).join('')}</div>` : empty()}`;
  return layout(env, { title: '每日新聞', body, active: 'daily' });
}

async function dailyPage(env, day) {
  const rows = await all(env, `SELECT ${COLS} FROM articles WHERE day = ?1 ORDER BY published_at DESC LIMIT 2000`, day);
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
      return `<section class="sec" id="${c.slug}">${sectionHead(`${c.name}（${items.length}）`, `/category/${c.slug}`, c.color)}
${withImg.length ? `<div class="grid">${withImg.map((a) => card(a)).join('')}</div>` : ''}
${rest.length ? `<ul class="list" style="margin-top:12px;background:var(--card);border-radius:12px;padding:4px 16px">${rest.map(listItem).join('')}</ul>` : ''}</section>`;
    })
    .join('');
  const prev = new Date(Date.parse(day + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
  const next = new Date(Date.parse(day + 'T00:00:00Z') + 86400_000).toISOString().slice(0, 10);
  const body = `<div class="page-h"><h1>${esc(dayLabel(day))} 新聞日報</h1><p>共 ${rows.length} 則新聞</p></div>
${toc}${sections}<nav class="pager"><a href="/daily/${prev}">‹ 前一天</a><a href="/daily">所有日報</a>${next <= twDay(Date.now()) ? `<a href="/daily/${next}">後一天 ›</a>` : '<span></span>'}</nav>`;
  return layout(env, { title: `${dayLabel(day)} 新聞日報`, description: `${dayLabel(day)}新聞彙整，共 ${rows.length} 則。`, body, active: 'daily' });
}

async function articlePage(env, url, id) {
  const a = await q(env, `SELECT ${COLS}, content, content_status FROM articles WHERE id = ?1`, id).first();
  if (!a) return notFound(env);
  // 還沒擷取過全文的文章，第一次被打開時即時擷取並存檔
  if (a.content_status === 0) a.content = await fetchContent(env.DB, a);
  const [related, side] = await Promise.all([
    all(env, `SELECT ${COLS} FROM articles WHERE category = ?1 AND id != ?2 ORDER BY published_at DESC LIMIT 6`, a.category, a.id),
    latest(env, 10),
  ]);
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
    mainEntityOfPage: `${url.origin}/news/${a.id}`,
  };
  // 全文裡已有圖片時不另外放封面，避免同一張圖出現兩次
  const showCover = a.image && !(a.content && a.content.includes('<figure>'));
  const bodyHtml = a.content
    ? `<div class="content">${a.content}</div>`
    : a.summary
      ? `<div class="content"><p>${esc(a.summary)}</p></div>`
      : '';
  const body = `<div class="layout"><div>
<article class="article">
  <a class="tag" href="/category/${a.category}" style="--c:${c?.color}">${esc(c?.name)}</a>
  <h1>${esc(a.title)}</h1>
  <div class="meta"><time datetime="${published}">${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'long', timeStyle: 'short' }).format(a.published_at)}</time></div>
  ${showCover ? `<div class="cover thumb"><img src="${esc(a.image)}" alt="${esc(a.title)}" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ''}
  ${bodyHtml}
  <p class="note">本文標題與摘要取自${esc(s?.name)}公開資訊，完整內容與版權屬原媒體所有。</p>
</article>
${related.length ? `<section class="sec" style="margin-top:28px">${sectionHead(`更多${c?.name}新聞`, `/category/${a.category}`, c?.color)}<div class="grid g3">${related.map((r) => card(r)).join('')}</div></section>` : ''}
</div>${sidebar({ latest: side })}</div>`;
  return layout(env, {
    title: a.title,
    description: a.summary || a.title,
    canonical: `${url.origin}/news/${a.id}`,
    body,
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
<rss version="2.0"><channel><title>${xmlEsc(title)}</title><link>${origin}/</link><description>${xmlEsc(env.SITE_TAGLINE || '')}</description><language>zh-TW</language>
${rows
  .map(
    (a) => `<item><title>${xmlEsc(a.title)}</title><link>${origin}/news/${a.id}</link><guid isPermaLink="false">${a.id}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate><category>${xmlEsc(CATEGORY_MAP[a.category]?.name)}</category><description>${xmlEsc(a.summary || '')}</description>${a.image ? `<enclosure url="${xmlEsc(a.image)}" type="image/jpeg" length="0"/>` : ''}</item>`,
  )
  .join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

async function sitemap(env, origin) {
  const [rows, days] = await Promise.all([
    all(env, 'SELECT id, published_at FROM articles ORDER BY published_at DESC LIMIT 2000'),
    all(env, 'SELECT DISTINCT day FROM articles ORDER BY day DESC LIMIT 60'),
  ]);
  const urls = [
    `${origin}/`,
    `${origin}/latest`,
    `${origin}/daily`,
    ...CATEGORIES.map((c) => `${origin}/category/${c.slug}`),
    ...days.map((d) => `${origin}/daily/${d.day}`),
  ].map((u) => `<url><loc>${u}</loc></url>`);
  for (const r of rows) urls.push(`<url><loc>${origin}/news/${r.id}</loc><lastmod>${new Date(r.published_at).toISOString()}</lastmod></url>`);
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(day || '')) where.push(`day = ?${args.push(day)}`);
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
  const [counts, runs] = await Promise.all([
    all(env, 'SELECT source, COUNT(*) AS n, MAX(published_at) AS newest FROM articles GROUP BY source'),
    all(env, 'SELECT at, job, stats FROM runs ORDER BY at DESC LIMIT 20'),
  ]);
  return Response.json(
    {
      sources: counts.map((c) => ({ ...c, newest: new Date(c.newest).toISOString() })),
      runs: runs.map((r) => ({ ...r, at: new Date(r.at).toISOString(), stats: JSON.parse(r.stats || '{}') })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

async function refresh(env, url) {
  const token = url.searchParams.get('token');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response('forbidden', { status: 403 });
  const job = url.searchParams.get('job') || 'all';
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

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let m;
  if (path === '/') return home(env);
  if (path === '/latest') return listPage(env, url, { title: '即時新聞', subtitle: '最新新聞，依時間排序', where: '', args: [], active: 'latest', base: '/latest' });
  if ((m = path.match(/^\/category\/([a-z]+)\/feed\.xml$/)) && CATEGORY_MAP[m[1]]) return feed(env, url.origin, m[1]);
  if ((m = path.match(/^\/category\/([a-z]+)$/))) return categoryPage(env, url, m[1]);
  if ((m = path.match(/^\/source\/([a-z0-9]+)$/))) return sourcePage(env, url, m[1]);
  if ((m = path.match(/^\/news\/([0-9a-f]{16})$/))) return articlePage(env, url, m[1]);
  if (path === '/daily') return dailyIndex(env);
  if ((m = path.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/))) return dailyPage(env, m[1]);
  if (path === '/search') return searchPage(env, url);
  if (path === '/feed.xml' || path === '/rss') return feed(env, url.origin);
  if (path === '/sitemap.xml') return sitemap(env, url.origin);
  if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${url.origin}/sitemap.xml\n`);
  if (path === '/api/news') return api(env, url);
  if (path === '/api/status') return status(env);
  if (path === '/admin/refresh') return refresh(env, url);
  if (path === '/admin/extract') {
    if (!env.ADMIN_TOKEN || url.searchParams.get('token') !== env.ADMIN_TOKEN) return new Response('forbidden', { status: 403 });
    const html = await extractFromUrl(url.searchParams.get('url') || '');
    return new Response(html || '(擷取失敗)', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  // 相容 ek21.com/news 的舊網址
  if ((m = path.match(/^\/news(?:\/category\/([a-z]+))?$/))) return Response.redirect(`${url.origin}${m[1] ? `/category/${m[1]}` : '/'}`, 301);
  return notFound(env);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    // 自訂網域上用 Cache API 快取頁面；workers.dev 上 Cache API 不生效也不影響功能
    const cache = caches.default;
    const cacheable = !new URL(request.url).pathname.startsWith('/admin') && !request.url.includes('/api/status');
    if (cacheable) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    try {
      const res = await route(request, env);
      if (cacheable && res.status === 200) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    } catch (e) {
      console.error(e);
      if (String(e.message || e).includes('no such table')) {
        return new Response('資料庫尚未初始化，請執行：npm run db:init', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      return new Response('伺服器錯誤', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
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

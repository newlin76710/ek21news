import { SOURCES } from './config.js';
import { classify } from './classify.js';
import { PARSERS, findOgImage } from './parse.js';
import { extractFromFragment, extractFromUrl, ruleFor } from './extract.js';

const UA = 'Mozilla/5.0 (compatible; ek21news-bot/1.0; +https://ek21.com/news/)';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 台灣時間的日期字串 YYYY-MM-DD */
export function twDay(ts) {
  return new Date(ts + 8 * HOUR).toISOString().slice(0, 10);
}

async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^from$|^fbclid$/.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function articleKey(source, url) {
  if (source.dedupeById) {
    const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)\/.*?(\d{5,})(?:[/?#]|$)/);
    if (m) return `${source.id}:${m[1]}:${m[2]}`;
  }
  return url;
}

async function fetchText(url, { timeout = 15000, maxBytes = 0 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(timeout),
    cf: { cacheTtl: 60 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!maxBytes) return res.text();
  // 只讀前 maxBytes（抓 og:image 時不必下載整頁）
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all);
}

function tuneImage(sourceId, image) {
  if (!image) return null;
  if (image.startsWith('//')) image = 'https:' + image;
  if (!/^https?:\/\//.test(image)) return null;
  // 三立 sitemap 給的是極小縮圖，換成較大的版本
  if (sourceId === 'setn') image = image.replace(/-XS\.jpg$/i, '-PH.jpg');
  return image;
}

/** 抓一個來源的 feed（預設全部），回傳整理好的文章列 */
export async function collectSource(source, now = Date.now(), feeds = source.feeds) {
  const rows = new Map();
  const titles = new Map();
  const errors = [];
  const results = await Promise.allSettled(
    feeds.map(async (feed) => ({ feed, items: PARSERS[feed.type](await fetchText(feed.url)) })),
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      errors.push(String(r.reason?.message || r.reason));
      continue;
    }
    const { feed, items } = r.value;
    for (const it of items) {
      const url = normalizeUrl(it.url);
      const key = it.key || articleKey(source, url);
      const hints = feed.hint ? [feed.hint, ...(it.hints || [])] : it.hints || [];
      let published = it.publishedAt || now;
      if (published > now + HOUR) published = now; // 未來時間視為現在
      if (published < now - 30 * DAY) continue; // 太舊的略過
      const prev = rows.get(key);
      const seenKey = titles.get(it.title);
      if (seenKey && seenKey !== key) continue; // 同來源同標題只留一則
      titles.set(it.title, key);
      // 同一篇同時出現在總覽與分類 feed 時，以分類 feed 的提示為準
      if (prev && (!feed.hint || feed.hint === 'local')) continue;
      rows.set(key, {
        key,
        url,
        title: it.title.slice(0, 300),
        summary: it.summary ? it.summary.slice(0, 400) : prev?.summary || null,
        image: tuneImage(source.id, it.image) || prev?.image || null,
        source: source.id,
        category: classify({ ...it, url, hints, candidates: feed.candidates }, source),
        raw_category: hints.filter(Boolean).slice(0, 5).join(',') || null,
        // 來自分類 feed 的判斷較可靠，寫入時可覆蓋先前由其他 feed 決定的分類
        strong: feed.hint ? 1 : 0,
        rawContent: it.contentHtml || prev?.rawContent || '',
        published_at: published,
        day: twDay(published),
      });
    }
  }
  for (const row of rows.values()) row.id = await sha1(row.key);
  return { rows: [...rows.values()], errors };
}

/** RSS 附全文的文章：只替資料庫裡還沒有全文的整理內文，避免每次排程重複處理 */
async function fillContentFromFeed(db, rows) {
  const candidates = rows.filter((r) => r.rawContent);
  const done = new Set();
  for (let i = 0; i < candidates.length; i += 90) {
    const ids = candidates.slice(i, i + 90).map((r) => r.id);
    const { results } = await db
      .prepare(`SELECT id FROM articles WHERE content_status = 1 AND id IN (${ids.map((_, j) => `?${j + 1}`).join(',')})`)
      .bind(...ids)
      .all();
    for (const r of results) done.add(r.id);
  }
  for (const r of candidates) {
    if (done.has(r.id)) continue;
    try {
      r.content = await extractFromFragment(r.rawContent, r.url);
    } catch {}
  }
}

export async function saveRows(db, rows, now = Date.now()) {
  await fillContentFromFeed(db, rows);
  const stmt = db.prepare(
    `INSERT INTO articles (id, url, title, summary, image, source, category, raw_category, published_at, fetched_at, day, content, content_status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?13, CASE WHEN ?13 IS NULL THEN 0 ELSE 1 END)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       summary = COALESCE(excluded.summary, articles.summary),
       image = COALESCE(articles.image, excluded.image),
       category = CASE WHEN ?12 = 1 THEN excluded.category ELSE articles.category END,
       raw_category = CASE WHEN ?12 = 1 THEN excluded.raw_category ELSE articles.raw_category END,
       content = COALESCE(articles.content, excluded.content),
       content_status = CASE WHEN articles.content IS NOT NULL THEN articles.content_status
                             WHEN excluded.content IS NOT NULL THEN 1 ELSE articles.content_status END`,
  );
  let written = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows
      .slice(i, i + 50)
      .map((r) =>
        stmt.bind(r.id, r.url, r.title, r.summary, r.image, r.source, r.category, r.raw_category, r.published_at, now, r.day, r.strong, r.content || null),
      );
    const res = await db.batch(batch);
    written += res.reduce((n, x) => n + (x.meta?.changes || 0), 0);
  }
  return written;
}

/** 替沒有圖片的新文章補 og:image（東森、自由時報的 feed 不附圖） */
export async function enrichImages(db, limit = 15) {
  const { results } = await db
    .prepare(
      `SELECT id, url FROM articles WHERE image IS NULL AND img_tried = 0 AND published_at > ?1
       ORDER BY published_at DESC LIMIT ?2`,
    )
    .bind(Date.now() - 2 * DAY, limit)
    .all();
  let found = 0;
  const updates = await Promise.all(
    results.map(async (r) => {
      let image = null;
      try {
        image = tuneImage('', findOgImage(await fetchText(r.url, { timeout: 6000, maxBytes: 96 * 1024 })));
      } catch {}
      if (image) found++;
      return db.prepare('UPDATE articles SET image = ?1, img_tried = 1 WHERE id = ?2').bind(image, r.id);
    }),
  );
  if (updates.length) await db.batch(updates);
  return { tried: results.length, found };
}

/** 抓文章頁、擷取全文並存檔。回傳整理好的 HTML，失敗回傳 null */
export async function fetchContent(db, article) {
  let content = null;
  try {
    content = await extractFromUrl(article.url);
  } catch {}
  await db
    .prepare('UPDATE articles SET content = ?1, content_status = ?2 WHERE id = ?3')
    .bind(content, content ? 1 : 2, article.id)
    .run();
  return content;
}

/** 預先替最新文章擷取全文，讓讀者打開時不必等待 */
export async function prefillContent(db, limit = 6) {
  const { results } = await db
    .prepare('SELECT id, url FROM articles WHERE content_status = 0 ORDER BY published_at DESC LIMIT ?1')
    .bind(limit * 3)
    .all();
  const todo = results.filter((r) => ruleFor(r.url)).slice(0, limit);
  const got = await Promise.all(todo.map((r) => fetchContent(db, r)));
  return { tried: todo.length, found: got.filter(Boolean).length };
}

export async function cleanup(db, retentionDays) {
  const cutoff = Date.now() - retentionDays * DAY;
  const r = await db.batch([
    db.prepare('DELETE FROM articles WHERE published_at < ?1').bind(cutoff),
    db.prepare('DELETE FROM runs WHERE at < ?1').bind(Date.now() - 7 * DAY),
  ]);
  return r[0].meta?.changes || 0;
}

// 排程工作清單：每個來源一個工作；feed 較大的來源（splitFeeds）每個 feed 各自一個工作，
// 讓每次執行的解析量維持在免費方案的 CPU 限制內。最後加一個補圖＋清理工作。
export const JOBS = [
  ...SOURCES.flatMap((s) => (s.splitFeeds ? s.feeds.map((_, i) => `${s.id}#${i}`) : [s.id])),
  'maintenance',
];

// 排程間隔（分鐘），需與 wrangler.toml 的 crons 一致
const CRON_MINUTES = 3;

export async function runJob(env, job) {
  const now = Date.now();
  const started = Date.now();
  let stats;
  if (job === 'maintenance') {
    const images = await enrichImages(env.DB);
    const content = await prefillContent(env.DB);
    const deleted = await cleanup(env.DB, Number(env.RETENTION_DAYS || 60));
    stats = { images, content, deleted };
  } else {
    const [id, feedIndex] = job.split('#');
    const source = SOURCES.find((s) => s.id === id);
    const feeds = feedIndex === undefined ? source?.feeds : source?.feeds.slice(+feedIndex, +feedIndex + 1);
    if (!source || !feeds?.length) throw new Error(`unknown job ${job}`);
    const { rows, errors } = await collectSource(source, now, feeds);
    const written = await saveRows(env.DB, rows, now);
    stats = { fetched: rows.length, written, errors };
  }
  stats.ms = Date.now() - started;
  await env.DB.prepare('INSERT INTO runs (at, job, stats) VALUES (?1, ?2, ?3)').bind(now, job, JSON.stringify(stats)).run();
  return stats;
}

/** 依排程時間挑出本次要跑的工作 */
export function jobsFor(env, scheduledTime) {
  if (env.FETCH_MODE === 'all') return JOBS;
  const slot = Math.floor(scheduledTime / (CRON_MINUTES * 60_000));
  return [JOBS[slot % JOBS.length]];
}

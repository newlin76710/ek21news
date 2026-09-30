import { SOURCES } from './config.js';
import { classify } from './classify.js';
import { PARSERS, findOgImage } from './parse.js';
import { extractFromFragment, extractFromUrl, ruleFor } from './extract.js';
import { addTodo, buildState, loadState, mergeItems, patchItem, saveState } from './state.js';

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

// 只用 RSS 內容的來源：不抓對方網站補圖或擷取全文
const RSS_ONLY = SOURCES.filter((s) => s.rssOnly).map((s) => s.id);
export const isRssOnly = (sourceId) => RSS_ONLY.includes(sourceId);

// 即時新聞剛發布時常只有一兩段，之後才補完：發布 6 小時內、內容偏短的文章，
// 距上次擷取超過 20 分鐘就重抓一次
const REFRESH_WINDOW = 6 * HOUR;
const REFRESH_EVERY = 20 * 60_000;
const SHORT_CONTENT = 1500; // 全文 HTML 長度（約 400 字）
// 擷取失敗時（對方網站回應慢，或像自由時報會對 Cloudflare 的請求不定時回 403），
// 發布 24 小時內每 2 小時重試一次，不頻繁打擾對方網站；失敗期間頁面顯示 RSS 摘要
const RETRY_WINDOW = 24 * HOUR;
const RETRY_EVERY = 2 * HOUR;

export function needsRefresh(a, now = Date.now()) {
  const since = now - (a.content_at || 0);
  const age = now - a.published_at;
  if (a.content_status === 2) return age < RETRY_WINDOW && since > RETRY_EVERY;
  return a.content_status === 1 && age < REFRESH_WINDOW && since > REFRESH_EVERY && (a.content || '').length < SHORT_CONTENT;
}

/** 抓文章頁、擷取全文並存檔。重抓失敗時保留原本的內容。回傳目前的全文（可能為 null） */
export async function fetchContent(db, article) {
  let content = null;
  const info = {};
  try {
    content = await extractFromUrl(article.url, info);
  } catch {}
  const now = Date.now();
  const stmts = [];
  // 沒有摘要的文章（東森、三立的新聞索引不附摘要），用頁面的 og:description 補上
  if (!article.summary && info.description) {
    article.summary = info.description.slice(0, 400);
    stmts.push(db.prepare('UPDATE articles SET summary = ?1 WHERE id = ?2').bind(article.summary, article.id));
  }
  stmts.push(
    content
      ? db.prepare('UPDATE articles SET content = ?1, content_status = 1, content_at = ?2 WHERE id = ?3').bind(content, now, article.id)
      : db
          .prepare('UPDATE articles SET content_status = CASE WHEN content IS NULL THEN 2 ELSE content_status END, content_at = ?1 WHERE id = ?2')
          .bind(now, article.id),
  );
  // 存檔失敗（例如超過 D1 每日寫入額度）不影響本次顯示，下次再重抓
  try {
    await db.batch(stmts);
  } catch (e) {
    console.error('fetchContent save failed', e);
  }
  return content || article.content || null;
}

// 排程每次都會拿到整份 feed，其中絕大多數是已存過的文章。只寫新文章：
// 比這個工作（來源或拆開的 feed）抓到的最新文章早 NEW_MARGIN 以上的直接略過，其餘先比對上次看過的 id，
// 沒看過的才查資料庫確認，所以每次排程通常只讀寫個位數的列
const NEW_MARGIN = 6 * HOUR;

/** 挑出資料庫裡還沒有的文章，寫入並更新 state。回傳寫入篇數 */
export async function saveRows(db, st, job, source, rows, now = Date.now()) {
  const cutoff = (st.meta.newest[job] || 0) - NEW_MARGIN;
  const seen = new Set(st.meta.seen[job] || []);
  const unknown = rows.filter((r) => r.published_at >= cutoff && !seen.has(r.id));
  const exists = new Set();
  for (let i = 0; i < unknown.length; i += 90) {
    const ids = unknown.slice(i, i + 90).map((r) => r.id);
    const { results } = await db
      .prepare(`SELECT id FROM articles WHERE id IN (${ids.map((_, j) => `?${j + 1}`).join(',')})`)
      .bind(...ids)
      .all();
    for (const r of results) exists.add(r.id);
  }
  const fresh = unknown.filter((r) => !exists.has(r.id));
  // RSS 附全文的文章（引新聞、台灣好新聞），寫入時一併存好全文
  for (const r of fresh) {
    if (!r.rawContent) continue;
    try {
      r.content = await extractFromFragment(r.rawContent, r.url);
    } catch {}
  }
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO articles (id, url, title, summary, image, source, category, raw_category, published_at, fetched_at, day, content, content_status, content_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CASE WHEN ?12 IS NULL THEN 0 ELSE 1 END, CASE WHEN ?12 IS NULL THEN 0 ELSE ?10 END)`,
  );
  let written = 0;
  for (let i = 0; i < fresh.length; i += 50) {
    const res = await db.batch(
      fresh
        .slice(i, i + 50)
        .map((r) => stmt.bind(r.id, r.url, r.title, r.summary, r.image, r.source, r.category, r.raw_category, r.published_at, now, r.day, r.content || null)),
    );
    written += res.reduce((n, x) => n + (x.meta?.changes || 0), 0);
  }

  const { front, meta } = st;
  if (fresh.length) {
    mergeItems(front, fresh);
    for (const r of fresh) {
      front.days[r.day] = (front.days[r.day] || 0) + 1;
      if (r.published_at > (meta.newest[job] || 0)) meta.newest[job] = r.published_at;
    }
    if (!source.rssOnly) {
      addTodo(
        meta,
        fresh
          .map((r) => ({ id: r.id, url: r.url, p: r.published_at, img: r.image ? 0 : 1, c: !r.content && ruleFor(r.url) ? 1 : 0, n: 0 }))
          .filter((t) => t.img || t.c),
      );
    }
  }
  // 記下這次 feed 裡的文章，下次不必再查資料庫；有查過資料庫才需要更新
  if (unknown.length) meta.seen[job] = rows.filter((r) => r.published_at >= cutoff).map((r) => r.id);
  await saveState(db, st, { front: fresh.length > 0, meta: unknown.length > 0 });
  return written;
}

/** 替沒有圖片的新文章補 og:image（東森、自由時報的 feed 不附圖）。只處理待辦清單裡的文章，不掃文章表 */
export async function enrichImages(db, st, limit = 15) {
  const now = Date.now();
  const todo = st.meta.todo.filter((t) => t.img && t.p > now - 2 * DAY).slice(0, limit);
  let found = 0;
  const updates = [];
  await Promise.all(
    todo.map(async (t) => {
      t.img = 0;
      let image = null;
      try {
        image = tuneImage('', findOgImage(await fetchText(t.url, { timeout: 6000, maxBytes: 96 * 1024 })));
      } catch {}
      if (!image) return;
      found++;
      patchItem(st.front, t.id, { image });
      updates.push(db.prepare('UPDATE articles SET image = ?1 WHERE id = ?2').bind(image, t.id));
    }),
  );
  if (updates.length) await db.batch(updates);
  return { tried: todo.length, found };
}

/** 下次該重抓全文的時間；不需要再抓回傳 null */
function nextTry(a, now) {
  const age = now - a.published_at;
  if (a.content_status === 0) return now;
  if (a.content_status === 2) return age < RETRY_WINDOW ? a.content_at + RETRY_EVERY : null;
  return age < REFRESH_WINDOW && (a.content || '').length < SHORT_CONTENT ? a.content_at + REFRESH_EVERY : null;
}

/** 預先替最新文章擷取全文（以及重抓剛發布的短內容），讓讀者打開時不必等待。只處理待辦清單 */
export async function prefillContent(db, st, limit = 6) {
  const now = Date.now();
  const todo = st.meta.todo.filter((t) => t.c && t.n <= now).slice(0, limit);
  if (!todo.length) return { tried: 0, found: 0 };
  const ids = todo.map((t) => t.id);
  const { results } = await db
    .prepare(
      `SELECT id, url, summary, content, content_status, content_at, published_at FROM articles
       WHERE id IN (${ids.map((_, j) => `?${j + 1}`).join(',')})`,
    )
    .bind(...ids)
    .all();
  const rows = new Map(results.map((r) => [r.id, r]));
  let tried = 0;
  let found = 0;
  await Promise.all(
    todo.map(async (t) => {
      const a = rows.get(t.id);
      // 文章已被刪除，或讀者打開時已經擷取過了
      let next = a ? nextTry(a, now) : null;
      if (a && next !== null && next <= now) {
        tried++;
        const hadSummary = a.summary;
        const got = await fetchContent(db, a);
        if (got && got !== a.content) found++;
        if (a.summary && a.summary !== hadSummary) patchItem(st.front, a.id, { summary: a.summary });
        const after = got ? { ...a, content: got, content_status: 1 } : { ...a, content_status: a.content ? a.content_status : 2 };
        next = nextTry({ ...after, content_at: now }, now);
      }
      if (next === null) t.c = 0;
      else t.n = next;
    }),
  );
  return { tried, found };
}

export async function cleanup(db, st, retentionDays) {
  const cutoff = Date.now() - retentionDays * DAY;
  const r = await db.prepare('DELETE FROM articles WHERE published_at < ?1').bind(cutoff).run();
  const oldest = twDay(cutoff);
  for (const d of Object.keys(st.front.days)) if (d < oldest) delete st.front.days[d];
  st.meta.todo = st.meta.todo.filter((t) => t.img || t.c);
  return r.meta?.changes || 0;
}

// 排程工作清單：每個來源一個工作；feed 較大的來源（splitFeeds）每個 feed 各自一個工作，
// 讓每次執行的解析量維持在免費方案的 CPU 限制內。最後加一個補圖＋清理工作。
export const JOBS = [
  ...SOURCES.flatMap((s) => (s.splitFeeds ? s.feeds.map((_, i) => `${s.id}#${i}`) : [s.id])),
  'maintenance',
];

// 排程間隔（分鐘），需與 wrangler.toml 的 crons 一致
const CRON_MINUTES = 3;

/** 讀取 state，不存在時從文章表重建並存檔 */
export async function getState(db, rebuild = false) {
  let st = rebuild ? null : await loadState(db);
  if (!st) {
    st = await buildState(db, { ruleFor, isRssOnly, splitSources: SOURCES.filter((s) => s.splitFeeds).map((s) => s.id) });
    await saveState(db, st, { front: true, meta: true });
  }
  return st;
}

// 執行結果只印在 log（wrangler tail／Cloudflare 後台可看），不寫資料庫
export async function runJob(env, job) {
  const now = Date.now();
  const st = await getState(env.DB);
  let stats;
  if (job === 'maintenance') {
    const before = st.meta.todo.length;
    const images = await enrichImages(env.DB, st);
    const content = await prefillContent(env.DB, st);
    const deleted = await cleanup(env.DB, st, Number(env.RETENTION_DAYS || 60));
    const touched = images.tried > 0 || content.tried > 0 || st.meta.todo.length !== before;
    await saveState(env.DB, st, { front: images.found > 0 || content.found > 0 || deleted > 0, meta: touched || deleted > 0 });
    stats = { images, content, deleted, todo: st.meta.todo.length };
  } else {
    const [id, feedIndex] = job.split('#');
    const source = SOURCES.find((s) => s.id === id);
    const feeds = feedIndex === undefined ? source?.feeds : source?.feeds.slice(+feedIndex, +feedIndex + 1);
    if (!source || !feeds?.length) throw new Error(`unknown job ${job}`);
    const { rows, errors } = await collectSource(source, now, feeds);
    const written = await saveRows(env.DB, st, job, source, rows, now);
    stats = { fetched: rows.length, written, errors };
  }
  stats.ms = Date.now() - now;
  return stats;
}

/** 依排程時間挑出本次要跑的工作 */
export function jobsFor(env, scheduledTime) {
  if (env.FETCH_MODE === 'all') return JOBS;
  const slot = Math.floor(scheduledTime / (CRON_MINUTES * 60_000));
  return [JOBS[slot % JOBS.length]];
}

// 預先整理好的資料，存在 state 表（每個 key 一列 JSON），減少 D1 的讀寫列數：
// - front：首頁、側欄、相關新聞、每日列表要用的資料。讀者打開頁面時只讀這一列，不必查文章表。
// - meta：排程用的資料（各來源最新時間、上次看過的文章、待補圖／待擷取全文清單）。
// 排程寫入新文章時一併更新；state 不存在時從文章表重建一次。

import { CATEGORIES } from './config.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// front 保存每個分類最新 PER_CAT 篇、全站最新 LATEST 篇
const PER_CAT = 20;
const LATEST = 40;
const SUMMARY_CHARS = 150;
const TODO_MAX = 400;

/** front 裡的文章只留頁面卡片用得到的欄位 */
export function slim(a) {
  return {
    id: a.id,
    title: a.title,
    summary: a.summary ? a.summary.slice(0, SUMMARY_CHARS) : null,
    image: a.image || null,
    source: a.source,
    category: a.category,
    published_at: a.published_at,
  };
}

async function load(db, k) {
  const r = await db.prepare('SELECT v FROM state WHERE k = ?1').bind(k).first();
  if (!r) return null;
  try {
    return JSON.parse(r.v);
  } catch {
    return null;
  }
}

export const loadFront = (db) => load(db, 'front');

export async function loadState(db) {
  const r = await db.prepare("SELECT k, v FROM state WHERE k IN ('front', 'meta')").all();
  const out = {};
  for (const row of r.results) {
    try {
      out[row.k] = JSON.parse(row.v);
    } catch {}
  }
  return out.front && out.meta ? { front: out.front, meta: out.meta } : null;
}

/** 只寫有變動的那幾列 */
export function saveState(db, st, { front = false, meta = false } = {}) {
  const stmts = [];
  const put = (k, v) => db.prepare('INSERT OR REPLACE INTO state (k, v) VALUES (?1, ?2)').bind(k, JSON.stringify(v));
  if (front) {
    st.front.at = Date.now();
    stmts.push(put('front', st.front));
  }
  if (meta) stmts.push(put('meta', st.meta));
  return stmts.length ? db.batch(stmts) : null;
}

/** 合併新文章：每個分類留最新 PER_CAT 篇，另留全站最新 LATEST 篇 */
export function mergeItems(front, rows) {
  const byId = new Map(front.items.map((a) => [a.id, a]));
  for (const r of rows) byId.set(r.id, slim(r));
  const sorted = [...byId.values()].sort((a, b) => b.published_at - a.published_at);
  const perCat = {};
  front.items = sorted.filter((a, i) => {
    perCat[a.category] = (perCat[a.category] || 0) + 1;
    return i < LATEST || perCat[a.category] <= PER_CAT;
  });
}

/** 修改 front 裡某篇文章的欄位（補到圖片或摘要時） */
export function patchItem(front, id, fields) {
  const a = front.items.find((x) => x.id === id);
  if (!a) return false;
  Object.assign(a, slim({ ...a, ...fields }));
  return true;
}

export function addTodo(meta, items) {
  const have = new Set(meta.todo.map((t) => t.id));
  for (const t of items) if (!have.has(t.id)) meta.todo.push(t);
  meta.todo.sort((a, b) => b.p - a.p);
  meta.todo = meta.todo.slice(0, TODO_MAX);
}

/**
 * 從文章表重建 state（只在 state 不存在或手動重建時執行）。
 * 每日篇數要掃過整張表，所以只在這裡算一次，之後隨新文章累加。
 */
export async function buildState(db, { ruleFor, isRssOnly, splitSources = [] }) {
  const now = Date.now();
  const COLS = 'id, title, summary, image, source, category, published_at';
  const res = await db.batch([
    db.prepare(`SELECT ${COLS} FROM articles ORDER BY published_at DESC LIMIT ?1`).bind(LATEST),
    ...CATEGORIES.map((c) =>
      db.prepare(`SELECT ${COLS} FROM articles WHERE category = ?1 ORDER BY published_at DESC LIMIT ?2`).bind(c.slug, PER_CAT),
    ),
    db.prepare('SELECT day, COUNT(*) AS n FROM articles GROUP BY day'),
    db.prepare('SELECT source, MAX(published_at) AS newest FROM articles GROUP BY source'),
    db
      .prepare(
        `SELECT id, url, source, published_at AS p, image IS NULL AS noimg, content_status AS cs, content_at AS ca, length(content) AS len
         FROM articles WHERE published_at > ?1`,
      )
      .bind(now - DAY),
  ]);
  const days = res.at(-3).results;
  const newest = res.at(-2).results;
  const recent = res.at(-1).results;
  const front = { items: [], days: Object.fromEntries(days.map((d) => [d.day, d.n])) };
  mergeItems(front, res.slice(0, -3).flatMap((r) => r.results));
  const meta = {
    // 各排程工作抓到的最新文章時間。拆成多個 feed 的來源無法得知每個 feed 的最新時間，
    // 留空：第一次執行時整份 feed 比對一次資料庫
    newest: Object.fromEntries(newest.filter((r) => !splitSources.includes(r.source)).map((r) => [r.source, r.newest])),
    seen: {},
    todo: [],
  };
  addTodo(
    meta,
    recent
      .filter((r) => !isRssOnly(r.source))
      .map((r) => ({
        id: r.id,
        url: r.url,
        p: r.p,
        img: r.noimg && r.p > now - 2 * DAY ? 1 : 0,
        c: r.cs === 0 || r.cs === 2 || (r.len || 0) < 1500 ? (ruleFor(r.url) ? 1 : 0) : 0,
        n: r.cs === 0 ? 0 : r.ca,
      }))
      .filter((t) => t.img || t.c),
  );
  return { front, meta };
}

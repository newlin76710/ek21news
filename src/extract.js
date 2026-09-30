// 全文擷取：用 Workers 內建的 HTMLRewriter 從文章頁（或 RSS 內文）取出段落、小標與圖片，
// 再重新組成乾淨的 HTML。來源的原始標籤一律不保留，只輸出轉義過的文字與圖片網址，避免 XSS。

import { decodeEntities } from './parse.js';
import { esc } from './render.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const kids = (root, tags) => tags.map((t) => `${root} > ${t}`);

// 各站規則：root = 內文容器；text = 段落／小標；img = 內文圖片；stop = 遇到這段文字後不再收錄
const RULES = [
  {
    host: /(^|\.)setn\.com$/,
    root: '#newsContent',
    text: kids('#newsContent', ['p', 'h2', 'h3']),
    img: kids('#newsContent', ['figure img', 'p img']),
    caption: kids('#newsContent', ['figure figcaption']),
  },
  {
    host: /(^|\.)ebc\.net\.tw$/,
    root: 'div.article_content',
    text: kids('div.article_content', ['p', 'h2', 'h3']),
    img: kids('div.article_content', ['p img', 'figure img']),
    caption: kids('div.article_content', ['figure figcaption']),
  },
  {
    // 自由時報各子網站（news、ec、ent、sports、health、estate、auto、playing、talk…）
    host: /(^|\.)ltn\.com\.tw$/,
    root: 'div.text',
    text: kids('div.text', ['p', 'h2', 'h3']),
    img: kids('div.text', ['div.photo img', 'p img', 'span.ph_b img']),
    caption: [],
  },
  {
    host: /(^|\.)kanfb\.com$/,
    root: 'div.entry-content',
    text: kids('div.entry-content', ['p', 'h2', 'h3', 'ul > li', 'ol > li']),
    img: kids('div.entry-content', ['figure img', 'p img', 'div.wp-block-image img']),
    caption: kids('div.entry-content', ['figure figcaption']),
  },
];

// RSS 內文（引新聞、台灣好新聞的 RSS 附完整內文）
const FRAGMENT_RULE = {
  root: '#rss-content',
  text: ['#rss-content p', '#rss-content h2', '#rss-content h3', '#rss-content li'],
  img: ['#rss-content img'],
  caption: ['#rss-content figcaption'],
  stop: /^更多新聞推薦/,
};

// 廣告、導購與站內宣傳文字
const JUNK =
  /^(請繼續往下閱讀|不用抽 不用搶|點我訂閱|一手掌握經濟脈動|東森新聞關心您|延伸閱讀|更多新聞|看更多|相關新聞|推薦閱讀|熱門新聞|本文未經授權|▸|►|※.*(下載|APP|訂閱))/;
// 開頭署名，例如「政治中心／綜合報導」
const BYLINE = /^[^\s。，！？]{2,16}／[^\s。，！？]{2,12}$/;

export function ruleFor(url) {
  try {
    const host = new URL(url).hostname;
    return RULES.find((r) => r.host.test(host)) || null;
  } catch {
    return null;
  }
}

function pickSrc(el) {
  for (const a of ['data-src', 'data-original', 'data-lazy-src', 'src']) {
    const v = el.getAttribute(a);
    if (v && !/^data:|spacer|default\d*\.|Working-|placeholder|blank\./i.test(v)) return v.trim();
  }
  return '';
}

/** 依規則串流解析 Response，回傳內文區塊 */
async function collect(response, rule, baseUrl, info = {}) {
  let rootIdx = 0;
  const blocks = [];
  let cur = null;
  // 包在連結裡的圖片多半是宣傳橫幅（下載 APP、專題活動），連結指向圖檔本身時除外
  let inPromoLink = 0;
  const rw = new HTMLRewriter()
    .on(rule.root, {
      element() {
        rootIdx++;
      },
    })
    .on(`${rule.root} a`, {
      element(el) {
        if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(el.getAttribute('href') || '')) return;
        try {
          el.onEndTag(() => {
            inPromoLink--;
          });
          inPromoLink++;
        } catch {} // 自我閉合的 <a/> 沒有結束標籤
      },
    });
  const textHandler = (kind) => ({
    element(el) {
      const tag = el.tagName.toLowerCase();
      cur = { type: kind === 'caption' ? 'caption' : tag === 'li' ? 'li' : /^h[1-6]$/.test(tag) ? 'h' : 'p', text: '', root: rootIdx };
      blocks.push(cur);
      const mine = cur;
      el.onEndTag(() => {
        if (cur === mine) cur = null;
      });
    },
    text(t) {
      if (cur) cur.text += t.text;
    },
  });
  for (const sel of rule.text) rw.on(sel, textHandler('text'));
  for (const sel of rule.caption || []) rw.on(sel, textHandler('caption'));
  for (const sel of rule.img) {
    rw.on(sel, {
      element(el) {
        if (inPromoLink > 0) return;
        let src = pickSrc(el);
        if (!src) return;
        try {
          src = new URL(src, baseUrl).toString();
        } catch {
          return;
        }
        if (!/^https?:\/\//.test(src)) return;
        blocks.push({ type: 'img', src, alt: decodeEntities(el.getAttribute('alt') || '').trim(), root: rootIdx });
      },
    });
  }
  // 頁面描述：全文擷取不到時（例如影音新聞頁沒有文字段落）拿來當摘要
  rw.on('meta[property="og:description"]', {
    element(el) {
      info.description = decodeEntities(el.getAttribute('content') || '').trim();
    },
  });
  await rw.transform(response).arrayBuffer();

  // 頁面上若有多個符合的容器，取文字最多的那個
  const byRoot = new Map();
  for (const b of blocks) byRoot.set(b.root, (byRoot.get(b.root) || 0) + (b.text?.length || 0));
  const bestRoot = [...byRoot.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return blocks.filter((b) => b.root === bestRoot);
}

/** 區塊 → 乾淨的 HTML；回傳 null 表示內容太少，視為擷取失敗 */
function toHtml(blocks, rule) {
  const out = [];
  const seenImg = new Set();
  let textLen = 0;
  let inList = false;
  let first = true;
  for (const b of blocks) {
    if (b.type === 'img') {
      if (seenImg.has(b.src)) continue;
      seenImg.add(b.src);
      if (inList) out.push('</ul>'), (inList = false);
      const cap = b.alt && b.alt.length > 6 && !/^圖$|^image$/i.test(b.alt) ? `<figcaption>${esc(b.alt)}</figcaption>` : '';
      out.push(`<figure><img src="${esc(b.src)}" alt="${esc(b.alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">${cap}</figure>`);
      continue;
    }
    const text = decodeEntities(b.text).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (rule.stop?.test(text)) break;
    if (JUNK.test(text)) continue;
    if (first && BYLINE.test(text)) continue;
    first = false;
    if (b.type === 'caption') {
      // 圖說接在上一張圖後面
      const last = out[out.length - 1];
      if (last?.startsWith('<figure>') && !last.includes('<figcaption>')) {
        out[out.length - 1] = last.replace('</figure>', `<figcaption>${esc(text)}</figcaption></figure>`);
      }
      continue;
    }
    textLen += text.length;
    if (b.type === 'li') {
      if (!inList) out.push('<ul>'), (inList = true);
      out.push(`<li>${esc(text)}</li>`);
      continue;
    }
    if (inList) out.push('</ul>'), (inList = false);
    out.push(b.type === 'h' ? `<h2>${esc(text)}</h2>` : `<p>${esc(text)}</p>`);
  }
  if (inList) out.push('</ul>');
  return textLen >= 80 ? out.join('\n') : null;
}

/**
 * 把整理好的全文截成最多 max 個字（只算文字，不算圖片）。
 * 全文由 toHtml() 產生，每行是一個 <p>/<h2>/<li>/<figure> 或 <ul>、</ul>，所以可以逐行處理。
 * 回傳 { html, truncated }
 */
export function excerptHtml(html, max = 300) {
  const out = [];
  let left = max;
  let truncated = false;
  let openList = false;
  for (const line of (html || '').split('\n')) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    if (line === '<ul>' || line === '</ul>') {
      openList = line === '<ul>';
      out.push(line);
      continue;
    }
    if (line.startsWith('<figure>')) {
      out.push(line);
      continue;
    }
    const m = line.match(/^<(p|h2|li)>([\s\S]*)<\/\1>$/);
    if (!m) continue;
    const text = decodeEntities(m[2]);
    if (text.length <= left) {
      out.push(line);
      left -= text.length;
    } else {
      out.push(`<${m[1]}>${esc(text.slice(0, left))}…</${m[1]}>`);
      left = 0;
      truncated = true;
    }
  }
  if (openList) out.push('</ul>');
  // 截斷後結尾不留孤立的圖片
  while (out.length && out[out.length - 1].startsWith('<figure>') && truncated) out.pop();
  return { html: out.join('\n'), truncated };
}

/** 從 RSS 附的內文 HTML 擷取 */
export async function extractFromFragment(html, baseUrl) {
  if (!html || html.length < 200) return null;
  const res = new Response(`<div id="rss-content">${html.replace(/<!\[CDATA\[|\]\]>/g, '')}</div>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return toHtml(await collect(res, FRAGMENT_RULE, baseUrl), FRAGMENT_RULE);
}

/** 抓文章頁並擷取全文；info.description 會填入頁面的 og:description */
export async function extractFromUrl(url, info = {}) {
  const rule = ruleFor(url);
  if (!rule) return null;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-TW,zh;q=0.9' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return toHtml(await collect(res, rule, res.url || url, info), rule);
}

// 輕量 XML / HTML 解析（Workers 沒有 DOMParser，用正規表示式處理 RSS 已足夠）。

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–' };

export function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function unCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function stripTags(html) {
  let s = unCdata(html || '');
  if (/<(script|style)/i.test(s)) s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function esc(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 取得所有 <name>…</name> 的內容 */
export function blocks(xml, name) {
  const re = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** 第一個 <name> 的純文字內容（已去 CDATA、解碼） */
export function text(xml, name) {
  const b = blocks(xml, name)[0];
  return b === undefined ? '' : decodeEntities(unCdata(b)).trim();
}

/** 取得 <name ... attr="x"> 的屬性值 */
export function attr(xml, name, attrName) {
  const re = new RegExp(`<${esc(name)}\\s[^>]*?\\b${esc(attrName)}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = xml.match(re);
  return m ? decodeEntities(m[1]) : '';
}

function firstImg(html) {
  const m = unCdata(html || '').match(/<img\s[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : '';
}

function parseDate(s) {
  if (!s) return 0;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : 0;
}

function summarize(s, max = 160) {
  const t = stripTags(s)
    .replace(/\[…\]|\[\.\.\.\]|\[&#8230;\]/g, '')
    .replace(/(\.{3}|…)+$/, '')
    // 去掉開頭的署名，例如「政治中心／綜合報導」
    .replace(/^[^\s。，！？]{2,16}／[^\s。，！？]{2,12}(報導)?\s+/, '')
    .trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** RSS 2.0 / Atom */
export function parseRss(xml) {
  const items = [];
  const isAtom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  for (const it of blocks(xml, isAtom ? 'entry' : 'item')) {
    const title = stripTags(text(it, 'title'));
    let link = isAtom ? attr(it, 'link', 'href') : text(it, 'link');
    if (!link) link = text(it, 'guid');
    if (!title || !/^https?:\/\//.test(link)) continue;

    const description = blocks(it, 'description')[0] || blocks(it, 'summary')[0] || '';
    const content = blocks(it, 'content:encoded')[0] || blocks(it, 'content')[0] || '';
    const image =
      attr(it, 'media:content', 'url') ||
      attr(it, 'media:thumbnail', 'url') ||
      (/<enclosure[^>]+type=["']image/i.test(it) ? attr(it, 'enclosure', 'url') : '') ||
      firstImg(content) ||
      firstImg(description);

    items.push({
      title,
      url: link.trim(),
      // 摘要只需要開頭一段；只處理前 1500 字元，避免長篇內文吃掉 CPU 時間
      summary: summarize((description || content).slice(0, 1500).replace(/<[^>]*$/, '')),
      // RSS 若附完整內文（引新聞、台灣好新聞），保留原始 HTML 供全文擷取
      contentHtml: content.length > 1200 ? content : description.length > 1200 ? description : '',
      image,
      publishedAt: parseDate(text(it, 'pubDate') || text(it, 'published') || text(it, 'updated') || text(it, 'dc:date')),
      hints: blocks(it, 'category').map((c) => stripTags(c)),
    });
  }
  return items;
}

/** Google News sitemap（東森、三立） */
export function parseNewsSitemap(xml) {
  const items = [];
  for (const u of blocks(xml, 'url')) {
    const url = text(u, 'loc');
    const title = stripTags(text(u, 'news:title'));
    if (!url || !title) continue;
    items.push({
      title,
      url,
      summary: '',
      image: text(u, 'image:loc'),
      publishedAt: parseDate(text(u, 'news:publication_date')),
      keywords: stripTags(text(u, 'news:keywords')),
      hints: [],
    });
  }
  return items;
}

/** 從文章頁 HTML 抓 og:image */
export function findOgImage(html) {
  const m =
    html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::url)?["']/i) ||
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : '';
}

export const PARSERS = { rss: parseRss, newsmap: parseNewsSitemap };

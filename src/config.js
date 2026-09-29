// 網站掛在主網域的這個路徑下（ek21.com/news），做法與 dating 相同：
// Cloudflare 路由 ek21.com/news* → 本 Worker，子網域 news.ek21.com 轉址到 ek21.com/news
export const BASE = '/news';

// 子網域 → 主網域（子網域以 Custom Domain 綁在本 Worker，進來後轉址到主網域的 /news）
export const SUBDOMAIN_TO_APEX = {
  'news.ek21.com': 'ek21.com',
  'news.ek21.com.tw': 'ek21.com.tw',
  'news.ek21.tw': 'ek21.tw',
};

// 網站分類。slug 沿用 ek21.com/news 的 life / politics / health / travel，再補齊其餘分類。
export const CATEGORIES = [
  { slug: 'politics', name: '政治', color: '#2563eb' },
  { slug: 'finance', name: '財經', color: '#d97706' },
  { slug: 'society', name: '社會', color: '#dc2626' },
  { slug: 'life', name: '生活', color: '#16a34a' },
  { slug: 'world', name: '國際', color: '#0891b2' },
  { slug: 'china', name: '兩岸', color: '#b91c1c' },
  { slug: 'entertainment', name: '娛樂', color: '#db2777' },
  { slug: 'sports', name: '體育', color: '#ea580c' },
  { slug: 'tech', name: '科技', color: '#7c3aed' },
  { slug: 'health', name: '健康', color: '#059669' },
  { slug: 'travel', name: '旅遊', color: '#0284c7' },
  { slug: 'consumer', name: '消費', color: '#c026d3' },
  { slug: 'local', name: '地方', color: '#65a30d' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]));

// 新聞來源。type 決定使用哪個解析器；hint 是該 feed 自帶的分類提示。
export const SOURCES = [
  {
    id: 'taiwanhot',
    name: '台灣好新聞',
    home: 'https://www.taiwanhot.net/',
    // 同一篇在 RSS 與首頁的網址不同（/news/1149490/… 與 /news/focus/1149490/…），以文章編號去重
    dedupeById: true,
    // 這幾個 RSS 附完整內文、每個約 250KB，拆成各自的排程工作
    splitFeeds: true,
    feeds: [
      // 「政經」頻道同時有政治與財經新聞，由標題關鍵字在兩者之間判斷
      { url: 'https://taiwanhot.net/rss/ed38812b', type: 'rss', hint: 'politics', candidates: ['politics', 'finance'] },
      { url: 'https://taiwanhot.net/rss/b5bbe67a', type: 'rss', hint: 'life' },
      { url: 'https://taiwanhot.net/rss/ed57970a', type: 'rss', hint: 'health' },
      { url: 'https://taiwanhot.net/rss/fa24f9a3', type: 'rss', hint: 'travel' },
      // 首頁補抓社會、財經、地方等沒有 RSS 的頻道
      { url: 'https://www.taiwanhot.net/', type: 'taiwanhot' },
    ],
  },
  {
    id: 'ebc',
    name: '東森新聞',
    home: 'https://news.ebc.net.tw/',
    feeds: [{ url: 'https://img.news.ebc.net.tw/EbcNews/Rss/sitemap.xml', type: 'newsmap' }],
  },
  {
    id: 'setn',
    name: '三立新聞',
    home: 'https://www.setn.com/',
    feeds: [{ url: 'https://www.setn.com/sitemapGoogleNews.xml', type: 'newsmap' }],
  },
  {
    id: 'innews',
    name: '引新聞',
    home: 'https://innews.com.tw/',
    feeds: [{ url: 'https://innews.com.tw/feed/', type: 'rss' }],
  },
  {
    id: 'ltn',
    name: '自由時報',
    home: 'https://news.ltn.com.tw/',
    // 同一篇會以不同縣市路徑重複出現（/news/life/… 與 /news/Kaohsiung/…），以文章編號去重
    dedupeById: true,
    feeds: [
      { url: 'https://news.ltn.com.tw/rss/all.xml', type: 'rss' },
      ...['politics', 'society', 'life', 'world', 'business', 'sports', 'entertainment', 'local', 'novelty'].map(
        (c) => ({ url: `https://news.ltn.com.tw/rss/${c}.xml`, type: 'rss', hint: c }),
      ),
    ],
  },
  {
    id: 'kanfb',
    name: '消費者時報',
    home: 'https://kanfb.com/',
    defaultCategory: 'consumer',
    feeds: [{ url: 'https://kanfb.com/feed', type: 'rss' }],
  },
];

export const SOURCE_MAP = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

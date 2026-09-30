# 尋夢新聞（ek21news）

參考 [ek21.com/news](https://ek21.com/news/) 重新製作的新聞聚合網站，整個網站是 serverless 的，直接跑在 **Cloudflare Workers + D1**。
排程會自動抓各家媒體的新聞，分類後寫進資料庫，每天自動產生當日新聞日報。

## 新聞來源

| 來源 | 抓取方式 | 分類依據 |
|---|---|---|
| 台灣好新聞 | RSS：政經、生活、健康、旅遊 4 個頻道（只用 RSS 內容，不抓對方網站） | RSS 頻道（「政經」再依標題分成政治或財經） |
| 東森新聞 | Google News sitemap | 網址路徑（`/news/politics/…`） |
| 三立新聞 | Google News sitemap | 標題＋關鍵字 |
| 引新聞 | RSS `innews.com.tw/feed/` | RSS category |
| 自由時報 | RSS：總覽＋9 個分類 feed | feed 分類／網址路徑 |
| 消費者時報 | RSS `kanfb.com/feed` | RSS category（預設為「消費」） |

新增或修改來源請編輯 `src/config.js`。

## 分類

政治、財經、社會、生活、國際、兩岸、娛樂、體育、科技、健康、旅遊、消費、地方（`src/classify.js`）。
分類方式是先看來源自帶的分類提示，沒有提示時用標題關鍵字計分。

## 頁面

以下路徑都在 `/news` 之下（例如 `/latest` 實際是 `ek21.com/news/latest`）。

- `/` 首頁：頭條輪播格＋各分類區塊＋即時新聞側欄
- `/latest` 即時新聞 · `/category/:slug` 分類
- `/daily` 每日新聞日報列表 · `/daily/YYYY-MM-DD` 當日依分類整理的日報
- `/article/:id` 單則新聞，站內直接閱讀全文
- `/search?q=` 搜尋
- `/feed.xml`、`/category/:slug/feed.xml` RSS 輸出 · `/sitemap.xml` · `/robots.txt`
- `/api/news?category=&source=&day=&limit=` JSON API · `/api/status` 抓取狀態
- `/admin/refresh?token=ADMIN_TOKEN&job=all` 手動更新
- `/admin/extract?token=ADMIN_TOKEN&url=文章網址` 測試某篇文章的全文擷取結果

## 部署

```bash
npm install
npx wrangler login
npx wrangler d1 create ek21news        # 把輸出的 database_id 貼到 wrangler.toml
npm run db:init                        # 在遠端 D1 建立資料表
npx wrangler secret put ADMIN_TOKEN    # 手動更新用的密碼
npm run deploy
# 部署後先手動抓一次，不用等排程：
curl "https://ek21.com/news/admin/refresh?token=<ADMIN_TOKEN>&job=all"
```

## 網域與路由（與 dating 相同做法）

網站掛在主網域的 `/news` 路徑下（`BASE`，見 `src/config.js`）：

| 設定 | 內容 |
|---|---|
| Worker 路由（Cloudflare 後台 → 各網域 → Workers Routes） | `ek21.com/news*`、`*.ek21.com/news*`，`ek21.com.tw`、`ek21.tw` 同樣各兩條 |
| Custom Domain（綁在 ek21news Worker） | `news.ek21.com`、`news.ek21.com.tw`、`news.ek21.tw`，程式會 308 轉址到對應主網域的 `/news/…` |
| workers.dev | `https://ek21news.ek21.workers.dev/` 會轉到 `/news` |

- 路由 `ek21.com/news*` 也會比對到 `/newsletter` 這類不屬於本站的路徑，這些請求會原封不動交回原本的伺服器。
- 所有頁面、API、管理網址都在 `/news` 底下，例如 `/news/admin/refresh`、`/news/api/status`；文章網址是 `/news/article/<id>`。
- 頁面快取（Cache API）只在自訂網域上生效。

## 排程

`wrangler.toml` 設定每 3 分鐘觸發一次。

- `FETCH_MODE = "rotate"`（預設）：每次只跑一個工作，共 11 個工作（台灣好新聞的 5 個 feed 各一個、其他 5 家來源各一個，再加 1 個「補圖／清理」），約 33 分鐘把全部來源更新一輪。這個模式是為了讓免費方案每次 10ms 的 CPU 限制也跑得動。
- `FETCH_MODE = "all"`：每次排程抓全部來源，建議付費方案使用。

「補圖／清理」工作會替東森、自由時報這類 feed 不附圖的新文章抓 og:image，並刪掉超過 `RETENTION_DAYS`（預設 60 天）的舊新聞。

## 本機開發

```bash
npm run db:init:local
echo "ADMIN_TOKEN=devtoken" > .dev.vars
npm run dev
curl "http://localhost:8787/news/admin/refresh?token=devtoken&job=all"
curl "http://localhost:8787/__scheduled?cron=*/3+*+*+*+*"   # 模擬排程
```

## 全文

- RSS 本身提供全文的來源（台灣好新聞、引新聞，在 `src/config.js` 設 `fullText: true`）：文章頁顯示全文。
- 其他來源：顯示內文前 300 字（`EXCERPT_CHARS`）。資料庫保存完整內文，改字數只要改這個設定。
- 每篇文末都附原文網址。

- 引新聞、台灣好新聞的 RSS 附完整內文，抓 RSS 時就整理好存進資料庫。
- 台灣好新聞設 `rssOnly: true`：只用 RSS 提供的標題、摘要、內文與圖片，不抓首頁、文章頁或 og:image。
- 其他來源（三立、東森、自由時報、消費者時報）：「補圖／清理」工作每次預先擷取最新 6 篇；還沒擷取到的文章，在第一次被打開時即時擷取並存檔。
- 擷取用 Workers 內建的 HTMLRewriter，各站的內文容器寫在 `RULES`。只輸出轉義過的段落、小標、清單和圖片，不保留來源的原始 HTML。廣告文字和包在連結裡的宣傳圖會被略過。
- 影音新聞頁沒有文字段落時，用頁面的 `og:description` 當摘要。
- 擷取失敗（`content_status = 2`）時改顯示 RSS 摘要，發布 24 小時內每 2 小時重試。自由時報會對來自 Cloudflare 的請求不定時回 HTTP 403，這些文章會顯示摘要，本站不嘗試繞過對方的封鎖。
- 即時新聞剛發布時常只有一兩段：發布 6 小時內、內容偏短的文章，距上次擷取超過 20 分鐘會重新擷取（`needsRefresh`）。
- 來源網站改版時，用 `/admin/extract` 測試，再調整 `RULES` 的選擇器。

畫面上不顯示新聞來源，只在文章頁底部保留一行「本文標題與摘要取自○○公開資訊，完整內容與版權屬原媒體所有。」

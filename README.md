# 尋夢新聞（ek21news）

參考 [ek21.com/news](https://ek21.com/news/) 重新製作的新聞聚合網站，整個網站是 serverless 的，直接跑在 **Cloudflare Workers + D1**。
排程會自動抓各家媒體的新聞，分類後寫進資料庫，每天自動產生當日新聞日報。

## 新聞來源

| 來源 | 抓取方式 | 分類依據 |
|---|---|---|
| 台灣好新聞 | RSS：政經、生活、健康、旅遊 4 個頻道，再加首頁補抓其他頻道 | RSS 頻道（「政經」再依標題分成政治或財經）／首頁頻道名稱 |
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

- `/` 首頁：頭條輪播格＋各分類區塊＋即時新聞側欄
- `/latest` 即時新聞 · `/category/:slug` 分類
- `/daily` 每日新聞日報列表 · `/daily/YYYY-MM-DD` 當日依分類整理的日報
- `/news/:id` 單則新聞，站內直接閱讀全文
- `/search?q=` 搜尋
- `/feed.xml`、`/category/:slug/feed.xml` RSS 輸出 · `/sitemap.xml` · `/robots.txt`
- `/api/news?category=&source=&day=&limit=` JSON API · `/api/status` 抓取狀態
- `/admin/refresh?token=ADMIN_TOKEN&job=all` 手動更新
- `/admin/extract?token=ADMIN_TOKEN&url=文章網址` 測試某篇文章的全文擷取結果
- 舊網址 `/news/category/life` 會 301 轉到 `/category/life`

## 部署

```bash
npm install
npx wrangler login
npx wrangler d1 create ek21news        # 把輸出的 database_id 貼到 wrangler.toml
npm run db:init                        # 在遠端 D1 建立資料表
npx wrangler secret put ADMIN_TOKEN    # 手動更新用的密碼
npm run deploy
# 部署後先手動抓一次，不用等排程：
curl "https://ek21news.<你的子網域>.workers.dev/admin/refresh?token=<ADMIN_TOKEN>&job=all"
```

要綁 `ek21.com` 的網域，在 `wrangler.toml` 加上 `routes = [{ pattern = "news.ek21.com", custom_domain = true }]`。
綁自訂網域後頁面快取（Cache API）才會生效。

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
curl "http://localhost:8787/admin/refresh?token=devtoken&job=all"
curl "http://localhost:8787/__scheduled?cron=*/3+*+*+*+*"   # 模擬排程
```

## 全文

文章頁直接顯示全文（`src/extract.js`），不連回原網站。

- 引新聞、台灣好新聞的 RSS 附完整內文，抓 RSS 時就整理好存進資料庫。
- 其他來源（三立、東森、自由時報、消費者時報、台灣好新聞首頁）：「補圖／清理」工作每次預先擷取最新 6 篇；還沒擷取到的文章，在第一次被打開時即時擷取並存檔。
- 擷取用 Workers 內建的 HTMLRewriter，各站的內文容器寫在 `RULES`。只輸出轉義過的段落、小標、清單和圖片，不保留來源的原始 HTML。廣告文字和包在連結裡的宣傳圖會被略過。
- 擷取失敗（`content_status = 2`）時改顯示摘要。
- 來源網站改版時，用 `/admin/extract` 測試，再調整 `RULES` 的選擇器。

畫面上不顯示新聞來源，只在文章頁底部保留一行「本文標題與摘要取自○○公開資訊，完整內容與版權屬原媒體所有。」

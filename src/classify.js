// 分類器：先看來源自帶的分類提示（網址路徑、RSS category、頻道名稱），
// 沒有可用提示時再用標題關鍵字計分。

const CITIES = [
  '台北', '臺北', '新北', '基隆', '桃園', '新竹', '苗栗', '台中', '臺中', '彰化', '南投', '雲林', '嘉義',
  '台南', '臺南', '高雄', '屏東', '宜蘭', '花蓮', '台東', '臺東', '澎湖', '金門', '馬祖', '連江', '離島',
  '雲嘉南', '北北基', '中彰投', '竹竹苗', '花東',
];

// 提示字 → 分類 slug（全部以小寫比對）
const HINTS = {
  politics: ['politics', 'def', 'talk', 'opinion', '政治', '政治頻道', '政治新聞', '政經', '國會', '軍武', '國防', '評論'],
  finance: [
    'business', 'finance', 'money', 'ec', 'estate', 'weeklybiz', 'stock', '財經', '財經頻道', '房產', '房市',
    '市場快訊', '工商', '股市', '理財', '產經', '經濟', '金融', '產業',
  ],
  society: ['society', 'crime', '社會', '社會頻道', '司法', '法律', '警政', '社會新聞'],
  life: ['life', 'living', 'novelty', 'food', 'art', '生活', '生活頻道', '善知識', '文教', '教育', '文化', '藝文', '宗教', '寵物', '環境', '氣象'],
  world: ['world', 'international', 'global', '國際', '全球', '國際新聞'],
  china: ['china', 'cross-strait', '兩岸', '大陸', '中國'],
  entertainment: ['entertainment', 'ent', 'star', 'showbiz', '娛樂', '影劇', '娛樂頻道', '明星', '影音', '引女郎', '引玩具', '動漫'],
  sports: ['sport', 'sports', '體育', '運動', '體育頻道'],
  tech: ['tech', '3c', 'technology', 'digital', '科技', '3c家電', '數位', '科學', 'ai'],
  health: ['health', '健康', '醫療', '醫藥', '健康選擇', '保健', '養生'],
  travel: ['travel', 'playing', 'trip', '旅遊', '旅行', '觀光', '休閒', '旅遊美食'],
  consumer: ['consumer', 'market', 'istyle', 'auto', '消費', '生活風格', '品牌', '好物', '開箱', '美食', '汽車', '時尚', '美妝'],
  local: ['local', '地方', '地方頻道', '地方新聞', ...CITIES],
};

const HINT_LOOKUP = new Map();
for (const [slug, words] of Object.entries(HINTS)) {
  for (const w of words) HINT_LOOKUP.set(w.toLowerCase(), slug);
}

// 標題關鍵字 → 分類。權重 2 的字幾乎可以單獨決定分類。
const KEYWORDS = {
  politics: [
    ['立法院', 2], ['立委', 2], ['總統', 2], ['賴清德', 2], ['民進黨', 2], ['國民黨', 2], ['民眾黨', 2], ['藍白', 2],
    ['行政院', 2], ['監察院', 2], ['外交部', 2], ['參選', 2], ['選舉', 2], ['罷免', 2], ['公投', 2], ['黨團', 2],
    ['議員', 1], ['市長', 1], ['縣長', 1], ['政府', 1], ['國防', 1], ['院長', 1], ['部長', 1], ['綠營', 2], ['藍營', 2],
  ],
  finance: [
    ['台股', 2], ['美股', 2], ['股價', 2], ['ETF', 2], ['央行', 2], ['營收', 2], ['房市', 2], ['房價', 2], ['建案', 2],
    ['匯率', 2], ['財報', 2], ['關稅', 2], ['升息', 2], ['降息', 2], ['通膨', 2], ['油價', 1], ['經濟', 1], ['投資', 1],
    ['金控', 2], ['壽險', 2], ['外資', 2], ['加權指數', 2], ['GDP', 2], ['股', 1], ['億元', 1], ['商辦', 2],
  ],
  society: [
    ['警方', 2], ['警察', 2], ['車禍', 2], ['詐騙', 2], ['毒品', 2], ['性侵', 2], ['起訴', 2], ['判刑', 2], ['地檢署', 2],
    ['法院', 1], ['逮捕', 2], ['火警', 2], ['火災', 2], ['身亡', 2], ['陳屍', 2], ['酒駕', 2], ['竊', 1], ['搶', 1],
    ['殺', 2], ['槍', 1], ['嫌犯', 2], ['死亡', 1], ['墜樓', 2], ['猥褻', 2], ['緩刑', 2], ['羈押', 2], ['派出所', 2],
  ],
  world: [
    ['美國', 1], ['川普', 2], ['日本', 1], ['韓國', 1], ['南韓', 1], ['北韓', 2], ['俄羅斯', 2], ['普丁', 2], ['烏克蘭', 2],
    ['以色列', 2], ['伊朗', 2], ['歐盟', 2], ['英國', 1], ['法國', 1], ['德國', 1], ['聯合國', 2], ['印度', 1],
    ['白宮', 2], ['北約', 2], ['菲律賓', 1], ['越南', 1], ['泰國', 1], ['國際', 1],
  ],
  china: [
    ['中共', 2], ['習近平', 2], ['解放軍', 2], ['國台辦', 2], ['陸委會', 2], ['兩岸', 2], ['大陸', 1], ['中國', 1],
    ['共軍', 2], ['香港', 1], ['北京', 1], ['陸客', 2],
  ],
  entertainment: [
    ['女星', 2], ['男星', 2], ['藝人', 2], ['歌手', 2], ['演唱會', 2], ['電影', 1], ['影集', 2], ['綜藝', 2], ['金鐘', 2],
    ['金馬', 2], ['金曲', 2], ['偶像', 1], ['啦啦隊', 2], ['網紅', 1], ['韓星', 2], ['Netflix', 2], ['新劇', 2],
    ['主持人', 2], ['女團', 2], ['男團', 2], ['再婚', 1], ['緋聞', 2], ['正妹', 1],
  ],
  sports: [
    ['亞運', 2], ['奧運', 2], ['棒球', 2], ['中職', 2], ['MLB', 2], ['NBA', 2], ['籃球', 2], ['足球', 2], ['網球', 2],
    ['羽球', 2], ['桌球', 2], ['金牌', 2], ['銀牌', 2], ['銅牌', 2], ['球隊', 2], ['TPBL', 2], ['PLG', 2], ['中華隊', 2],
    ['馬拉松', 2], ['高爾夫', 2], ['大谷', 2], ['世界盃', 2], ['選手', 1], ['冠軍', 1], ['全壘打', 2], ['投手', 2],
  ],
  tech: [
    ['AI', 2], ['輝達', 2], ['台積電', 2], ['iPhone', 2], ['蘋果', 1], ['手機', 1], ['晶片', 2], ['半導體', 2],
    ['科技', 2], ['5G', 2], ['電動車', 2], ['特斯拉', 2], ['Google', 2], ['微軟', 2], ['OpenAI', 2], ['App', 1],
    ['資安', 2], ['駭客', 2], ['機器人', 2], ['無人機', 2], ['衛星', 1], ['筆電', 2], ['Android', 2],
  ],
  health: [
    ['醫師', 2], ['醫生', 2], ['醫院', 2], ['疫苗', 2], ['癌', 2], ['流感', 2], ['新冠', 2], ['COVID', 2], ['病', 1],
    ['健康', 1], ['營養', 2], ['減重', 2], ['失智', 2], ['中醫', 2], ['手術', 2], ['症狀', 2], ['血壓', 2], ['血糖', 2],
    ['睡眠', 1], ['保健', 2], ['疾病', 2], ['衛福部', 2], ['疾管署', 2], ['健保', 2],
  ],
  travel: [
    ['旅遊', 2], ['景點', 2], ['飯店', 2], ['旅行', 2], ['觀光', 2], ['出國', 1], ['機票', 2], ['露營', 2], ['步道', 2],
    ['秘境', 2], ['自由行', 2], ['住宿', 2], ['旅客', 1], ['遊客', 1], ['賞楓', 2], ['賞花', 2], ['郵輪', 2],
  ],
  consumer: [
    ['優惠', 2], ['折扣', 2], ['開箱', 2], ['推薦', 1], ['品牌', 1], ['消費', 2], ['超商', 2], ['餐廳', 1], ['美食', 1],
    ['新品', 2], ['百貨', 2], ['周年慶', 2], ['週年慶', 2], ['購物', 2], ['好市多', 2], ['全聯', 2], ['CP值', 2],
    ['限定', 1], ['買一送一', 2], ['比較', 1], ['選購', 2],
  ],
  local: [['縣府', 2], ['市府', 1], ['鄉公所', 2], ['鎮公所', 2], ['區公所', 2], ['里長', 2], ['在地', 1]],
  life: [
    ['天氣', 2], ['氣象', 2], ['颱風', 2], ['地震', 2], ['連假', 2], ['捷運', 1], ['高鐵', 1], ['台鐵', 1], ['學校', 1],
    ['教師', 1], ['中秋', 1], ['下雨', 2], ['降雨', 2], ['高溫', 2], ['低溫', 2], ['寒流', 2], ['鋒面', 2], ['垃圾', 1],
  ],
};

/** 從網址中取出可能的分類提示（子網域、英文路徑片段）。 */
export function hintsFromUrl(url) {
  try {
    const u = new URL(url);
    const hints = [u.hostname.split('.')[0]];
    for (const seg of u.pathname.split('/')) {
      if (/^[a-z][a-z0-9-]{1,20}$/i.test(seg)) hints.push(seg);
    }
    return hints;
  } catch {
    return [];
  }
}

function fromHints(hints) {
  let local = null;
  for (const raw of hints) {
    if (!raw) continue;
    const h = String(raw).trim().toLowerCase();
    let slug = HINT_LOOKUP.get(h);
    if (!slug && h.endsWith('頻道')) slug = HINT_LOOKUP.get(h.slice(0, -2));
    if (!slug) continue;
    // 「地方」和縣市名稱優先權最低：同一篇若另有政治、社會等分類，以那個為準
    if (slug === 'local') local = local || slug;
    else return slug;
  }
  return local;
}

function fromKeywords(text, only) {
  let best = null;
  let bestScore = 0;
  for (const [slug, words] of Object.entries(KEYWORDS)) {
    if (only && !only.includes(slug)) continue;
    let score = 0;
    for (const [w, weight] of words) if (text.includes(w)) score += weight;
    if (score > bestScore) {
      best = slug;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

/**
 * @param {{title: string, summary?: string, keywords?: string, hints?: string[], url?: string, candidates?: string[]}} item
 * @param {{defaultCategory?: string}} source
 */
export function classify(item, source = {}) {
  // feed 限定了候選分類（例如「政經」＝政治或財經）時，只在候選中比對
  if (item.candidates?.length) {
    const text = `${item.title} ${item.keywords || ''}`;
    return fromKeywords(text, item.candidates) || item.candidates[0];
  }
  const hints = [...(item.hints || []), ...(item.url ? hintsFromUrl(item.url) : [])];
  const byHint = fromHints(hints);
  if (byHint && byHint !== 'local') return byHint;

  const text = `${item.title} ${item.keywords || ''}`;
  const byTitle = fromKeywords(text) || fromKeywords(`${text} ${(item.summary || '').slice(0, 120)}`);
  if (byTitle) return byTitle;
  if (byHint) return byHint;
  return source.defaultCategory || 'life';
}

const fs = require("fs");
const path = require("path");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");

    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  "gemini-2.5-flash"
];

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Missing GEMINI_API_KEY"
    });
  }

  const payload = req.body || {};

  const {
    destination,
    days,
    style,
    base,
    notes,
    cities,
    places,
    pace,
    tripName,
    start,
    end
  } = payload;

  const finalDestination =
    destination ||
    (Array.isArray(cities) ? cities.join("、") : cities) ||
    "未指定";

  const finalNotes =
    notes ||
    (Array.isArray(places) ? places.join("、") : places) ||
    "無";

  const systemPrompt = `
你是一位專業旅遊規劃師，請依照使用者需求產生「可直接套用到 App」的 JSON 行程。

重要規則：

1. 每一天必須以「同一區域 / 鄰近區域」為主，不要早上在城東、下午跳城西、晚上又跨城市。

2. 多城市旅行時，請把城市分段安排，例如：
- 上海 2 天
- 蘇州 2 天
- 杭州 2 天

不要每天來回亂跳。

3. 每天景點順序要符合地理邏輯，盡量順路。

4. 每個點之間請估算交通時間。

5. 每天最多安排 4～6 個主要行程，不要塞爆。

6. 每天至少安排午餐、晚餐或休息時間。

7. 若有長距離移動，請明確標示「交通移動」。

8. Google Maps query 請放可搜尋的地點名稱，不要放空。

9. 只回傳 JSON，不要加 Markdown，不要加說明文字。

10. 如果使用者有指定想去的景點、城市、餐廳或地區，必須優先安排這些地點。

11. 不要主動加入距離很遠、跨城市、跨區域的景點，除非使用者明確要求。

12. 若指定地點太多，請依照距離分成不同天，不要硬塞同一天。

13. 若某些指定地點彼此距離太遠，請仍然安排，但要分日處理。

14. 可以補充附近順路景點，但補充景點必須接近使用者指定地點。

15. 不可以用知名景點取代使用者指定景點。

JSON 格式如下：

{
  "title": "旅程標題",
  "summary": "一句話摘要",
  "days": [
    {
      "day": 1,
      "date": "",
      "city": "城市",
      "area": "主要區域",
      "routeSummary": "今天路線邏輯，例如：外灘 → 南京東路 → 人民廣場",
      "items": [
        {
          "time": "09:30",
          "type": "景點 / 餐飲 / 交通 / 休息 / 購物 / 住宿",
          "title": "行程名稱",
          "area": "區域",
          "note": "簡短說明",
          "transportToNext": "前往下一站約 15 分鐘，建議步行 / 地鐵 / 打車",
          "mapQuery": "Google Maps 可搜尋地點"
        }
      ]
    }
  ]
}
`;

  const userPrompt = `
使用者旅遊需求如下：

旅程名稱：${tripName || "未命名旅程"}
目的地：${finalDestination}
旅遊天數：${days || 3}
旅行日期：${start || "未指定"} ～ ${end || "未指定"}
旅遊風格：${style || "輕鬆順路"}
旅行步調：${pace || "normal"}
住宿 / 出發地：${base || "未指定"}

特別想去的地方 / 必去清單：
${finalNotes}

請優先使用上述必去清單安排行程。

如果需要補充景點，
只能補充與必去清單順路、同區域、距離近的地點。

不要自行加入很遠的熱門景點。

若指定地點彼此距離太遠，
請分配到不同天，不要硬塞同一天。

若使用者已提供明確景點清單，行程中至少 70% 的景點必須來自使用者指定清單。

請嚴格依照「目的地」安排行程，不可以產生目的地以外的城市或國家。
如果目的地是日本，就只能安排日本相關城市與景點，不可以出現上海、蘇州、杭州等中國地點。

請產生 AI 行程 V2。

請務必遵守：
- 同一天同區域或鄰近區域
- 多城市要分段，不要每天跨城
- 加入交通時間
- 每天有 routeSummary
- 每個 item 都要有 mapQuery
`;

  const finalPrompt = `
${systemPrompt}

${userPrompt}
`;

  try {

    let geminiRes;
    let data;
    let lastError;

    for (const model of GEMINI_MODELS) {

      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      for (let i = 0; i < 3; i++) {

        geminiRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: finalPrompt
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: "application/json"
            }
          })
        });

        data = await geminiRes.json();

        if (geminiRes.ok) {
          lastError = null;
          break;
        }

        lastError = data;

        await new Promise(resolve =>
          setTimeout(resolve, 1500)
        );
      }

      if (geminiRes && geminiRes.ok) {
        break;
      }
    }

    if (!geminiRes || !geminiRes.ok) {
      return res.status(geminiRes?.status || 500).json({
        error: "Gemini API error",
        detail: lastError
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        error: "Gemini returned empty response",
        detail: data
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      return res.status(500).json({
        error: "Failed to parse Gemini JSON",
        raw: text
      });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({
      error: "Generate itinerary failed",
      message: err.message
    });
  }
};
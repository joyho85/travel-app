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

  const body = req.body || {};

  const {
    tripName,
    destination,
    area,
    budget,
    travelerType,
    hotelStyle,
    preferredArea,
    notes,
    days,
    start,
    end,
    currentItinerary
  } = body;

  const itineraryText = Array.isArray(currentItinerary)
    ? currentItinerary
        .slice(0, 30)
        .map(item => `Day ${item.day || "?"}｜${item.time || ""}｜${item.type || ""}｜${item.name || ""}`)
        .join("\n")
    : "無";

  const prompt = `
你是一位專業旅宿選址顧問與自由行旅遊編輯。

請依照使用者需求，推薦 6 間適合的住宿。

重要規則：

1. 必須是真實存在、可被 Google Maps 搜尋到的住宿
2. 可以推薦飯店、旅館、公寓式酒店、溫泉旅宿或設計旅宿
3. 不要推薦無法確認名稱的模糊住宿，例如「某某區民宿」
4. 優先推薦交通方便、評價穩定、適合自由行安排的住宿
5. 推薦區域要盡量符合行程動線，不要全部分散到很遠
6. 如果使用者有指定希望區域或避開條件，必須優先遵守
7. 如果使用者有長輩、親子或情侶需求，要明確說明適合原因
8. 地圖搜尋文字請使用「住宿名稱 + 城市或區域」
9. 只回傳 JSON
10. 不要 Markdown
11. 不要解說文字

JSON 格式：

{
  "hotels": [
    {
      "name": "住宿名稱",
      "area": "推薦區域",
      "priceLevel": "預算等級",
      "style": "住宿風格",
      "bestFor": "適合族群",
      "reason": "推薦理由",
      "nearby": "附近可搭配地點",
      "mapQuery": "Google Maps 搜尋文字"
    }
  ]
}

使用者需求：

旅行名稱：
${tripName || "未指定"}

目的地：
${destination || "未指定"}

城市 / 區域：
${area || "未指定"}

旅行日期：
${start || "未指定"} ～ ${end || "未指定"}

旅行天數：
${days || "未指定"}

預算：
${budget || "不限"}

同行類型：
${travelerType || "不限"}

住宿風格：
${hotelStyle || "不限"}

希望區域 / 避開區域：
${preferredArea || "無"}

其他需求：
${notes || "無"}

目前行程：
${itineraryText}

請用繁體中文。
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
                    text: prompt
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
          setTimeout(resolve, 1200)
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
        error: "Gemini returned empty response"
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({
        error: "Failed to parse Gemini JSON",
        raw: text
      });
    }

    return res.status(200).json(parsed);

  } catch (err) {

    return res.status(500).json({
      error: "Generate hotels failed",
      message: err.message
    });

  }
};

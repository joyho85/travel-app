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
    city,
    area,
    foodType,
    budget,
    vibe,
    notes,
    favoriteBrand,
    mealTime
  } = body;

  const prompt = `
你是一位專業在地美食旅遊編輯。

請依照使用者需求，
推薦 6 間適合的餐廳或美食店。

重要規則：

1. 必須是真實存在的店家
2. 優先推薦當地人氣、口碑不錯的店
3. 不要全部都是觀光客店
4. 店家要盡量集中同區域
5. 避免推薦距離很遠的店
6. 店名必須可被 Google Maps 搜尋
7. 如果使用者有指定偏好品牌或店家，必須優先推薦
8. 不可用其他熱門店取代使用者指定品牌
9. 若該城市沒有該品牌，可推薦風格接近店家
10. 只回傳 JSON
11. 不要 Markdown
12. 不要解說文字

JSON 格式：

{
  "foods": [
    {
      "name": "店名",
      "type": "類型",
      "area": "區域",
      "reason": "推薦理由",
      "signature": "推薦必吃",
      "bestTime": "適合時段",
      "mapQuery": "Google Maps 搜尋文字"
    }
  ]
}

使用者需求：

城市：
${city || "未指定"}

區域：
${area || "未指定"}

想吃類型：
${foodType || "未指定"}

預算：
${budget || "不限"}

用餐時段：
${mealTime || "不限"}

偏好品牌 / 店家：
${favoriteBrand || "無"}

其他需求：
${notes || "無"}

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
              temperature: 0.8,
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
      error: "Generate food failed",
      message: err.message
    });

  }
};
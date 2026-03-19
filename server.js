require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// API Keys - 從環境變數讀取
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// 檢查 API Key 是否設定
if (!GOOGLE_API_KEY || !TAVILY_API_KEY) {
  console.error('⚠️ 請在 Zeabur 設定環境變數 GOOGLE_API_KEY 和 TAVILY_API_KEY');
}

// 資料庫路徑
const LEADS_FILE = path.join(__dirname, 'leads.json');

// 初始化資料庫
if (!fs.existsSync(LEADS_FILE)) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify([]));
}

function getLeads() {
  return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
}

function saveLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// Tavily 搜尋函數
async function tavilySearch(query) {
  const response = await axios.post('https://api.tavily.com/search', {
    query: query,
    api_key: TAVILY_API_KEY,
    max_results: 5  // 減少到 5 個結果
  }, { timeout: 15000 });
  return response.data.results || [];
}

// Gemini AI 分析函數（深度單一分析）
async function analyzeTargetDeep(targetName, allData) {
  // 整理所有參考來源
  const sourcesText = allData.map((d, i) => `【來源 ${i+1}】
標題：${d.title}
網址：${d.url}
內容：${d.content}`).join('\n\n');

  const prompt = `你是一個專業的業務顧問，請根據以下關於「${targetName}」的深度資料，進行全面分析。

【伴讀精靈產品介紹】
- 價格：27,000 TWD
- 產品：AI 助教服務（安裝在 LINE@）
- 功能：幫老師處理學生問題、自動回覆學員問題、教材導讀、個人化學習輔導
- 隱藏價值：建立私域流量、養客、未來可群發活動、24/7自動化服務、可服務無限學生

【重要】分析對象可能是：知識付費講師、公司、工作室、自由業者、或其他身份。請根據搜到的資料自動判斷對方的身份類型。

【收集到的參考資料】
${sourcesText}

請用 JSON 格式回傳以下欄位（如果找不到該欄位資料，請用 null）：

{
  "name": "對象名稱",
  "identity_type": "身份類型（自動判斷：知識付費講師/公司/工作室/自由業者/個人工作者/其他）",
  "niche": "細分領域（例如：健身教練、雅思考試、理財投資、AI工具教學、電商、顧問服務等）",
  "line": "LINE ID 或 LINE@（所有找到的）",
  "phone": "電話號碼（所有找到的）",
  "email": "電子郵件（所有找到的）",
  "fb": "Facebook 粉絲團或粉專連結（所有找到的）",
  "other_contact": "其他聯繫方式（IG、Telegram等）",
  "score": 成交率評分（0-100 的整數，根據：1.他的業務是否需要 AI 助教 2.他是否有痛點 3.27,000是否能負擔 4.買了能否幫他賺更多 5.他是否願意嘗試新工具）",
  "analysis": {
    "identity_summary": "對方身份概述（你認為他是什麼身份，做什麼的）",
    "strengths": "優勢分析（他有哪些特點讓他可能需要伴讀精靈）",
    "weaknesses": "劣勢分析（哪些因素可能阻礙他購買）",
    "opportunities": "機會分析（市場趨勢對他有利嗎）",
    "threats": "威脅分析（競爭對手或其他因素）",
    "talk_strategy": "談判策略（如何跟他開啟對話）"
  },
  "reason": "整體評估總結（100字以內）",
  "talk_tips": "具體談判切入點（3個具體建議，如何跟這位潛在客戶開啟話題）"
}

只回傳 JSON，不要其他文字。`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
      }
    );
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error('Gemini 深度分析失敗:', error.message);
  }
  return null;
}

// 首頁
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 深度分析 API
app.post('/api/analyze', async (req, res) => {
  const { target, force } = req.body;
  
  if (!target) {
    res.json({ error: '請輸入分析對象名稱' });
    return;
  }
  
  try {
    console.log('【開始深度分析】：' + target);
    
    // ====== 深度搜尋階段 ======
    // 對這個人/公司進行多維度搜尋（不限身份）
    const searchKeywords = [
      target,                          // 直接搜本人/公司
      target + ' 課程',                // 確認是否有教學
      target + ' 教學',                // 教學相關
      target + ' 收費',                // 商業模式
      target + ' 價格',                // 報價
      target + ' LINE',               // LINE 聯繫
      target + ' FB',                 // FB 粉絲團
      target + ' IG',                 // IG 帳號
      target + ' 評價',               // 口碑
      target + ' 評論',               // 評論
      target + ' 公司',               // 公司型態
      target + ' 工作室',             // 工作室型態
      target + ' 作品',               // 專業作品
      target + ' 影片',               // 影片/內容
      target + ' 新聞',               // 最新動態
      target + ' 創業'                // 創業/變現
    ];
    
    console.log('執行 ' + searchKeywords.length + ' 個關鍵字搜尋...');
    
    // 並行搜尋所有關鍵字
    const searches = searchKeywords.map(kw => tavilySearch(kw));
    const searchResults = await Promise.all(searches);
    
    // 合併所有結果並去除重複
    const combinedData = searchResults.flat();
    const uniqueData = combinedData.filter((item, index, self) => 
      index === self.findIndex(d => d.url === item.url)
    );
    
    console.log('找到 ' + uniqueData.length + ' 個獨特來源');
    
    // ====== AI 深度分析 ======
    console.log('開始 AI 深度分析...');
    
    const aiAnalysis = await analyzeTargetDeep(target, uniqueData.slice(0, 8));
    
    if (!aiAnalysis) {
      res.json({ error: 'AI 分析失敗，請稍後再試' });
      return;
    }
    
    // 建立結果
    const result = {
      id: uuidv4(),
      target: target,
      // 基本資料
      name: aiAnalysis.name,
      niche: aiAnalysis.niche,
      line: aiAnalysis.line,
      phone: aiAnalysis.phone,
      email: aiAnalysis.email,
      fb: aiAnalysis.fb,
      other_contact: aiAnalysis.other_contact,
      // 評分
      score: aiAnalysis.score || 0,
      reason: aiAnalysis.reason || '',
      // 詳細分析
      analysis: aiAnalysis.analysis || {},
      talk_tips: aiAnalysis.talk_tips || '',
      // 參考來源（可隱藏）
      sources: uniqueData.slice(0, 8).map(d => ({
        title: d.title,
        url: d.url,
        content: d.content
      })),
      // 基本資料
      source: '深度分析 (' + uniqueData.length + ' 個來源)',
      status: 'new',
      createdAt: new Date().toISOString()
    };
    
    // 儲存到資料庫
    const allLeads = getLeads();
    allLeads.unshift(result); // 放在最前面
    saveLeads(allLeads);
    
    console.log('分析完成！');
    
    res.json({ 
      success: true, 
      result: result,
      message: '完成！深度分析了 ' + target
    });
    
  } catch (error) {
    console.error('分析失敗:', error.message);
    res.json({ error: '分析失敗: ' + error.message });
  }
});

// 取得所有分析記錄
app.get('/api/leads', (req, res) => {
  const leads = getLeads();
  res.json(leads);
});

// 更新狀態
app.post('/api/leads/update', (req, res) => {
  const { id, status, notes } = req.body;
  const leads = getLeads();
  const index = leads.findIndex(l => l.id === id);
  
  if (index >= 0) {
    leads[index] = { 
      ...leads[index], 
      status, 
      notes,
      updatedAt: new Date().toISOString() 
    };
    saveLeads(leads);
  }
  
  res.json({ success: true });
});

// 刪除記錄
app.delete('/api/leads/:id', (req, res) => {
  const { id } = req.params;
  const leads = getLeads().filter(l => l.id !== id);
  saveLeads(leads);
  res.json({ success: true });
});

// 匯出 CSV
app.get('/api/leads/export', (req, res) => {
  const leads = getLeads();
  
  const csv = [
    '對象,賽道,LINE,電話,Email,FB,成交率,評估原因,狀態,建立日期',
    ...leads.map(l => `"${l.target}","${l.niche}","${l.line || ''}","${l.phone || ''}","${l.email || ''}","${l.fb || ''}",${l.score},${l.reason},${l.status},${l.createdAt}`)
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=analyze.csv');
  res.send('\ufeff' + csv);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Leads Analysis V2 running on port ' + PORT);
});

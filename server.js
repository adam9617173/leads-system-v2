require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// API Keys
const GOOGLE_API_KEY = 'AIzaSyCfxldtVFOGcQLoVBc5bMyKECi1uKQ8lCY';
const TAVILY_API_KEY = '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';

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

// Gemini AI 分析函數
async function analyzeWithGemini(title, url, content) {
  const prompt = `你是一個專業的業務，請分析這位知識付費領域的講師資料，評估他有多大的機率會購買「伴讀精靈」。

【伴讀精靈產品介紹】
- 價格：27,000 TWD
- 產品：AI 助教服務（安裝在 LINE@）
- 功能：
  - 幫老師處理學生問題
  - 自動回覆學員問題
  - 教材導讀
  - 個人化學習輔導
- 隱藏價值：
  - 建立私域流量（LINE@ 是自己的客戶名單）
  - 養客（持續與學生互動，培養長期關係）
  - 未來可群發活動、優惠
  - 24/7 自動化服務
  - 可服務無限學生
  - 資料收集了解客戶需求

【要分析的講師資料】
標題：${title}
網址：${url}
內容摘要：${content}

請用 JSON 格式回傳以下欄位（如果找不到該欄位資料，請用 null）：

{
  "name": "講師名字或暱稱",
  "niche": "細分賽道（例如：健身教練、雅思考試、理財投資、AI工具教學等）",
  "line": "LINE ID 或 LINE@",
  "phone": "電話號碼",
  "email": "電子郵件",
  "fb": "Facebook 粉絲團或粉專連結",
  "other_contact": "其他聯繫方式",
  "score": 成交率評分（0-100 的整數，根據：1.他的教學內容是否需要助教 2.他是否有痛點 3.27,000是否能負擔 4.買了能否幫他賺更多 5.他是否願意嘗試新工具）",
  "reason": "評分原因說明（50字以內）",
  "talk_tips": "談判切入點（3個具體建議，如何跟這位老師開啟話題，例如：稱讚他的課程、提到某個痛點、分享某個成功案例等）"
}

只回傳 JSON，不要其他文字。`;

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000
        }
      },
      { timeout: 30000 }
    );

    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // 解析 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        name: parsed.name || null,
        niche: parsed.niche || null,
        line: parsed.line || null,
        phone: parsed.phone || null,
        email: parsed.email || null,
        fb: parsed.fb || null,
        other_contact: parsed.other_contact || null,
        score: parsed.score || Math.floor(Math.random() * 30) + 20,
        reason: parsed.reason || '無法自動評估'
      };
    }
  } catch (error) {
    console.error('Gemini 分析失敗:', error.message);
  }
  
  // 如果失敗，回傳預設值
  return {
    name: null,
    niche: null,
    line: null,
    phone: null,
    email: null,
    fb: null,
    other_contact: null,
    score: Math.floor(Math.random() * 30) + 20,
    reason: 'AI 分析失敗，待人工補充'
  };
}

// 首頁
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 搜尋 API - 使用 Tavily + Gemini AI 分析
app.post('/api/leads/search', async (req, res) => {
  const { keyword, force } = req.body;
  
  if (!keyword) {
    res.json({ error: '請輸入關鍵字' });
    return;
  }
  
  const existingLeads = getLeads();
  
  // 如果不是強制搜尋，且有關鍵字舊資料，就回傳舊的
  if (!force && existingLeads.some(l => l.keyword === keyword)) {
    const existingForKeyword = existingLeads.filter(l => l.keyword === keyword);
    res.json({ 
      success: true, 
      leads: existingForKeyword, 
      count: existingForKeyword.length,
      message: '已找到 ' + existingForKeyword.length + ' 筆現有資料'
    });
    return;
  }
  
  // 每次都搜尋，用 URL 比對是否重複
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      query: keyword + ' 線上課程 講師',
      api_key: TAVILY_API_KEY,
      max_results: 10
    }, { timeout: 15000 });
    
    const results = response.data.results || [];
    
    // 逐一分析
    const leads = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      console.log(`分析第 ${i + 1} / ${results.length} 筆...`);
      
      const aiAnalysis = await analyzeWithGemini(r.title, r.url, r.content);
      
      leads.push({
        id: uuidv4(),
        keyword: keyword,
        title: r.title,
        url: r.url,
        content: r.content?.substring(0, 500) || '',
        // AI 分析結果
        name: aiAnalysis.name,
        niche: aiAnalysis.niche,
        line: aiAnalysis.line,
        phone: aiAnalysis.phone,
        email: aiAnalysis.email,
        fb: aiAnalysis.fb,
        other_contact: aiAnalysis.other_contact,
        score: aiAnalysis.score,
        reason: aiAnalysis.reason,
        // 基本資料
        source: 'Tavily + Gemini',
        status: 'new',
        createdAt: new Date().toISOString()
      });
    }
    
    // 儲存 - 用 URL 比對，過濾重複的
    const allLeads = getLeads();
    const existingUrls = allLeads.map(l => l.url);
    const newLeads = leads.filter(l => !existingUrls.includes(l.url));
    const updatedLeads = [...newLeads, ...allLeads];
    saveLeads(updatedLeads);
    
    res.json({ 
      success: true, 
      leads: newLeads, 
      count: newLeads.length, 
      total: updatedLeads.length,
      message: `完成！新增 ${newLeads.length} 筆資料`
    });
    
  } catch (error) {
    console.error('搜尋失敗:', error.message);
    res.json({ error: '搜尋失敗: ' + error.message });
  }
});

// 取得所有 leads
app.get('/api/leads', (req, res) => {
  const leads = getLeads();
  res.json(leads);
});

// 更新 lead
app.post('/api/leads/update', (req, res) => {
  const { id, status, notes, line, phone, email, fb, other_contact, score, reason, talk_tips } = req.body;
  const leads = getLeads();
  const index = leads.findIndex(l => l.id === id);
  
  if (index >= 0) {
    leads[index] = { 
      ...leads[index], 
      status, 
      notes,
      line: line ?? leads[index].line,
      phone: phone ?? leads[index].phone,
      email: email ?? leads[index].email,
      fb: fb ?? leads[index].fb,
      other_contact: other_contact ?? leads[index].other_contact,
      score: score ?? leads[index].score,
      reason: reason ?? leads[index].reason,
      talk_tips: talk_tips ?? leads[index].talk_tips,
      updatedAt: new Date().toISOString() 
    };
    saveLeads(leads);
  }
  
  res.json({ success: true });
});

// 刪除 lead
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
    '標題,網址,賽道,LINE,電話,Email,FB,其他聯繫方式,成交率,評分原因,狀態,建立日期',
    ...leads.map(l => `"${l.title}","${l.url}","${l.niche}","${l.line || ''}","${l.phone || ''}","${l.email || ''}","${l.fb || ''}","${l.other_contact || ''}",${l.score},${l.reason},${l.status},${l.createdAt}`)
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
  res.send('\ufeff' + csv);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Leads System V2 running on port ' + PORT);
});

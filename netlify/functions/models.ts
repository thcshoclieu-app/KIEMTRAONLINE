import { Handler } from '@netlify/functions';
import { GoogleGenAI } from "@google/genai";
import { PRIORITY_MODELS, normalizeModelName, maskApiKey } from './utils';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const apiKey = body.apiKey;
    const authHeader = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    
    const finalApiKey = apiKey?.trim() || authHeader || process.env.GEMINI_API_KEY;

    if (!finalApiKey) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Không tìm thấy API Key hợp lệ. Không thể tiếp tục xử lý." })
      };
    }

    const ai = new GoogleGenAI({ apiKey: finalApiKey });
    const response = await ai.models.list();
    const models: { name: string; displayName: string; supportedGenerationMethods?: string[] }[] = [];
    
    for await (const m of response) {
      if (m.name.includes("robotics")) continue;

      if (m.name.includes("gemini")) {
        let displayName = m.displayName || m.name.replace("models/", "");
        if (m.name.includes("flash-lite")) displayName = "3.1 Flash-Lite";
        else if (m.name === "models/gemini-3.5-flash") displayName = "Gemini 3.5 Flash";
        else if (m.name === "models/gemini-2.5-flash") displayName = "Gemini 2.5 Flash";
        else if (m.name.includes("pro-preview")) displayName = "3.1 Pro";
        
        models.push({
          name: m.name,
          displayName: displayName,
          supportedGenerationMethods: (m as any).supportedGenerationMethods,
        });
      }
    }
    
    if (models.length === 0) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Không tìm thấy model phù hợp để tạo đề kiểm tra." })
      };
    }

    const generateModels = models.filter(m => {
      const methods = m.supportedGenerationMethods || [];
      return methods.includes("generateContent") && !m.name.includes("embedding") && !m.name.includes("imagen") && !m.name.includes("tts") && !m.name.includes("veo");
    });
    
    const availableList = generateModels.length > 0 ? generateModels : models;

    availableList.sort((a, b) => {
      const indexA = PRIORITY_MODELS.indexOf(normalizeModelName(a.name));
      const indexB = PRIORITY_MODELS.indexOf(normalizeModelName(b.name));

      const scoreA = indexA === -1 ? 999 : indexA;
      const scoreB = indexB === -1 ? 999 : indexB;

      return scoreA - scoreB;
    });

    console.log("Model ưu tiên sau khi sort:", availableList.map(m => m.name));
    const preferredModel = availableList.length > 0 ? availableList[0].name : "models/gemini-3.5-flash";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: availableList, preferredModel })
    };

  } catch (error: any) {
    console.error("Error fetching models:", error?.message || error);
    
    if (error?.message?.includes("API key not valid") || error?.status === 401) {
       return {
         statusCode: 401,
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ error: "Gemini API Key không hợp lệ." })
       };
    }
    if (error?.status === 403) {
       return {
         statusCode: 403,
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ error: "API Key hiện tại không có quyền truy cập Gemini API." })
       };
    }
    const errMsgStr = String(error?.message || error || "").toLowerCase();
    if (error?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
       return {
         statusCode: 429,
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ error: "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút." })
       };
    }
    
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Không thể tải danh sách model từ Gemini API." })
    };
  }
};

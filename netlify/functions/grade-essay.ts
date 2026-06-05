import { Handler } from '@netlify/functions';
import { GoogleGenAI, Type } from "@google/genai";
import { buildCandidateModels, generateContentWithFallback } from './utils';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { promptText, essayAnswer, essayAttachment, selectedModel, availableModels, apiKey, maxScore = 10 } = JSON.parse(event.body || '{}');
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
    const candidateModels = buildCandidateModels(selectedModel, availableModels);
    
    const parts: any[] = [];
    const textPrompt = `Bạn là giáo viên chấm điểm bài thi tự luận khách quan và chính xác.
ĐỀ BÀI:
${promptText}

BÀI LÀM CỦA HỌC SINH:
${essayAnswer}

Hãy chấm điểm bài làm của học sinh (thang điểm ${maxScore}) và đưa ra nhận xét ngắn gọn. Trả về kết quả dưới dạng JSON với trường 'score' (kiểu số) và 'comments' (kiểu chuỗi).`;

    parts.push({ text: textPrompt });

    if (essayAttachment) {
      try {
         const mimeMatch = essayAttachment.match(/^data:([^;]+);base64,/);
         if (mimeMatch) {
           const mimeResponse = mimeMatch[1];
           const b64Data = essayAttachment.replace(/^data:[^;]+;base64,/, "");
           parts.push({
             inlineData: { mimeType: mimeResponse, data: b64Data }
           });
         }
      } catch (e) {}
    }

    const buildPayload = (model: string) => ({
      model: model,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: `Điểm của bài làm theo thang điểm ${maxScore}` },
            comments: { type: Type.STRING, description: "Nhận xét của giáo viên về bài làm" }
          },
          required: ["score", "comments"]
        }
      }
    });

    const genResult = await generateContentWithFallback(ai, candidateModels, buildPayload);

    if (!genResult || !genResult.response || !genResult.response.text) {
      throw new Error("No response");
    }

    let parsedData;
    const rawText = genResult.response.text || "";
    try {
      parsedData = JSON.parse(rawText.normalize('NFC'));
      parsedData.usedModel = genResult.usedModel;
    } catch (e: any) {
      const jsonMatch = rawText.match(/```json\n([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          parsedData = JSON.parse(jsonMatch[1].normalize('NFC'));
          parsedData.usedModel = genResult.usedModel;
        } catch(e2: any) {
          throw new Error("Mô hình AI trả về dữ liệu không đúng định dạng JSON: " + e2.message);
        }
      } else {
        throw new Error("Kết quả từ AI không phải là JSON. Chi tiết lỗi: " + e.message);
      }
    }
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedData)
    };

  } catch (err: any) {
    console.error(`Error grading essay:`, err?.message || err);
    let errorMsg = err?.message || "There was an error grading.";
    if (err?.message?.includes("API key not valid") || err?.status === 403 || err?.status === 401) {
       errorMsg = "API Key hiện tại không có quyền truy cập model Gemini phù hợp.";
    } else {
       const errMsgStr = String(err?.message || err || "").toLowerCase();
       if (err?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
          errorMsg = "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút hoặc đổi API Key khác.";
       }
    }
    
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: errorMsg })
    };
  }
};

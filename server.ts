import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";

const PRIORITY_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash"
];

function normalizeModelName(modelName?: string) {
  if (!modelName) return "";
  return modelName.replace("models/", "").trim();
}

function buildCandidateModels(selectedModel?: string, availableModels?: any[] | string[]) {
  const candidates = new Set<string>();
  const normalizedSelected = normalizeModelName(selectedModel);
  if (normalizedSelected) {
    candidates.add(normalizedSelected);
  }
  
  if (availableModels && availableModels.length > 0) {
    const availStr = availableModels.map((m: any) => typeof m === 'string' ? normalizeModelName(m) : normalizeModelName(m.name));
    PRIORITY_MODELS.forEach(pm => {
      if (availStr.includes(pm)) {
        candidates.add(pm);
      }
    });
  } else {
    PRIORITY_MODELS.forEach(pm => candidates.add(pm));
  }
  
  return Array.from(candidates);
}

function isRetryableGeminiError(error: any) {
  const status = error?.status;
  const msg = (error?.message || "").toLowerCase();
  
  if (status === 401 || msg.includes("api key not valid")) {
    return false;
  }
  
  if ([403, 404, 429, 500, 502, 503, 504].includes(status)) return true;
  
  const retryableKeywords = ["quota", "rate limit", "overloaded", "unavailable", "not found", "permission", "model", "exhausted", "resource exhausted", "503", "429"];
  for (const keyword of retryableKeywords) {
    if (msg.includes(keyword)) return true;
  }
  
  return false;
}

async function generateContentWithFallback(ai: any, candidateModels: string[], buildPayload: (model: string) => any) {
  let lastError = null;

  console.log(`Candidate Gemini models: ${JSON.stringify(candidateModels)}`);

  for (const model of candidateModels) {
    try {
      console.log("Trying Gemini model:", model);
      const payload = buildPayload(model);
      const response = await ai.models.generateContent(payload);
      console.log("Using Gemini model:", model);
      return { response, usedModel: model };
    } catch (error: any) {
      lastError = error;
      console.error("Gemini model failed:", model, error?.message || error);

      if (!isRetryableGeminiError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Không có Gemini model nào gọi được.");
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  // Increase payload limit for large files
  app.use(express.json({ limit: "50mb" }));

  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "****";
    return key.substring(0, 6) + "****" + key.substring(key.length - 4);
  };

  app.post("/api/models", async (req, res) => {
    const { apiKey } = req.body;
    const finalApiKey = apiKey?.trim() || req.headers['authorization']?.replace('Bearer ', '') || process.env.GEMINI_API_KEY;
    try {
      if (!finalApiKey) {
        return res.status(401).json({ error: "Không tìm thấy API Key hợp lệ. Không thể tiếp tục xử lý." });
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
        return res.status(403).json({ error: "Không tìm thấy model phù hợp để tạo đề kiểm tra." });
      }

      // Lọc các model có hỗ trợ generateContent
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

      res.json({ models: availableList, preferredModel });
    } catch (error: any) {
      console.error(`Error fetching models with API key ${maskApiKey(finalApiKey || '')}:`, error?.message || error);
      if (error?.message?.includes("API key not valid") || error?.status === 401) {
         return res.status(401).json({ error: "Gemini API Key không hợp lệ." });
      }
      if (error?.status === 403) {
         return res.status(403).json({ error: "API Key hiện tại không có quyền truy cập Gemini API." });
      }
      const errMsgStr = String(error?.message || error || "").toLowerCase();
      if (error?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
         return res.status(429).json({ error: "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút." });
      }
      return res.status(500).json({ error: "Không thể tải danh sách model từ Gemini API." });
    }
  });

  // API Route for Generating Exam
  app.post("/api/generate-full-exam", async (req, res) => {
    try {
      const { files, promptText, examTitle, subject, grade, scoreConfig, selectedModel, availableModels, apiKey } = req.body;
      const finalApiKey = apiKey?.trim() || req.headers['authorization']?.replace('Bearer ', '') || process.env.GEMINI_API_KEY;

      if (!finalApiKey) {
        return res.status(401).json({ error: "Không tìm thấy API Key hợp lệ. Không thể tiếp tục xử lý." });
      }

      const ai = new GoogleGenAI({ 
        apiKey: finalApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const parts: any[] = [];
      for (const file of files) {
        let mime = file.type || "text/plain";
        let data = file.data.split(",")[1];

        if (mime.includes("officedocument.wordprocessingml") || mime.includes("msword") || (file.name && file.name.endsWith(".docx"))) {
           try {
             const buffer = Buffer.from(data, "base64");
             const result = await mammoth.extractRawText({ buffer });
             parts.push({ text: `[Nội dung tài liệu ${file.name || 'Word'}]:\n${result.value.normalize('NFC')}` });
           } catch (e) {
             console.error("Lỗi đọc file Word:", e);
           }
           continue; 
        }

        if (mime.includes("excel") || mime.includes("spreadsheet")) {
          continue; 
        }
        
        if (mime === "application/octet-stream") {
           if (file.name && file.name.endsWith(".csv")) mime = "text/plain";
           else if (file.name && file.name.endsWith(".txt")) mime = "text/plain";
           else if (file.name && file.name.endsWith(".pdf")) mime = "application/pdf";
           else continue;
        }

        parts.push({
          inlineData: {
            data: data,
            mimeType: mime
          }
        });
      }

      parts.push({ text: `[Yêu cầu tùy chỉnh của giáo viên]: ${promptText || 'Hãy tạo bộ đề tốt nhất có thể.'}` });

      const scoreConfigText = scoreConfig ? `
CẤU HÌNH ĐIỂM BẮT BUỘC:
Bạn phải tạo đề thi đúng theo cấu hình điểm giáo viên đã cung cấp.

Có 3 dạng câu hỏi:
1. TNNLC - Trắc nghiệm nhiều lựa chọn: Tổng ${scoreConfig.multipleChoice.totalQuestions} câu. (Biết: ${scoreConfig.multipleChoice.levels.biet.questionCount} câu - ${scoreConfig.multipleChoice.levels.biet.score}đ, Hiểu: ${scoreConfig.multipleChoice.levels.hieu.questionCount} câu - ${scoreConfig.multipleChoice.levels.hieu.score}đ, Vận dụng: ${scoreConfig.multipleChoice.levels.vanDung.questionCount} câu - ${scoreConfig.multipleChoice.levels.vanDung.score}đ)
2. TN ĐÚNG - SAI - Trắc nghiệm đúng sai: Tổng ${scoreConfig.trueFalse.totalQuestions} câu. (Biết: ${scoreConfig.trueFalse.levels.biet.questionCount} câu - ${scoreConfig.trueFalse.levels.biet.score}đ, Hiểu: ${scoreConfig.trueFalse.levels.hieu.questionCount} câu - ${scoreConfig.trueFalse.levels.hieu.score}đ, Vận dụng: ${scoreConfig.trueFalse.levels.vanDung.questionCount} câu - ${scoreConfig.trueFalse.levels.vanDung.score}đ)
3. TỰ LUẬN: Tổng ${scoreConfig.essay.totalQuestions} câu. (Biết: ${scoreConfig.essay.levels.biet.questionCount} câu - ${scoreConfig.essay.levels.biet.score}đ, Hiểu: ${scoreConfig.essay.levels.hieu.questionCount} câu - ${scoreConfig.essay.levels.hieu.score}đ, Vận dụng: ${scoreConfig.essay.levels.vanDung.questionCount} câu - ${scoreConfig.essay.levels.vanDung.score}đ)

Quy tắc bắt buộc:
- Không được tự ý thay đổi tổng số câu.
- Không được tự ý thay đổi số điểm.
- Nếu dạng câu hỏi nào có tổng số câu bằng 0 thì không tạo dạng câu hỏi đó.
- Ma trận đề thi phải thể hiện rõ số câu và số điểm theo từng dạng câu hỏi, từng mức độ nhận thức.
- Đề thi phải có đúng số câu theo cấu hình.
- Đáp án và hướng dẫn chấm phải có đúng thang điểm theo cấu hình.
- Tổng điểm cuối cùng phải bằng tổng điểm giáo viên đã cấu hình.` : '';

      const systemInstruction = `Bạn là một chuyên gia khảo thí và giáo viên giàu kinh nghiệm cấp THCS. Nhiệm vụ của bạn là tạo một ĐỀ KIỂM TRA HOÀN CHỈNH từ tài liệu nguồn và cấu hình đã cho.
QUY TẮC BẮT BUỘC:
1. Bạn BẮT BUỘC phải đọc và sử dụng TẤT CẢ tài liệu nguồn, văn bản, thông tin người dùng upload để tạo đề. Không tự bịa thông tin bên ngoài. Nếu tài liệu không đủ dữ liệu, trả về "KHÔNG ĐỦ DỮ LIỆU" trong fullExamContent.
2. Quy trình 3 bước (bắt buộc trả về đúng Markdown Table cho các bảng):
   - Bước 1: KHUNG MA TRẬN và BẢN ĐẶC TẢ. Thiết kế dạng Markdown Table (phân chia số câu, mức độ Biết/Hiểu/Vận dụng). Ghi trong ô "x câu y điểm" hoặc "x câu (NL...)". Bảng phải đúng chuẩn, có header, không bị thiếu ô, không bị biến thành văn xuôi.
   - Bước 2: ĐỀ KIỂM TRA HOÀN CHỈNH.
     + Bao gồm các phần: Trắc nghiệm nhiều lựa chọn, Trắc nghiệm đúng/sai, Tự luận (dựa theo cấu hình điểm).
     + KHÔNG CÓ đáp án ở phần Đề Thi.
     + TẠO SẴN "Bảng trả lời trắc nghiệm" (Markdown Table) trước nội dung câu hỏi.
     + TẠO SẴN "Bảng trả lời đúng/sai" (Markdown Table) trước nội dung câu đúng/sai.
     + Phần tự luận phải chia ra Câu 1, Câu 2... hoặc ý A, B, C và ghi sẵn "BÀI LÀM ...." cho học sinh điền.
   - Bước 3: ĐÁP ÁN VÀ HƯỚNG DẪN CHẤM.
     + Bảng đáp án trắc nghiệm (Markdown Table).
     + Bảng đáp án đúng/sai (Markdown Table).
     + Bảng hướng dẫn chấm tự luận (Markdown Table).
3. Tuyệt đối thiết lập Tổng điểm = 10 (Trắc nghiệm nhiều lựa chọn: 3 điểm, Đúng - Sai: 4 điểm, Tự luận: 3 điểm hoặc theo đúng cấu hình).
4. Thông tin bài thi: Tên bài thi: ${examTitle || 'KIỂM TRA'}, Lớp: ${grade || 6}, Môn: ${subject || 'GDCD'}
5. Bắt buộc xuất mảng "questions" cho trắc nghiệm nhiều lựa chọn và "trueFalseQuestions" cho trắc nghiệm đúng sai.
${scoreConfigText}

Yêu cầu trả về CẤU TRÚC JSON BẮT BUỘC SAU:
{
  "matrixAndSpecification": "<Chuỗi Markdown chứa Ma trận và Bảng đặc tả>",
  "examContent": "<Chuỗi Markdown chứa Nội dung chi tiết của đề thi, bao gồm Bảng trả lời>",
  "answerAndRubric": "<Chuỗi Markdown chứa Đáp án và Hướng dẫn chấm (bảng markdown)>",
  "fullExamContent": "<Chuỗi Markdown gộp 3 phần trên>",
  "scoreSummary": { ... },
  "questions": [ ... ],
  "trueFalseQuestions": [ ... ],
  "essayPrompt": "<Chuỗi markdown cho phần tự luận>"
}

LƯU Ý QUAN TRỌNG: Tất cả các bảng biểu phải là Markdown Table chuẩn, ví dụ:
| Câu | 1 | 2 | 3 |
|---|---|---|---|
| Đáp án | A | B | C |`;

      const candidateModels = buildCandidateModels(selectedModel, availableModels);
      
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Transfer-Encoding", "chunked");
      const keepAliveInterval = setInterval(() => {
         res.write(" "); 
      }, 15000);

      let genResult;
      try {
        const buildPayload = (model: string) => ({
          model: model,
          contents: { parts },
          config: {
            temperature: 0.7,
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                matrixAndSpecification: { type: Type.STRING },
                examContent: { type: Type.STRING },
                answerAndRubric: { type: Type.STRING },
                fullExamContent: { type: Type.STRING },
                scoreSummary: {
                  type: Type.OBJECT,
                  properties: {
                    totalQuestions: { type: Type.NUMBER },
                    totalScore: { type: Type.NUMBER },
                    multipleChoice: {
                      type: Type.OBJECT,
                      properties: { totalQuestions: { type: Type.NUMBER }, totalScore: { type: Type.NUMBER } }
                    },
                    trueFalse: {
                      type: Type.OBJECT,
                      properties: { totalQuestions: { type: Type.NUMBER }, totalScore: { type: Type.NUMBER } }
                    },
                    essay: {
                      type: Type.OBJECT,
                      properties: { totalQuestions: { type: Type.NUMBER }, totalScore: { type: Type.NUMBER } }
                    }
                  }
                },
                essayPrompt: { type: Type.STRING, description: "Phải ghi rõ số câu (Câu 1, Câu 2...) khi xuất danh sách câu hỏi." },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      text: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctAnswerIndex: { type: Type.NUMBER }
                    },
                    required: ["id", "text", "options", "correctAnswerIndex"]
                  }
                },
                trueFalseQuestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      text: { type: Type.STRING },
                      statements: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            id: { type: Type.STRING },
                            text: { type: Type.STRING },
                            isTrue: { type: Type.BOOLEAN }
                          },
                          required: ["id", "text", "isTrue"]
                        }
                      }
                    },
                    required: ["id", "text", "statements"]
                  }
                }
              },
              required: ["matrixAndSpecification", "examContent", "answerAndRubric", "fullExamContent", "questions", "trueFalseQuestions"]
            }
          }
        });
        genResult = await generateContentWithFallback(ai, candidateModels, buildPayload);
      } finally {
        clearInterval(keepAliveInterval);
      }

      if (!genResult || !genResult.response || !genResult.response.text) {
        throw new Error("Không nhận được phản hồi từ AI");
      }

      let parsedData;
      const rawText = genResult.response.text || "";
      try {
        parsedData = JSON.parse(rawText.normalize('NFC'));
        parsedData.usedModel = genResult.usedModel;
      } catch (e: any) {
        throw new Error("Mô hình AI trả về dữ liệu không đúng định dạng JSON: " + e.message);
      }

      res.write(JSON.stringify(parsedData));
      res.end();

    } catch (error: any) {
     console.error("Error generating exam:", error?.message || error);
      let errorMsg = error?.message || "There was an error generating content.";
      const errMsgStr = String(error?.message || error || "").toLowerCase();
      if (error?.message?.includes("API key not valid") || error?.status === 403 || error?.status === 401) {
         errorMsg = "API Key hiện tại không có quyền truy cập model Gemini phù hợp.";
      } else if (error?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
         errorMsg = "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút hoặc đổi API Key khác.";
      }
      
      if (!res.headersSent) {
         return res.status(500).json({ error: errorMsg });
      } else {
         return res.end(JSON.stringify({ error: errorMsg }));
      }
    }
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const { files, promptText, activeMode, selectedModel, availableModels, apiKey } = req.body;
      const finalApiKey = apiKey?.trim() || req.headers['authorization']?.replace('Bearer ', '') || process.env.GEMINI_API_KEY;

      if (!finalApiKey) {
        return res.status(401).json({ error: "Không tìm thấy API Key hợp lệ. Không thể tiếp tục xử lý." });
      }

      const ai = new GoogleGenAI({ 
        apiKey: finalApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });


      // Extract parts from the file array
      
      const parts: any[] = [];
      const supportedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'text/plain', 'text/csv', 'text/markdown'];
      for (const file of files) {
        let mime = file.type || "text/plain";
        let data = file.data.split(",")[1];

        if (mime.includes("officedocument.wordprocessingml") || mime.includes("msword") || (file.name && file.name.endsWith(".docx"))) {
           try {
             const buffer = Buffer.from(data, "base64");
             const result = await mammoth.extractRawText({ buffer });
             parts.push({ text: `[Nội dung tài liệu ${file.name || 'Word'}]:\n${result.value.normalize('NFC')}` });
           } catch (e) {
             console.error("Lỗi đọc file Word:", e);
           }
           continue; // Always continue, don't send raw docx to Gemini
        }

        if (mime.includes("excel") || mime.includes("spreadsheet")) {
          continue; // Cannot parse Excel right now
        }
        
        if (mime === "application/octet-stream") {
           if (file.name && file.name.endsWith(".csv")) mime = "text/plain";
           else if (file.name && file.name.endsWith(".txt")) mime = "text/plain";
           else if (file.name && file.name.endsWith(".pdf")) mime = "application/pdf";
           else continue; // Skip unknown binaries
        }

        if (!supportedMimes.includes(mime)) {
           // Provide a safe fallback for unknown text files
           if (mime.startsWith('text/')) { mime = 'text/plain'; }
           else continue; // skip unsupported binary files
        }

        parts.push({
          inlineData: {
            mimeType: mime,
            data: data
          }
        });
      }


      // Append user prompt and system instruction instructions 
      const systemInstruction = `
Bạn là AI chuyên tạo đề kiểm tra online dựa trên tài liệu người dùng cung cấp.

QUY TRÌNH BẮT BUỘC PHẢI THỰC HIỆN:

Đầu tiên, đọc toàn bộ tài liệu mà người dùng cung cấp.
Phân tích nội dung tài liệu, bao gồm:
Chủ đề chính
Kiến thức trọng tâm
Khái niệm quan trọng
Mức độ khó của nội dung
Các phần có thể dùng để ra câu hỏi
Sau đó, kết hợp nội dung tài liệu với yêu cầu cụ thể trong prompt của người dùng.
Chỉ được tạo đề kiểm tra dựa trên:
Tài liệu người dùng cung cấp
Yêu cầu cụ thể của người dùng
Không tự ý thêm kiến thức ngoài tài liệu nếu người dùng không yêu cầu.
Nếu tài liệu chưa đủ thông tin để tạo đề, hãy thông báo rõ phần còn thiếu và đề xuất người dùng bổ sung.

===============================================
ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (MARKDOWN) - BẠN PHẢI XUẤT RA CHÍNH XÁC CÁC TIÊU ĐỀ LA MÃ NÀY VÀO TRƯỜNG "analysisAndFormat":

I. PHÂN TÍCH TÀI LIỆU
* Tóm tắt nội dung chính
* Các kiến thức trọng tâm
* Mức độ phù hợp để tạo đề

II. TẠO ĐỀ KIỂM TRA
* Tên đề
* Thời gian làm bài (nếu người dùng yêu cầu)
* Số lượng câu hỏi
* Loại câu hỏi: ${activeMode === 'multiple-choice' ? 'Trắc nghiệm' : 'Tự luận'}

III. NỘI DUNG ĐỀ
* Phải đánh số thứ tự rõ ràng (Câu 1, Câu 2...).
* Nếu Trắc nghiệm: Mỗi câu có 4 đáp án đa dạng (A, B, C, D).
* Nếu Tự luận: Liệt kê rõ câu hỏi. Bắt buộc phải đánh số câu (Câu 1, Câu 2...) rõ ràng.

IV. ĐÁP ÁN
* Trắc nghiệm: Đưa ra đáp án đúng.
* Tự luận: Gợi ý trả lời chi tiết và các ý chấm điểm.
* Giải thích ngắn gọn nếu người dùng có yêu cầu.

===============================================
LƯU Ý QUAN TRỌNG:
- Trường 'analysisAndFormat' của bạn phải chứa NGUYÊN VĂN toàn bộ định dạng Markdown từ mục I đến mục IV ở trên! Đừng bỏ sót bất cứ mục nào. Viết bằng tiếng Việt rõ ràng, dễ hiểu.
- Đồng thời, BẠN PHẢI TRÍCH XUẤT:
  + Cấu trúc dữ liệu câu hỏi vào JSON \`questions\` (nếu là trắc nghiệm) để hệ thống lập trình hiển thị giao diện thi.
  + Câu hỏi tự luận vào trường JSON \`essayPrompt\` (nếu là tự luận).
`;

      const textPrompt = `YÊU CẦU CỦA NGƯỜI DÙNG:
${promptText || "Hãy phân tích tài liệu cung cấp và tiến hành tạo đề thi phù hợp."}

LƯU Ý CỐT LÕI (Mã tạo đề: ${Date.now()}_${Math.random().toString(36).substring(7)}): Yêu cầu trích xuất NGẪU NHIÊN các phần kiến thức khác nhau từ tài liệu. HÃY ĐẢM BẢO nội dung câu hỏi hoàn toàn khác biệt so với các đề thi thông thường, tránh lặp lại lối mòn. Đây là một phiên xuất bản hoàn toàn mới.

Hãy BẮT ĐẦU thực hiện quá trình 4 bước và tuân thủ tuyệt đối định dạng đầu ra I, II, III, IV.`;

      parts.push({
        text: textPrompt,
      });

      const candidateModels = buildCandidateModels(selectedModel, availableModels);
      
      // Keep alive heartbeat to bypass Render 502 timeout
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Transfer-Encoding", "chunked");
      const keepAliveInterval = setInterval(() => {
         res.write(" "); // Send space character every 15 seconds to prevent 502
      }, 15000);

      let genResult;
      try {
        const buildPayload = (model: string) => ({
          model: model,
          contents: { parts },
          config: {
            temperature: 0.9,
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                analysisAndFormat: {
                  type: Type.STRING,
                  description: "Nội dung phản hồi chi tiết (I, II, III, IV) ở dạng Markdown.",
                },
                questions: {
                  type: Type.ARRAY,
                  description: "Dành cho chế độ trắc nghiệm (Tạo danh sách các câu hỏi để hiển thị web)",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "ID duy nhất (vd: q1, q2)" },
                      text: { type: Type.STRING, description: "Nội dung câu hỏi" },
                      options: {
                        type: Type.ARRAY,
                        description: "Mảng chứa CHÍNH XÁC 4 đáp án (1 ĐÚNG, 3 SAI). Lưu ý: Chỉ điền nội dung, KHÔNG chứa các chữ cái A, B, C, D ở đầu.",
                        items: { type: Type.STRING }
                      },
                      correctAnswerIndex: { type: Type.NUMBER, description: "Vị trí đáp án đúng (0, 1, 2, 3)" }
                    },
                    required: ["id", "text", "options", "correctAnswerIndex"]
                  }
                },
                essayPrompt: {
                  type: Type.STRING,
                  description: "Dành cho chế độ tự luận. Điền nội dung câu hỏi tự luận vào đây. Yêu cầu bắt buộc: Phải ghi rõ số câu (ví dụ: 'Câu 1:', 'Câu 2:') trên bài làm. Trình bày rõ ràng, XUỐNG DÒNG (dùng \\n\\n) giữa các câu."
                }
              },
              required: activeMode === 'multiple-choice' ? ["analysisAndFormat", "questions"] : ["analysisAndFormat", "essayPrompt"]
            }
          }
        });
        genResult = await generateContentWithFallback(ai, candidateModels, buildPayload);
      } finally {
        clearInterval(keepAliveInterval);
      }

      if (!genResult || !genResult.response || !genResult.response.text) {
        throw new Error("Không nhận được phản hồi từ AI");
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
      if (parsedData.essayPrompt) {
        parsedData.essayPrompt = parsedData.essayPrompt.replace(/\s*(Câu \d+[:.])/g, '\n\n$1').replace(/\n{3,}/g, '\n\n').trim();
      }
      
      res.write(JSON.stringify(parsedData));
      res.end();

    } catch (error: any) {
     console.error(
  "Error generating exam:",
  error?.message || error
);
      
      let errorMsg = error?.message || "There was an error generating content.";
      if (error?.message?.includes("API key not valid") || error?.status === 403 || error?.status === 401) {
         errorMsg = "API Key hiện tại không có quyền truy cập model Gemini phù hợp.";
      } else {
         const errMsgStr = String(error?.message || error || "").toLowerCase();
         if (error?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
            errorMsg = "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút hoặc đổi API Key khác.";
         }
      }
      
      if (!res.headersSent) {
         return res.status(500).json({ error: errorMsg });
      } else {
         return res.end(JSON.stringify({ error: errorMsg }));
      }
    }
  });

  app.post("/api/grade-essay", async (req, res) => {
    const { promptText, essayAnswer, essayAttachment, selectedModel, availableModels, apiKey, maxScore = 10 } = req.body;
    const finalApiKey = apiKey?.trim() || req.headers['authorization']?.replace('Bearer ', '') || process.env.GEMINI_API_KEY;
    try {
      if (!finalApiKey) {
        return res.status(401).json({ error: "Không tìm thấy API Key hợp lệ. Không thể tiếp tục xử lý." });
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

      // If there's an image attachment, we would decode it. But since it could be multiple types
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

      // Keep alive heartbeat to bypass Render 502 timeout
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Transfer-Encoding", "chunked");
      const keepAliveInterval = setInterval(() => {
         res.write(" "); // Send space character every 15 seconds to prevent 502
      }, 15000);

      let genResult;

      try {
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
        genResult = await generateContentWithFallback(ai, candidateModels, buildPayload);
      } finally {
        clearInterval(keepAliveInterval);
      }
      
      if (!genResult || !genResult.response || !genResult.response.text) throw new Error("No response");
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
      
      res.write(JSON.stringify(parsedData));
      res.end();
      
    } catch(err: any) {
      console.error(`Error grading essay with API key ${maskApiKey(finalApiKey || '')}:`, err?.message || err);
      let errorMsg = err?.message || "There was an error grading.";
      if (err?.message?.includes("API key not valid") || err?.status === 403 || err?.status === 401) {
         errorMsg = "API Key hiện tại không có quyền truy cập model Gemini phù hợp.";
      } else {
         const errMsgStr = String(err?.message || err || "").toLowerCase();
         if (err?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
            errorMsg = "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút hoặc đổi API Key khác.";
         }
      }
      if (!res.headersSent) {
         return res.status(500).json({ error: errorMsg });
      } else {
         return res.end(JSON.stringify({ error: errorMsg }));
      }
    }
  });

  // --- Exam Storage ---
  const EXAMS_FILE = path.join(process.cwd(), 'exams.json');
  let examsCache: Record<string, any> = {};
  
  try {
    if (fs.existsSync(EXAMS_FILE)) {
      examsCache = JSON.parse(fs.readFileSync(EXAMS_FILE, 'utf-8'));
    }
  } catch(e) {
    console.error("Could not load exams.json:", e);
  }

  app.post("/api/exams", (req, res) => {
    try {
      const { id, config } = req.body;
      if (!id || !config) return res.status(400).json({ error: "Missing id or config" });
      
      examsCache[id] = config;
      fs.writeFileSync(EXAMS_FILE, JSON.stringify(examsCache));
      res.json({ success: true, id });
    } catch (error) {
      console.error("Error saving exam:", error);
      res.status(500).json({ error: "Error saving exam" });
    }
  });

  app.get("/api/exams/:id", (req, res) => {
    try {
      const { id } = req.params;
      const config = examsCache[id];
      if (config) {
        res.json({ success: true, config });
      } else {
        res.status(404).json({ error: "Exam not found" });
      }
    } catch (error) {
      console.error("Error retrieving exam:", error);
      res.status(500).json({ error: "Error retrieving exam" });
    }
  });
  // --------------------

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.keepAliveTimeout = 300000;
  server.headersTimeout = 305000;
  server.timeout = 300000;
}

startServer();

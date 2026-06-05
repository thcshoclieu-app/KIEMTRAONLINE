import { Handler } from '@netlify/functions';
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";
import { buildCandidateModels, generateContentWithFallback } from './utils';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { files, promptText, activeMode, selectedModel, availableModels, apiKey } = JSON.parse(event.body || '{}');
    const authHeader = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    const finalApiKey = apiKey?.trim() || authHeader || process.env.GEMINI_API_KEY;

    if (!finalApiKey) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Không tìm thấy API Key hợp lệ. Không thể tiếp tục xử lý." })
      };
    }

    const ai = new GoogleGenAI({ 
      apiKey: finalApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

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
         continue; 
      }

      if (mime.includes("excel") || mime.includes("spreadsheet")) continue;
      
      if (mime === "application/octet-stream") {
         if (file.name && file.name.endsWith(".csv")) mime = "text/plain";
         else if (file.name && file.name.endsWith(".txt")) mime = "text/plain";
         else if (file.name && file.name.endsWith(".pdf")) mime = "application/pdf";
         else continue;
      }

      if (!supportedMimes.includes(mime)) {
         if (mime.startsWith('text/')) { mime = 'text/plain'; }
         else continue; 
      }

      parts.push({ inlineData: { mimeType: mime, data: data } });
    }

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

    parts.push({ text: textPrompt });

    const candidateModels = buildCandidateModels(selectedModel, availableModels);

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

    const genResult = await generateContentWithFallback(ai, candidateModels, buildPayload);

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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedData)
    };

  } catch (error: any) {
    console.error("Error generating exam:", error?.message || error);
    let errorMsg = error?.message || "There was an error generating content.";
    if (error?.message?.includes("API key not valid") || error?.status === 403 || error?.status === 401) {
       errorMsg = "API Key hiện tại không có quyền truy cập model Gemini phù hợp.";
    } else {
       const errMsgStr = String(error?.message || error || "").toLowerCase();
       if (error?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
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

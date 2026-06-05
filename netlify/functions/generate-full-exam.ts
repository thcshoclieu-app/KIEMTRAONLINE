import { Handler } from '@netlify/functions';
import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";
import { buildCandidateModels, generateContentWithFallback } from './utils';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { files, promptText, examTitle, subject, grade, scoreConfig, selectedModel, availableModels, apiKey } = JSON.parse(event.body || '{}');
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

      parts.push({ inlineData: { data: data, mimeType: mime } });
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
      throw new Error("Mô hình AI trả về dữ liệu không đúng định dạng JSON: " + e.message);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsedData)
    };

  } catch (error: any) {
    console.error("Error generating exam:", error?.message || error);
    let errorMsg = error?.message || "There was an error generating content.";
    const errMsgStr = String(error?.message || error || "").toLowerCase();
    
    if (error?.message?.includes("API key not valid") || error?.status === 403 || error?.status === 401) {
       errorMsg = "API Key hiện tại không có quyền truy cập model Gemini phù hợp.";
    } else if (error?.status === 429 || errMsgStr.includes("quota") || errMsgStr.includes("429")) {
       errorMsg = "API Key của bạn đã vượt quá giới hạn sử dụng (Quota exceeded). Vui lòng thử lại sau 1 phút hoặc đổi API Key khác.";
    }
    
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: errorMsg })
    };
  }
};

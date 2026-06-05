import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const handler: Handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "OK" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const examId = event.queryStringParameters?.examId;

  if (!examId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "examId là bắt buộc." })
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Supabase server environment variables" })
    };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: examData, error: examError } = await supabase
      .from("exams")
      .select("id, title, subject, grade, duration, exam_type, deadline, show_result, exam_data, score_config")
      .eq("id", examId)
      .single();

    if (examError || !examData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Link bài tập không hợp lệ hoặc đề đã bị xóa." })
      };
    }

    if (examData.deadline) {
      const deadlineDate = new Date(examData.deadline);
      const now = new Date();
      if (now > deadlineDate) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: "Đề thi đã hết hạn." })
        };
      }
    }

    // Helper: Sanitize exam_data to ensure NO ANSWERS
    const sanitizeExamForStudent = (data: any) => {
      const safeQuestions = (data?.questions || []).map((q: any) => {
        const { correctAnswerIndex, correctAnswer, explanation, ...safeQ } = q;
        return safeQ;
      });

      const safeTrueFalse = (data?.trueFalseQuestions || []).map((q: any) => {
        const safeStatements = (q.statements || []).map((s: any) => {
          const { isTrue, correctAnswer, explanation, ...safeS } = s;
          return safeS;
        });
        return { ...q, statements: safeStatements };
      });

      return {
        questions: safeQuestions,
        trueFalseQuestions: safeTrueFalse,
        essayPrompt: data?.essayPrompt || "",
        matrixAndSpecification: data?.matrixAndSpecification || "",
        examContent: data?.examContent || "",
        scoreConfig: examData.score_config || data?.scoreConfig
      };
    };

    const safeData = sanitizeExamForStudent(examData.exam_data);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        examId: examData.id,
        supabaseExamId: examData.id,
        examName: examData.title,
        subject: examData.subject || '',
        grade: examData.grade || '',
        timeLimit: examData.duration || 45,
        examType: examData.exam_type || 'multiple-choice',
        deadline: examData.deadline || '',
        showResult: examData.show_result ?? true,
        ...safeData
      })
    };
  } catch (error: any) {
    console.error("Get Exam Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Lỗi máy chủ nội bộ." })
    };
  }
};

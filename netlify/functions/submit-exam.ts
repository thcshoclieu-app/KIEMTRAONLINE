import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const handler: Handler = async (event) => {
  // CORS caching and preflight
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "OK" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Supabase configuration limit in backend." })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      examId,
      studentName,
      className,
      multipleChoiceAnswers,
      trueFalseAnswers,
      essayAnswer,
      essayAttachment
    } = body;

    if (!examId || !studentName || !className) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "examId, studentName, className là bắt buộc." })
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch exact answer_data
    const { data: examData, error: examError } = await supabase
      .from("exams")
      .select("answer_data, exam_type, score_config, exam_data, deadline, show_result")
      .eq("id", examId)
      .single();

    if (examError || !examData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Không tìm thấy đề thi." })
      };
    }

    if (examData.deadline) {
      const deadlineDate = new Date(examData.deadline);
      const now = new Date();
      if (now > deadlineDate) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Đã quá hạn nộp bài." })
        };
      }
    }

    // 2. Grade
    let multipleChoiceScore = 0;
    let trueFalseScore = 0;
    const essayScore = 0; // Default pending
    
    const answerData = examData.answer_data || {};
    const scoreConfig = examData.score_config || examData.exam_data?.scoreConfig;
    
    // Multiple choice grading
    if (multipleChoiceAnswers && answerData.questions) {
      const qScore = scoreConfig?.multipleChoice?.pointsPerQuestion || 1;
      for (const [qId, selectedIdx] of Object.entries(multipleChoiceAnswers)) {
        const q = answerData.questions.find((x: any) => x.id === qId);
        if (q && q.correctAnswerIndex === selectedIdx) {
          multipleChoiceScore += qScore;
        }
      }
    }

    // True False grading
    if (trueFalseAnswers && answerData.trueFalseQuestions) {
      for (const [qId, selections] of Object.entries(trueFalseAnswers)) {
        const q = answerData.trueFalseQuestions.find((x: any) => x.id === qId);
        if (q) {
          let correctCount = 0;
          for (const stmt of q.statements) {
            // @ts-ignore
            if (selections[stmt.id] === stmt.isTrue) {
              correctCount++;
            }
          }
          let tfScore = 0;
          if (correctCount === 1) tfScore = 0.1;
          else if (correctCount === 2) tfScore = 0.25;
          else if (correctCount === 3) tfScore = 0.5;
          else if (correctCount === 4) tfScore = 1.0;
          trueFalseScore += tfScore;
        }
      }
    }

    const totalScore = multipleChoiceScore + trueFalseScore + essayScore;

    // 3. Insert Submission (bypass RLS)
    const { error: insertError } = await supabase
      .from("submissions")
      .insert([
        {
          exam_id: examId,
          student_name: studentName,
          class_name: className,
          exam_type: examData.exam_type || 'multiple-choice',
          multiple_choice_answers: multipleChoiceAnswers || null,
          true_false_answers: trueFalseAnswers || null,
          essay_answer: essayAnswer || null,
          essay_attachment: essayAttachment || null,
          multiple_choice_score: multipleChoiceScore,
          true_false_score: trueFalseScore,
          essay_score: essayScore,
          total_score: totalScore,
          submitted_at: new Date().toISOString()
        }
      ]);

    if (insertError) {
      throw insertError;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        multipleChoiceScore,
        trueFalseScore,
        essayScore,
        totalScore
      })
    };

  } catch (error: any) {
    console.error("Submit Exam Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Lỗi máy chủ nội bộ." })
    };
  }
};

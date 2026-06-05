import { getSupabaseClient } from './supabase';
import { ExamConfig, StudentResult } from '../types';

export const saveExamToSupabase = async (config: ExamConfig) => {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Bạn cần đăng nhập giáo viên trước khi tạo đề.");
  }
  const safeExamData = sanitizeExamForStudent({
    questions: config.questions || [],
    trueFalseQuestions: config.trueFalseQuestions || [],
    essayPrompt: config.essayPrompt || '',
    matrixAndSpecification: config.matrixAndSpecification || '',
    examContent: config.examContent || '',
    fullExamContent: config.fullExamContent || '',
    scoreConfig: config.scoreConfig || undefined
  });

  const { data, error } = await supabase
    .from('exams')
    .insert([
      {
        owner_id: user.id,
        title: config.examName,
        subject: config.subject,
        grade: config.grade,
        duration: config.timeLimit,
        exam_type: config.examType,
        deadline: config.deadline || null,
        show_result: config.showResult,
        exam_data: {
          ...safeExamData
        },
        answer_data: {
          answerAndRubric: config.answerAndRubric || '',
          questions: config.questions || [],
          trueFalseQuestions: config.trueFalseQuestions || [],
          fullExamContent: config.fullExamContent || ''
        },
        score_config: config.scoreConfig || null
      }
    ])
    .select('id')
    .single();

  if (error) {
    console.error('Error saving exam to Supabase:', error);
    throw error;
  }
  return data;
};

// Helper to remove answers for students
const sanitizeExamForStudent = (examData: any) => {
  const safeQuestions = (examData?.questions || []).map((q: any) => {
    const safeQ = { ...q };
    delete safeQ.correctAnswerIndex;
    delete safeQ.correctAnswer;
    delete safeQ.explanation;
    return safeQ;
  });

  const safeTrueFalse = (examData?.trueFalseQuestions || []).map((q: any) => {
    const safeQ = { ...q };
    safeQ.statements = (q.statements || []).map((s: any) => {
      const safeS = { ...s };
      delete safeS.isTrue;
      delete safeS.correctAnswer;
      return safeS;
    });
    return safeQ;
  });

  return {
    questions: safeQuestions,
    trueFalseQuestions: safeTrueFalse,
    essayPrompt: examData?.essayPrompt || '',
    matrixAndSpecification: examData?.matrixAndSpecification || '',
    examContent: examData?.examContent || '',
    fullExamContent: examData?.fullExamContent || '',
    scoreConfig: examData?.scoreConfig || undefined
  };
};

// getExamFromSupabase is removed. Students must use /api/get-exam which uses the Netlify function.
// Teachers can use getExamForTeacher.

export const getExamForTeacher = async (examId: string): Promise<ExamConfig | null> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('exams')
    .select('*')
    .eq('id', examId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    examId: data.id,
    supabaseExamId: data.id,
    examName: data.title,
    subject: data.subject || '',
    grade: data.grade || '',
    timeLimit: data.duration || 45,
    examType: data.exam_type || 'multiple-choice',
    deadline: data.deadline || '',
    showResult: data.show_result ?? true,
    questions: data.exam_data?.questions || [],
    trueFalseQuestions: data.exam_data?.trueFalseQuestions || [],
    essayPrompt: data.exam_data?.essayPrompt || '',
    matrixAndSpecification: data.exam_data?.matrixAndSpecification || '',
    examContent: data.exam_data?.examContent || '',
    fullExamContent: data.exam_data?.fullExamContent || '',
    answerAndRubric: data.answer_data?.answerAndRubric || '',
    scoreConfig: data.score_config || data.exam_data?.scoreConfig || undefined,
    attempts: 1 // default value required by type
  } as ExamConfig;
};

// Legacy/Test only. DO NOT use for student submission in production.
export const submitExamToSupabase = async (result: StudentResult) => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('submissions')
    .insert([
      {
        exam_id: result.examId,
        student_name: result.studentName,
        class_name: result.studentClass || '',
        exam_type: result.examType,
        multiple_choice_answers: result.multipleChoiceAnswers || null,
        true_false_answers: result.trueFalseAnswers || null,
        essay_answer: result.essayAnswer || null,
        essay_attachment: result.essayAttachment || null,
        multiple_choice_score: result.multipleChoiceScore || 0,
        true_false_score: result.trueFalseScore || 0,
        essay_score: result.essayScore || 0,
        total_score: result.totalScore || result.score || 0,
        teacher_comments: result.teacherComments || null,
        submitted_at: result.timestamp
      }
    ]);

  if (error) {
    console.error('Error submitting exam to Supabase:', error);
    throw error;
  }
  return data;
};

export const getSubmissionsFromSupabase = async () => {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Bạn cần đăng nhập giáo viên để xem kết quả.");
  }

  const { data, error } = await supabase
    .from('submissions')
    .select(`
      *,
      exams (
        title,
        subject,
        grade
      )
    `)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('Error fetching submissions from Supabase:', error);
    throw error;
  }
  return data;
};

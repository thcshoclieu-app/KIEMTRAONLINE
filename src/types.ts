export interface Question {
  id: string;
  text: string;
  options: string[]; // Always 4 options: A, B, C, D
  correctAnswerIndex?: number; // 0, 1, 2, or 3
  correctAnswer?: string;
  explanation?: string;
}

export interface TrueFalseStatement {
  id: string;
  text: string;
  isTrue?: boolean;
  correctAnswer?: string;
}

export interface TrueFalseQuestion {
  id: string;
  text: string;
  statements: TrueFalseStatement[];
}

export type CognitiveLevel = 'biet' | 'hieu' | 'vanDung';

export interface ScoreLevelConfig {
  questionCount: number;
  score: number;
}

export interface QuestionTypeScoreConfig {
  totalQuestions: number;
  levels: {
    biet: ScoreLevelConfig;
    hieu: ScoreLevelConfig;
    vanDung: ScoreLevelConfig;
  };
}

export interface ExamScoreConfig {
  multipleChoice: QuestionTypeScoreConfig;
  trueFalse: QuestionTypeScoreConfig;
  essay: QuestionTypeScoreConfig;
}

export interface ExamConfig {
  examId: string;
  supabaseExamId?: string;
  subject?: string;
  grade?: string;
  matrixAndSpecification?: string;
  examContent?: string;
  answerAndRubric?: string;
  fullExamContent?: string;
  examName: string;
  examType: 'multiple-choice' | 'essay' | 'mixed' | 'exam-builder';
  questions: Question[]; // Dành cho trắc nghiệm
  trueFalseQuestions?: TrueFalseQuestion[]; // Dành cho trắc nghiệm đúng/sai
  essayPrompt?: string; // Dành cho tự luận
  timeLimit: number; // in minutes
  deadline: string; // ISO date string
  attempts: number; // Số lần làm bài
  shuffle?: boolean;
  showResult: boolean;
  pointsPerQuestion?: number;
  scoreConfig?: ExamScoreConfig;
}

export interface StudentResult {
  timestamp: string;
  studentName: string;
  studentClass?: string;
  examId?: string;
  examName: string;
  examType?: string;
  correctAnswers?: number; // Dành cho trắc nghiệm
  totalQuestions?: number;
  multipleChoiceAnswers?: any;
  trueFalseAnswers?: any;
  multipleChoiceScore?: number;
  trueFalseScore?: number;
  essayScore?: number;
  totalScore?: number;
  teacherComments?: string;
  score?: number; // Thoang điểm 10
  details?: any; // Câu trả lời đã chọn (trắc nghiệm)
  essayAnswer?: string; // Bài làm tự luận
  essayAttachment?: string; // File đính kèm bài làm tự luận
}

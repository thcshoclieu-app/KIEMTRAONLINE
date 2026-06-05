import React, { useState, useEffect, useMemo } from 'react';
import { ExamConfig, StudentResult } from '../../types';
import { submitExamToSupabase } from '../../lib/examStorage';
import { shuffleArray } from '../../lib/utils';
import { Clock, CheckCircle2, Send, PenTool, FileType, Trash2 } from 'lucide-react';

interface ExamPlayProps {
  config: ExamConfig;
  studentName: string;
  studentClass?: string;
}

// Kiểu dữ liệu để lưu câu hỏi đã trộn
interface MixedQuestion {
  originalId: string;
  text: string;
  options: { originalIndex: number, text: string }[];
}

export default function ExamPlay({ config, studentName, studentClass }: ExamPlayProps) {
  // Trộn câu hỏi và đáp án nếu cầu hình bật (Chỉ cho trắc nghiệm)
  const mixedQuestions = useMemo<MixedQuestion[]>(() => {
    if (!config.questions || config.questions.length === 0) return [];

    let qs = config.questions;
    if (config.shuffle) {
      qs = shuffleArray(qs);
    }
    
    return qs.map(q => {
      let opts = q.options.map((opt, idx) => ({ originalIndex: idx, text: opt }));
      if (config.shuffle) {
         opts = shuffleArray(opts);
      }
      return {
        originalId: q.id,
        text: q.text,
        options: opts
      };
    });
  }, [config]);

  const [answers, setAnswers] = useState<Record<string, number>>({}); // cho trắc nghiệm nhiều lựa chọn
  const [trueFalseAnswers, setTrueFalseAnswers] = useState<Record<string, Record<string, boolean>>>({}); // cho trắc nghiệm đúng sai
  const [essayAnswer, setEssayAnswer] = useState<string>(''); // cho tự luận
  const [essayFile, setEssayFile] = useState<{name: string, data: string, type: string} | null>(null); // File đính kèm tự luận
  const [timeLeft, setTimeLeft] = useState(config.timeLimit * 60);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [resultData, setResultData] = useState<StudentResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isSubmitted) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isSubmitted]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleSelectOption = (questionId: string, optionIndex: number) => {
    if (isSubmitted) return;
    setAnswers(prev => ({
      ...prev,
      [questionId]: optionIndex
    }));
  };

  const handleSelectTrueFalse = (questionId: string, statementId: string, isTrue: boolean) => {
    if (isSubmitted) return;
    setTrueFalseAnswers(prev => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || {}),
        [statementId]: isTrue
      }
    }));
  };

  const handleSubmit = async () => {
    if (isSubmitted) return;

    if (!studentName.trim() || !studentClass.trim()) {
      alert("Vui lòng nhập họ tên và lớp trước khi nộp bài!");
      return;
    }

    const hasMultipleChoice = mixedQuestions.length > 0;
    const hasTrueFalse = config.trueFalseQuestions && config.trueFalseQuestions.length > 0;
    const hasEssay = !!config.essayPrompt;

    if (hasMultipleChoice && Object.keys(answers).length < mixedQuestions.length) {
       if (!window.confirm("Bạn chưa hoàn thành tất cả câu hỏi trắc nghiệm. Bạn có chắc chắn muốn nộp bài?")) {
         return;
       }
    }

    if (hasEssay && !essayAnswer.trim() && !essayFile) {
       if (!window.confirm("Bạn chưa làm phần tự luận. Bạn có chắc chắn muốn nộp bài?")) {
         return;
       }
    }

    setIsSubmitting(true);
    
    try {
      const payload = {
        examId: config.supabaseExamId || config.examId,
        studentName,
        className: studentClass,
        multipleChoiceAnswers: answers,
        trueFalseAnswers,
        essayAnswer,
        essayAttachment: essayFile ? essayFile.data : null
      };

      const res = await fetch('/api/submit-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      
      if (!res.ok || data.error) {
        throw new Error(data.error || "Không thể lưu bài làm.");
      }

      setResultData({
        ...data,
        studentName,
        studentClass,
        examType: config.examType,
        score: data.totalScore,
        totalScore: data.totalScore,
        multipleChoiceScore: data.multipleChoiceScore,
        trueFalseScore: data.trueFalseScore,
        essayScore: data.essayScore,
        timestamp: new Date().toISOString(),
        correctAnswers: 0,
        totalQuestions: config.questions?.length || 0,
        multipleChoiceAnswers: answers,
        trueFalseAnswers: trueFalseAnswers,
        essayAnswer,
        details: { comments: "Đã nộp bài và chấm điểm tự động" }
      });

      setIsSubmitted(true);
      setIsSubmitting(false);
    } catch (error) {
      console.error(error);
      setIsSubmitting(false);
      alert(error instanceof Error ? error.message : "Không lưu được bài làm. Vui lòng kiểm tra mạng và nộp lại.");
    }
  };

  if (isSubmitted && resultData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="bg-white max-w-lg w-full p-8 rounded-3xl shadow-xl border-t-4 border-blue-500 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Đã Nộp Bài Thành Công!</h2>
          <p className="text-slate-500 mb-6">Kết quả của bạn đã được ghi nhận.</p>
          
          {(config.examType === 'multiple-choice' || config.examType === 'essay' || config.examType === 'exam-builder' || config.examType === 'mixed') && config.showResult ? (
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-left space-y-4">
              <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                <span className="text-slate-500 font-medium">Họ tên:</span>
                <span className="font-bold text-slate-800">{studentName}</span>
              </div>
              {studentClass && (
                <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                  <span className="text-slate-500 font-medium">Lớp:</span>
                  <span className="font-bold text-slate-800">{studentClass}</span>
                </div>
              )}
              {(config.examType === 'multiple-choice' || config.examType === 'exam-builder' || config.examType === 'mixed') && resultData.totalQuestions ? (
                <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                  <span className="text-slate-500 font-medium">Số câu đúng:</span>
                  <span className="font-bold text-blue-600">{resultData.correctAnswers} / {resultData.totalQuestions}</span>
                </div>
              ) : null}
              <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                <span className="text-slate-500 font-medium">Điểm số:</span>
                <span className="font-bold text-3xl text-green-600">{resultData.score}</span>
              </div>
              {(config.examType === 'essay' || config.examType === 'exam-builder' || config.examType === 'mixed') && resultData.details?.comments ? (
                <div className="pt-2">
                  <span className="text-slate-500 font-medium block mb-2">Nhận xét của AI:</span>
                  <span className="text-slate-800 text-sm whitespace-pre-wrap">{resultData.details.comments}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="bg-amber-50 text-amber-800 p-4 rounded-xl border border-amber-200 text-sm">
              Bài làm của bạn đã được gửi cho giáo viên để chấm.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans text-slate-800">
      {/* Header Đếm ngược */}
      <div className="sticky top-0 bg-white border-b border-slate-200 shadow-sm z-50 px-4 py-4 flex justify-between items-center max-w-4xl mx-auto">
        <div>
          <h1 className="font-bold text-slate-800 hidden sm:block">{config.examName}</h1>
          <p className="text-sm text-slate-500">{studentName}</p>
        </div>
        <div className={`flex items-center gap-2 font-mono text-xl font-bold px-4 py-2 rounded-xl transition-colors ${timeLeft < 60 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-blue-50 text-blue-700'}`}>
          <Clock className="w-5 h-5" />
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* Nội dung bài thi */}
      <div className="max-w-3xl mx-auto p-4 sm:p-6 mt-4 space-y-8">
        
        {(config.examType === 'multiple-choice' || config.examType === 'exam-builder' || config.examType === 'mixed') && mixedQuestions.length > 0 && (
          <div>
            {config.examType === 'exam-builder' && <h2 className="text-xl font-bold mb-4 uppercase text-center border-b pb-2">PHẦN TRẮC NGHIỆM</h2>}
            <div className="space-y-8">
              {mixedQuestions.map((q, qIndex) => (
                <div key={q.originalId} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 text-lg">
                      <span className="text-blue-600 mr-2 text-sm font-bold bg-blue-100 px-2 py-1 rounded">Câu {qIndex + 1}</span>
                      {q.text}
                    </h3>
                  </div>
                  <div className="p-6 space-y-3">
                    {q.options.map((opt, optIndex) => {
                      const isSelected = answers[q.originalId] === opt.originalIndex;
                      const labels = ['A', 'B', 'C', 'D'];
                      return (
                        <button
                          key={opt.originalIndex}
                          onClick={() => handleSelectOption(q.originalId, opt.originalIndex)}
                          className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-4 group ${
                            isSelected 
                              ? 'border-blue-500 bg-blue-50' 
                              : 'border-slate-100 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                            isSelected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 group-hover:bg-slate-300'
                          }`}>
                            {labels[optIndex]}
                          </div>
                          <span className={`mt-1 font-medium ${isSelected ? 'text-blue-900' : 'text-slate-700'}`}>
                            {opt.text}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(config.examType === 'exam-builder' || config.examType === 'mixed') && (config.trueFalseQuestions || []).length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4 uppercase text-center border-b pb-2">PHẦN TRẮC NGHIỆM ĐÚNG / SAI</h2>
            <div className="space-y-8">
              {config.trueFalseQuestions!.map((q, qIndex) => (
                <div key={q.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 text-lg">
                      <span className="text-blue-600 mr-2 text-sm font-bold bg-blue-100 px-2 py-1 rounded">Câu {qIndex + 1}</span>
                      {q.text}
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse border border-slate-200">
                        <thead>
                          <tr className="bg-slate-100">
                            <th className="border border-slate-200 p-2 text-center w-12">Ý</th>
                            <th className="border border-slate-200 p-2">Nội dung</th>
                            <th className="border border-slate-200 p-2 text-center w-24">Đúng</th>
                            <th className="border border-slate-200 p-2 text-center w-24">Sai</th>
                          </tr>
                        </thead>
                        <tbody>
                          {q.statements.map((stmt, stmtIndex) => {
                            const studentAns = trueFalseAnswers[q.id]?.[stmt.id];
                            const labels = ['a', 'b', 'c', 'd'];
                            return (
                              <tr key={stmt.id} className="hover:bg-slate-50">
                                <td className="border border-slate-200 p-3 text-center font-bold text-slate-700">{labels[stmtIndex]}</td>
                                <td className="border border-slate-200 p-3 text-slate-800">{stmt.text}</td>
                                <td className="border border-slate-200 p-3 text-center">
                                  <input 
                                    type="radio" 
                                    name={`tf-${q.id}-${stmt.id}`}
                                    className="w-5 h-5 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    checked={studentAns === true}
                                    onChange={() => handleSelectTrueFalse(q.id, stmt.id, true)}
                                  />
                                </td>
                                <td className="border border-slate-200 p-3 text-center">
                                  <input 
                                    type="radio" 
                                    name={`tf-${q.id}-${stmt.id}`}
                                    className="w-5 h-5 text-red-600 focus:ring-red-500 cursor-pointer"
                                    checked={studentAns === false}
                                    onChange={() => handleSelectTrueFalse(q.id, stmt.id, false)}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(config.examType === 'essay' || config.examType === 'exam-builder' || config.examType === 'mixed') && !!config.essayPrompt && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
             <div className="bg-orange-50 px-6 py-4 border-b border-orange-100 flex items-center gap-3">
               <PenTool className="w-5 h-5 text-orange-600" />
               <h3 className="font-bold text-orange-800 uppercase" style={{ fontFamily: "'Times New Roman', Times, serif" }}>PHẦN TỰ LUẬN</h3>
             </div>
             <div className="p-6 border-b border-slate-100 bg-slate-50">
                <div className="text-slate-800 leading-relaxed space-y-4" style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: '14px' }}>
                  {(() => {
                      const normalizedPrompt = (config.essayPrompt || "").normalize('NFC');
                      const paragraphs = normalizedPrompt.split('\n\n').filter((p: string) => p.trim()) || [];
                      
                      return paragraphs.map((p, i) => {
                         const match = p.match(/^(Câu \d+)([:.])?(.*)/is);
                         if (match) {
                            const _ = match[0];
                            const qNum = match[1];
                            const rest = match[3];
                            return (
                              <div key={i}>
                                <p className="mb-0 underline font-semibold text-slate-800">{qNum}:</p>
                                <p className="mt-1">{rest.trim()}</p>
                              </div>
                            );
                         }
                         return <p key={i}>{p}</p>;
                      });
                  })()}
                </div>
             </div>
             <div className="p-6">
                <label className="block text-sm font-bold text-slate-700 mb-3">Bài làm của bạn:</label>
                <textarea
                  className="w-full h-80 p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y leading-relaxed mb-4"
                  placeholder="Nhập nội dung bài làm vào đây... Lưu ý: Bắt buộc ghi rõ số câu (Ví dụ: Câu 1, Câu 2...) ở từng phần trả lời."
                  style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: '14px' }}
                  value={essayAnswer}
                  onChange={(e) => setEssayAnswer(e.target.value)}
                />
                
                <div className="flex flex-col gap-3 bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Hoặc đính kèm file (ảnh/tài liệu bài làm):</label>
                    {!essayFile ? (
                      <input 
                        type="file" 
                        accept="image/*,.pdf,.doc,.docx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => {
                              setEssayFile({
                                name: file.name,
                                type: file.type,
                                data: reader.result as string
                              });
                            };
                            reader.readAsDataURL(file);
                          }
                          e.target.value = '';
                        }}
                        className="text-sm cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-colors w-full"
                      />
                    ) : (
                      <div className="flex items-center justify-between bg-blue-50/50 border border-blue-100 p-3 rounded-lg">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <FileType className="w-6 h-6 text-blue-500 shrink-0" />
                          <span className="truncate text-sm font-medium text-slate-700" title={essayFile.name}>{essayFile.name}</span>
                        </div>
                        <button 
                          onClick={() => setEssayFile(null)} 
                          className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors shrink-0 flex items-center justify-center"
                          title="Xóa file"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
             </div>
          </div>
        )}
        
        {/* Nút Nộp bài */}
        <div className="pt-8 text-center">
          <button 
            onClick={() => {
               if(window.confirm("Bạn có chắc chắn muốn nộp bài?")) {
                 handleSubmit();
               }
            }}
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-12 rounded-2xl shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-3 mx-auto text-lg"
          >
            {isSubmitting ? (
              <span className="animate-pulse">Đang nộp bài...</span>
            ) : (
              <>
                <Send className="w-6 h-6" />
                Nộp bài thi ngay
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

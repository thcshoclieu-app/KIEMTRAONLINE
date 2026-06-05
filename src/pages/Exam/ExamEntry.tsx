import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { decodeExamConfig } from '../../lib/utils';
import { ExamConfig } from '../../types';
import ExamPlay from './ExamPlay';
import { XCircle, User, GraduationCap, Play } from 'lucide-react';

export default function ExamEntry() {
  const { encodedConfig: examId } = useParams<{ encodedConfig: string }>();
  const [config, setConfig] = useState<ExamConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Trạng thái Form
  const [hasStarted, setHasStarted] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [studentClass, setStudentClass] = useState('');

  useEffect(() => {
    async function loadConfig() {
      if (!examId) return;
      
      let decoded: ExamConfig | null = null;
      
      // Try loading from Supabase API (if it's an UUID or small string)
      if (examId.length < 200) {
        try {
          const res = await fetch(`/api/get-exam?examId=${encodeURIComponent(examId)}`);
          const data = await res.json();
          if (res.ok && !data.error) {
            decoded = data as ExamConfig;
          } else {
            console.error("Lỗi khi tải đề từ API:", data.error);
          }
        } catch(e: any) {
          console.error("Lỗi mạng khi tải đề:", e);
        }
      }
      
      // Fallback
      if (!decoded) {
        try {
          decoded = decodeExamConfig(examId);
        } catch(e) {
          console.error('Error decoding config:', e);
        }
      }
      
      if (decoded) {
        // Kiểm tra deadline
        if (decoded.deadline) {
          const now = new Date();
          const deadlineDate = new Date(decoded.deadline);
          if (now > deadlineDate) {
            setError(`Đã quá hạn làm bài! (Hạn chót: ${deadlineDate.toLocaleString('vi-VN')})`);
          } else {
            setConfig(decoded);
          }
        } else {
          setConfig(decoded);
        }
      } else {
        setError("Link bài tập không hợp lệ, đề đã bị xóa hoặc Supabase chưa được cấu hình.");
      }
    }
    
    loadConfig();
  }, [examId]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !studentClass.trim()) {
      alert("Vui lòng nhập đầy đủ Họ tên và Lớp!");
      return;
    }
    setHasStarted(true);
  };

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white max-w-md w-full p-8 rounded-3xl shadow-xl text-center border-t-4 border-red-500">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Không thể truy cập</h2>
          <p className="text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return <div className="min-h-screen flex items-center justify-center">Đang tải...</div>;
  }

  if (hasStarted) {
    return <ExamPlay config={config} studentName={studentName} studentClass={studentClass} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-blue-600 p-8 text-center text-white relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
          <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-blue-800/30 rounded-full blur-xl"></div>
          <GraduationCap className="w-16 h-16 mx-auto mb-4 relative z-10 text-white/90" />
          <h1 className="text-2xl font-bold relative z-10 mb-2">Bài Kiểm Tra Sắp Bắt Đầu</h1>
          <p className="text-blue-100 relative z-10 text-sm">Vui lòng điền thông tin để vào làm bài</p>
        </div>

        <form onSubmit={handleStart} className="p-8 space-y-6 text-slate-800">
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">Khảo thí:</span>
              <span className="font-bold text-blue-800">{config.examName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">Thời gian:</span>
              <span className="font-bold text-blue-800">{config.timeLimit} phút</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 font-medium">Hình thức:</span>
              <span className="font-bold text-blue-800">{config.examType === 'multiple-choice' ? 'Trắc nghiệm' : 'Tự luận'}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Họ và tên của bạn <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                autoFocus
                placeholder="Ví dụ: Nguyễn Văn A"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Lớp <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <GraduationCap className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                value={studentClass}
                onChange={(e) => setStudentClass(e.target.value)}
                placeholder="Ví dụ: 10A1"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 group"
          >
            <Play className="w-5 h-5 group-hover:scale-110 transition-transform" />
            Bắt đầu làm bài
          </button>
        </form>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Book, PenTool, ClipboardList, Download, Settings, Trash2, FileType, Play, CheckSquare, X, Target, Eye, LayoutList, RefreshCw, FileText } from 'lucide-react';
import { ExamConfig, Question, ExamScoreConfig, ScoreLevelConfig, QuestionTypeScoreConfig } from '../../types';
import { encodeExamConfig } from '../../lib/utils';
import { GOOGLE_APPS_SCRIPT_URL } from '../../lib/api';
import Markdown from 'react-markdown';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';
import { saveExamToSupabase, getSubmissionsFromSupabase } from '../../lib/examStorage';
import { exportSubmissionsToExcel } from '../../lib/exportExcel';
import { getCurrentUser, signOutTeacher, getSupabaseClient } from '../../lib/supabase';

const MOCK_QUESTIONS: Question[] = [
  { id: 'q1', text: 'Thủ đô của Việt Nam là gì?', options: ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Huế'], correctAnswerIndex: 0 },
  { id: 'q2', text: '1 + 1 bằng mấy?', options: ['1', '2', '3', '4'], correctAnswerIndex: 1 },
  { id: 'q3', text: 'Mặt trời mọc ở hướng nào?', options: ['Bắc', 'Nam', 'Đông', 'Tây'], correctAnswerIndex: 2 }
];

const MOCK_ESSAY_PROMPT = `Dựa vào những tài liệu đã phân tích, hãy viết một bài văn 500 chữ phân tích ý nghĩa của sự kiên trì trong cuộc sống hiện đại.
Yêu cầu:
- Trình bày rõ ràng 3 luận điểm chính.
- Lấy ví dụ minh họa thực tế.`;

export default function AdminLayout() {
  const navigate = useNavigate();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log('[AUTH GUARD] Checking current session...');
        const session = await getSupabaseClient().auth.getSession();
        if (!session.data.session) {
          navigate('/admin/login', { replace: true });
          return;
        }
        setAllowed(true);
      } catch (e) {
        console.error("Lỗi khi kiểm tra đăng nhập:", e);
        navigate('/admin/login', { replace: true });
      } finally {
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, [navigate]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Đang kiểm tra đăng nhập...</p>
      </div>
    );
  }

  if (!allowed) return null;

  return <AdminLayoutContent />;
}

function AdminLayoutContent() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOutTeacher();
    } catch (e) {
      console.error("Lỗi khi đăng xuất Supabase:", e);
    } finally {
      localStorage.removeItem('admin_auth');
      sessionStorage.removeItem('gemini_api_key');
      sessionStorage.removeItem('gemini_model');
      localStorage.removeItem('gemini_model');
      
      // Fallback: Xóa token Supabase thủ công nếu signOut thất bại
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      navigate('/admin/login', { replace: true });
    }
  };

  // State Tabs
  const [activeMode, setActiveMode] = useState<'multiple-choice' | 'essay' | 'exam-builder' | 'results'>('multiple-choice');
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  
  useEffect(() => {
    if (activeMode === 'results') {
      loadSubmissions();
    }
  }, [activeMode]);

  const loadSubmissions = async () => {
    try {
      const data = await getSubmissionsFromSupabase();
      setSubmissions(data || []);
    } catch (e: any) {
      console.error("Lỗi khi tải kết quả:", e);
      alert(e?.message || "Không thể tải kết quả. Vui lòng kiểm tra lại cấu hình Supabase.");
    }
  };

  // State Tài liệu Tải lên
  const [files, setFiles] = useState<File[]>([]);
  const [promptText, setPromptText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // New states for Exam Builder
  const [examBuilderConfig, setExamBuilderConfig] = useState({
    examTitle: 'KIỂM TRA GIỮA KÌ',
    subject: 'GDCD',
    grade: '6'
  });
  const [examScoreConfig, setExamScoreConfig] = useState<ExamScoreConfig>({
    multipleChoice: {
      totalQuestions: 0,
      levels: {
        biet: { questionCount: 0, score: 0 },
        hieu: { questionCount: 0, score: 0 },
        vanDung: { questionCount: 0, score: 0 }
      }
    },
    trueFalse: {
      totalQuestions: 0,
      levels: {
        biet: { questionCount: 0, score: 0 },
        hieu: { questionCount: 0, score: 0 },
        vanDung: { questionCount: 0, score: 0 }
      }
    },
    essay: {
      totalQuestions: 0,
      levels: {
        biet: { questionCount: 0, score: 0 },
        hieu: { questionCount: 0, score: 0 },
        vanDung: { questionCount: 0, score: 0 }
      }
    }
  });
  const [examBuilderProgress, setExamBuilderProgress] = useState({
    matrix: 'idle', // 'idle' | 'loading' | 'done' | 'error'
    exam: 'idle',
    answer: 'idle'
  });
  const [examBuilderContent, setExamBuilderContent] = useState({
    matrixAndSpecification: '',
    examContent: '',
    answerAndRubric: '',
    fullExamContent: '',
    questions: [],
    trueFalseQuestions: [],
    essayPrompt: ''
  });

  // State Nội dung AI tạo ra
  const [generatedType, setGeneratedType] = useState<'multiple-choice' | 'essay' | 'exam-builder' | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<Question[]>([]);
  const [generatedTrueFalseQuestions, setGeneratedTrueFalseQuestions] = useState<any[]>([]);
  const [generatedEssay, setGeneratedEssay] = useState<string>('');
  const [analysisResult, setAnalysisResult] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'analysis'>('preview');

  // State Cấu hình Modal & Preview
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<{name: string, url: string, type: string} | null>(null);
  // Lấy thời điểm hiện tại cộng thêm 1 ngày cho mặc định deadline
  const defaultDeadline = new Date(Date.now() + 86400000);
  // Định dạng YYYY-MM-DDThh:mm
  const formatDeadline = (date: Date) => {
    const tzOffset = date.getTimezoneOffset() * 60000; // offset in milliseconds
    const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
    return localISOTime;
  };

  const [examName, setExamName] = useState('Bài Kiểm Tra Số 1');
  const [timeLimit, setTimeLimit] = useState(45);
  const [deadline, setDeadline] = useState(formatDeadline(defaultDeadline));
  const [attempts, setAttempts] = useState(1);
  const [pointsPerQuestion, setPointsPerQuestion] = useState(1);
  const [showResult, setShowResult] = useState(true);
  const [generatedLink, setGeneratedLink] = useState('');
  const [isCopied, setIsCopied] = useState(false);


  // Real-time Model State
  const [availableModels, setAvailableModels] = useState<{name: string, displayName: string}[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  const fetchModels = async () => {
    try {
      const apiKey = sessionStorage.getItem('gemini_api_key');
      if (apiKey === null) {
        alert("Vui lòng đăng nhập lại để xác thực phiên sử dụng AI.");
        navigate('/admin/login', { replace: true });
        return;
      }
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      const data = await res.json();
      
      if (!res.ok || data.error) {
        alert(data.error || "Không thể đồng bộ danh sách model mới nhất.");
        return;
      }

      if (data.models && data.models.length > 0) {
        setAvailableModels(data.models);
        // Chế độ đồng bộ thời gian thực: Luôn sử dụng model mới nhất mà API key được cấp phép
        const newestModel = data.models[0].name;
        setSelectedModel(newestModel);
        sessionStorage.setItem('gemini_model', newestModel);
        localStorage.setItem('gemini_model', newestModel);
        sessionStorage.setItem('gemini_model_sync_time', new Date().toISOString());
      } else {
        setAvailableModels([]);
        setSelectedModel('');
        sessionStorage.removeItem('gemini_model');
        localStorage.removeItem('gemini_model');
        alert("API Key hiện tại không có quyền truy cập model Gemini phù hợp.");
      }
    } catch (e) {
      alert("Không thể đồng bộ danh sách model mới nhất.");
    }
  };

  useEffect(() => {
    const savedApiKey = sessionStorage.getItem('gemini_api_key');
    if (savedApiKey === null) {
      navigate('/admin/login', { replace: true });
    } else {
      fetchModels();
    }
  }, []);

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedModel(val);
    sessionStorage.setItem('gemini_model', val);
    localStorage.setItem('gemini_model', val);
  };

  // Xử lý Tải File
  const removeFile = (idx: number) => {
    setFiles(files.filter((_, i) => i !== idx));
  };

  const handlePreviewFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreviewFile({ name: file.name, url, type: file.type });
  };

  const closePreview = () => {
    if (previewFile) {
      URL.revokeObjectURL(previewFile.url);
    }
    setPreviewFile(null);
  };

  // Generate
  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleGenerate = async () => {
    if (files.length === 0) {
      alert("Vui lòng tải lên ít nhất một tài liệu!");
      return;
    }

    const apiKey = sessionStorage.getItem('gemini_api_key');
    if (apiKey === null) {
      alert("Thiếu cấu hình phiên đăng nhập.");
      navigate('/admin/login', { replace: true });
      return;
    }
    
    setIsAnalyzing(true);
    
    try {
      // Xác thực lại API Key và Model trước khi tạo đề
      const verifyRes = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || verifyData.error) {
        setIsAnalyzing(false);
        if (verifyRes.status === 401) {
           alert("Gemini API Key không hợp lệ.");
        } else if (verifyRes.status === 403) {
           alert("API Key hiện tại không có quyền truy cập Gemini API.");
        } else {
           alert(verifyData.error || "Không thể tải danh sách model từ Gemini API.");
        }
        return;
      }
      
      if (!verifyData.models || verifyData.models.length === 0) {
        setIsAnalyzing(false);
        alert("Không tìm thấy model phù hợp để tạo đề kiểm tra.");
        return;
      }

      // Cập nhật lại danh sách model và chọn model mới nhất
      setAvailableModels(verifyData.models);
      let currentSelectedModel = selectedModel || sessionStorage.getItem('gemini_model');
      
      const modelExists = verifyData.models.some((m: any) => m.name === currentSelectedModel);
      if (!modelExists) {
         currentSelectedModel = verifyData.models[0].name;
         setSelectedModel(currentSelectedModel);
         sessionStorage.setItem('gemini_model', currentSelectedModel);
         localStorage.setItem('gemini_model', currentSelectedModel);
         sessionStorage.setItem('gemini_model_sync_time', new Date().toISOString());
      }
      // Dù model cũ còn, ta vẫn bắt buộc chọn model mới nhất theo luồng: 
      // "5. Chọn lại model mới nhất."
      currentSelectedModel = verifyData.models[0].name;
      setSelectedModel(currentSelectedModel);
      sessionStorage.setItem('gemini_model', currentSelectedModel);
      localStorage.setItem('gemini_model', currentSelectedModel);
      sessionStorage.setItem('gemini_model_sync_time', new Date().toISOString());


      const base64Files = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          type: f.type,
          data: await convertFileToBase64(f)
        }))
      );

      /* using selectedModel from state */

      if (activeMode === 'exam-builder') {
          // Xử lý tạo đề thi hoàn chỉnh
          return handleGenerateFullExam(currentSelectedModel, base64Files, apiKey);
      }

      const response = await fetch("/api/generate", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            files: base64Files,
            promptText,
            activeMode,
            selectedModel: currentSelectedModel,
            apiKey
         })
      });

      let data;
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) {
           throw new Error(`Quá trình xử lý thất bại (Lỗi ${response.status}). Có thể model bị quá tải (timeout). Vui lòng thử lại với tài liệu ngắn hơn.`);
        }
        throw new Error("Định dạng dữ liệu trả về không hợp lệ từ máy chủ.");
      }
      if (!response.ok || data?.error) throw new Error(data?.error || "Có lỗi xảy ra khi gọi AI");

      setGeneratedType(activeMode as any);
      if (activeMode === 'essay') {
         setPointsPerQuestion(10);
      } else {
         setPointsPerQuestion(1);
      }
      setGeneratedQuestions(data.questions || []);
      setGeneratedEssay(data.essayPrompt || data.analysisAndFormat || '');
      setAnalysisResult(data.analysisAndFormat);
      setViewMode('preview');

    } catch(err: any) {
      try {
        const p = JSON.parse(err.message);
        alert('Lỗi tạo đề: ' + (p.error?.message || err.message));
      } catch (ex) {
        alert('Lỗi tạo đề: ' + err.message);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleScoreChange = (type: keyof ExamScoreConfig, level: keyof QuestionTypeScoreConfig['levels'] | 'totalQuestions', field: keyof ScoreLevelConfig | null, value: string) => {
    let num: any = parseFloat(value);
    if (isNaN(num) || num < 0) num = 0;
    if (value.endsWith('.')) num = value;
    
    setExamScoreConfig(prev => {
      const updated = JSON.parse(JSON.stringify(prev));
      if (level === 'totalQuestions') {
        updated[type].totalQuestions = typeof num === 'number' ? Math.floor(num) : num;
      } else if (field) {
         if (field === 'questionCount' && typeof num === 'number') num = Math.floor(num);
         updated[type].levels[level as keyof QuestionTypeScoreConfig['levels']][field] = num;
      }
      return updated;
    });
  };

  const renderScoreGroup = (title: string, type: keyof ExamScoreConfig) => {
    const group = examScoreConfig[type];
    return (
      <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 relative">
        <h4 className="text-xs font-bold text-slate-700 mb-2">{title}</h4>
        <div className="flex items-center gap-2 mb-3 border-b border-slate-200 pb-2">
          <label className="text-xs font-medium text-slate-600">Tổng số câu:</label>
          <input type="number" min="0" value={group.totalQuestions} onChange={e => handleScoreChange(type, 'totalQuestions', null, e.target.value)} className="w-16 text-xs border rounded p-1 text-center font-bold" />
        </div>
        <div className="space-y-2">
          {([
            { key: 'biet', label: 'Biết' },
            { key: 'hieu', label: 'Hiểu' },
            { key: 'vanDung', label: 'Vận dụng' }
          ] as const).map(lvl => (
            <div key={lvl.key} className="flex items-center gap-2 text-xs w-full">
              <span className="w-12 font-medium text-slate-500 shrink-0">{lvl.label}:</span>
              <label className="text-slate-500 whitespace-nowrap">Số câu</label>
              <input type="number" min="0" value={group.levels[lvl.key].questionCount} onChange={e => handleScoreChange(type, lvl.key, 'questionCount', e.target.value)} className="w-12 border rounded p-1 text-center bg-white" />
              <label className="text-slate-500 ml-1 whitespace-nowrap">Tổng điểm</label>
              <input type="number" min="0" step="0.25" value={group.levels[lvl.key].score} onChange={e => handleScoreChange(type, lvl.key, 'score', e.target.value)} className="w-16 border rounded p-1 text-center bg-white" />
            </div>
          ))}
        </div>
        {group.totalQuestions > 0 && group.levels.biet.questionCount + group.levels.hieu.questionCount + group.levels.vanDung.questionCount !== group.totalQuestions && (
            <div className="text-[10px] text-red-500 font-bold mt-2 bg-red-50 p-1 rounded border border-red-100">Lỗi: Tổng số câu 3 mức độ chưa bằng {group.totalQuestions}</div>
        )}
      </div>
    );
  };

  const totalExamQuestions = ['multipleChoice', 'trueFalse', 'essay'].reduce((acc, curr) => acc + examScoreConfig[curr as keyof ExamScoreConfig].totalQuestions, 0);
  const totalExamScore = ['multipleChoice', 'trueFalse', 'essay'].reduce((acc, type) => {
    const lvls = examScoreConfig[type as keyof ExamScoreConfig].levels;
    return acc + Object.values(lvls as Record<string, { score?: number }>).reduce(
      (s, lvl) => s + Number(lvl.score || 0),
      0
    );
  }, 0);

  const handleGenerateFullExam = async (currentSelectedModel: string, base64Files: any[], apiKey: string | null) => {
    // Validate score config
    for (const type of ['multipleChoice', 'trueFalse', 'essay'] as const) {
      const g = examScoreConfig[type];
      if (g.totalQuestions > 0) {
        if (g.levels.biet.questionCount + g.levels.hieu.questionCount + g.levels.vanDung.questionCount !== g.totalQuestions) {
           alert(`Lỗi cấu hình: Tổng số câu của ${type} không khớp với tổng số câu các mức độ.`);
           setIsAnalyzing(false);
           return;
        }
      }
    }

    if (Math.abs(totalExamScore - 10) > 0.001) {
       alert(`Lỗi cấu hình: Tổng điểm của toàn bộ bài thi phải đúng bằng 10 điểm. (Hiện tại đang là ${totalExamScore})`);
       setIsAnalyzing(false);
       return;
    }

    try {
      setExamBuilderProgress({ matrix: 'loading', exam: 'idle', answer: 'idle' });
      const response = await fetch("/api/generate-full-exam", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            files: base64Files,
            promptText,
            examTitle: examBuilderConfig.examTitle,
            subject: examBuilderConfig.subject,
            grade: examBuilderConfig.grade,
            scoreConfig: examScoreConfig,
            selectedModel: currentSelectedModel,
            apiKey
         })
      });

      let data;
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) {
           throw new Error(`Quá trình xử lý thất bại (Lỗi ${response.status}). Có thể model bị quá tải (timeout).`);
        }
        throw new Error("Định dạng dữ liệu trả về không hợp lệ từ máy chủ.");
      }
      if (!response.ok || data?.error) throw new Error(data?.error || "Có lỗi xảy ra khi gọi AI");

      setExamBuilderContent({
        matrixAndSpecification: data.matrixAndSpecification || '',
        examContent: data.examContent || '',
        answerAndRubric: data.answerAndRubric || '',
        fullExamContent: data.fullExamContent || '',
        questions: data.questions || [],
        trueFalseQuestions: data.trueFalseQuestions || [],
        essayPrompt: data.essayPrompt || ''
      });
      setGeneratedType('exam-builder');
      setExamBuilderProgress({ matrix: 'done', exam: 'done', answer: 'done' });
      setViewMode('preview');
    } catch(err: any) {
      setExamBuilderProgress({ matrix: 'error', exam: 'error', answer: 'error' });
      try {
        const p = JSON.parse(err.message);
        alert('Lỗi tạo đề thi: ' + (p.error?.message || err.message));
      } catch (ex) {
        alert('Lỗi tạo đề thi: ' + err.message);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCancelGenerate = () => {
    setIsAnalyzing(false);
  };

  const handleReset = () => {
    setFiles([]);
    setPromptText('');
    setGeneratedQuestions([]);
    setGeneratedEssay('');
    setAnalysisResult('');
    setGeneratedType(null);
    closePreview();
    setViewMode('preview');
    const fileInput = document.getElementById('file-upload-input') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  // Tải file Word (Mock Content Dumper)
  const handleDownloadWord = () => {
    let content = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Export</title><style>body { font-family: \'Times New Roman\', serif; font-size: 14pt; }</style></head><body>';
    
    if (generatedType === 'multiple-choice') {
      content += '<h1>BÀI KIỂM TRA TRẮC NGHIỆM</h1><br/>';
      generatedQuestions.forEach((q, i) => {
        content += `<p><strong>Câu ${i + 1}:</strong> ${q.text}</p>`;
        q.options.forEach((opt, optIndex) => {
          const l = ['A', 'B', 'C', 'D'][optIndex];
          content += `<p>${l}. ${opt}</p>`;
        });
        content += '<br/>';
      });
    } else {
      content += '<h1>BÀI KIỂM TRA TỰ LUẬN</h1><br/>';
      const paragraphs = generatedEssay.split('\n\n').filter(p => p.trim());

      paragraphs.forEach((p) => {
         const match = p.match(/^(Câu \d+)([:.])?(.*)/is);
         if (match) {
            const _ = match[0];
            const qNum = match[1];
            const rest = match[3];
            content += `<p><u><strong>${qNum}:</strong></u></p><p>${rest.trim()}</p>`;
         } else {
            content += `<p>${p}</p>`;
         }
      });
    }
    content += '</body></html>';

    const blob = new Blob([content], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `De_Kiem_Tra_${generatedType}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadWordDocx = async (text: string, filename: string) => {
    const lines = text.split('\n');
    const blocks: any[] = [];
    let inTable = false;
    let currentTableRows: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (!inTable) {
          inTable = true;
          currentTableRows = [];
        }
        if (line.match(/^\|[\s-:|]+\|$/) && line.includes('---')) {
          continue; // Bỏ qua dòng format markdown
        }
        const cells = line.split('|').slice(1, -1);
        const isHeader = currentTableRows.length === 0;

        const tableCells = cells.map(cell => {
          let textRuns = [];
          let currentText = cell.trim();
          const boldRegex = /\*\*(.*?)\*\*/g;
          let match;
          let lastIndex = 0;
          while ((match = boldRegex.exec(currentText)) !== null) {
            if (match.index > lastIndex) {
              textRuns.push(new TextRun({ text: currentText.substring(lastIndex, match.index), font: "Times New Roman", size: 28 }));
            }
            textRuns.push(new TextRun({ text: match[1], bold: true, font: "Times New Roman", size: 28 }));
            lastIndex = match.index + match[0].length;
          }
          if (lastIndex < currentText.length) {
            textRuns.push(new TextRun({ text: currentText.substring(lastIndex), font: "Times New Roman", size: 28 }));
          }
          if (textRuns.length === 0) textRuns.push(new TextRun({ text: "", font: "Times New Roman", size: 28 }));
          return new TableCell({
            children: [new Paragraph({ children: textRuns })],
            margins: { top: 100, bottom: 100, left: 100, right: 100 }
          });
        });
        currentTableRows.push(new TableRow({ children: tableCells }));
      } else {
        if (inTable) {
          inTable = false;
          blocks.push(new Table({
            rows: currentTableRows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          }));
        }
        if (line !== '') {
          let textRuns = [];
          let currentText = line;
          const boldRegex = /\*\*(.*?)\*\*/g;
          let match;
          let lastIndex = 0;
          while ((match = boldRegex.exec(currentText)) !== null) {
            if (match.index > lastIndex) {
              textRuns.push(new TextRun({ text: currentText.substring(lastIndex, match.index), font: "Times New Roman", size: 28 }));
            }
            textRuns.push(new TextRun({ text: match[1], bold: true, font: "Times New Roman", size: 28 }));
            lastIndex = match.index + match[0].length;
          }
          if (lastIndex < currentText.length) {
            textRuns.push(new TextRun({ text: currentText.substring(lastIndex), font: "Times New Roman", size: 28 }));
          }
          blocks.push(new Paragraph({ children: textRuns }));
        } else {
          blocks.push(new Paragraph({ text: "" }));
        }
      }
    }
    if (inTable) {
      blocks.push(new Table({
        rows: currentTableRows,
        width: { size: 100, type: WidthType.PERCENTAGE }
      }));
    }

    const doc = new Document({
      sections: [{ properties: {}, children: blocks }]
    });

    try {
      const blob = await Packer.toBlob(doc);
      saveAs(blob, `${filename}.docx`);
    } catch (e) {
      console.error("Error generating docx:", e);
      alert("Đã có lỗi khi tạo file Word. Vui lòng thử lại.");
    }
  };

  // Hàm tạo link
  const createExamLink = async () => {
    if (!deadline) {
      alert("Vui lòng thiết lập Thời gian khóa đề!");
      return;
    }

    const config: ExamConfig = {
      examId: `exam_${Date.now()}`,
      examName,
      examType: generatedType!,
      questions: generatedQuestions,
      trueFalseQuestions: generatedTrueFalseQuestions,
      essayPrompt: generatedEssay,
      timeLimit,
      deadline,
      attempts,
      showResult,
      pointsPerQuestion,
      scoreConfig: examScoreConfig
    };

    if (generatedType === 'exam-builder') {
      config.examType = 'exam-builder';
      config.questions = examBuilderContent.questions || [];
      config.trueFalseQuestions = examBuilderContent.trueFalseQuestions || [];
      config.essayPrompt = examBuilderContent.essayPrompt || '';
      config.matrixAndSpecification = examBuilderContent.matrixAndSpecification || '';
      config.examContent = examBuilderContent.examContent || '';
      config.answerAndRubric = examBuilderContent.answerAndRubric || '';
      config.fullExamContent = examBuilderContent.fullExamContent || '';
      config.subject = examBuilderConfig.subject || '';
      config.grade = examBuilderConfig.grade || '';
    }

    try {
      const data = await saveExamToSupabase(config);
      const studentLink = `${window.location.origin}/exam/${data.id}`;
      setGeneratedLink(studentLink);
      alert("Đã lưu đề vào Supabase và tạo link làm bài.");
    } catch(e: any) {
       console.error("Lưu backend thất bại", e);
       alert(e instanceof Error ? e.message : "Không lưu được đề vào Supabase.");
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800">
      {/* KHUNG BÊN TRÁI: ĐIỀU KHIỂN & TẢI FILE */}
      <div className="w-80 bg-white border-r border-slate-200 shadow-sm flex flex-col z-10 shrink-0">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <Book className="w-8 h-8 text-blue-600" />
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">
            KIỂM TRA ONLINE
          </h1>
        </div>
        
        {/* Tabs Điều Khiển */}
        <div className="flex gap-3 px-4 py-4 bg-slate-50 border-b border-slate-100">
          <button 
            onClick={() => setActiveMode('multiple-choice')} 
            className={`flex-1 flex flex-col items-center justify-center py-3 text-xs font-semibold gap-1 transition-all rounded-xl border-2 ${activeMode === 'multiple-choice' ? 'text-blue-600 border-blue-500 bg-blue-50 shadow-[0_4px_0_0_rgb(59,130,246)] translate-y-[-2px]' : 'text-slate-500 border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 shadow-[0_4px_0_0_rgb(226,232,240)] hover:shadow-[0_4px_0_0_rgb(147,197,253)] translate-y-[-2px] active:translate-y-[2px] active:shadow-none'}`}
          >
            <CheckSquare className="w-6 h-6 mb-1" />
            <span className="text-[10px] uppercase text-center leading-tight">TẠO ĐỀ TRẮC NGHIỆM</span>
          </button>
          <button 
            onClick={() => setActiveMode('essay')} 
            className={`flex-1 flex flex-col items-center justify-center py-3 text-xs font-semibold gap-1 transition-all rounded-xl border-2 ${activeMode === 'essay' ? 'text-blue-600 border-blue-500 bg-blue-50 shadow-[0_4px_0_0_rgb(59,130,246)] translate-y-[-2px]' : 'text-slate-500 border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 shadow-[0_4px_0_0_rgb(226,232,240)] hover:shadow-[0_4px_0_0_rgb(147,197,253)] translate-y-[-2px] active:translate-y-[2px] active:shadow-none'}`}
          >
            <PenTool className="w-6 h-6 mb-1" />
            <span className="text-[10px] uppercase text-center leading-tight">TẠO ĐỀ TỰ LUẬN</span>
          </button>
          <button 
            onClick={() => setActiveMode('exam-builder')} 
            className={`flex-1 flex flex-col items-center justify-center py-3 text-xs font-semibold gap-1 transition-all rounded-xl border-2 ${activeMode === 'exam-builder' ? 'text-blue-600 border-blue-500 bg-blue-50 shadow-[0_4px_0_0_rgb(59,130,246)] translate-y-[-2px]' : 'text-slate-500 border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 shadow-[0_4px_0_0_rgb(226,232,240)] hover:shadow-[0_4px_0_0_rgb(147,197,253)] translate-y-[-2px] active:translate-y-[2px] active:shadow-none'}`}
          >
            <FileText className="w-6 h-6 mb-1" />
            <span className="text-[10px] uppercase text-center leading-tight">TẠO ĐỀ THI</span>
          </button>
          
          <button 
            onClick={() => setActiveMode('results')} 
            className={`flex-1 flex flex-col items-center justify-center py-3 text-xs font-semibold gap-1 transition-all rounded-xl border-2 ${activeMode === 'results' ? 'text-purple-600 border-purple-500 bg-purple-50 shadow-[0_4px_0_0_rgb(147,51,234)] translate-y-[-2px]' : 'text-slate-500 border-slate-200 bg-white hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600 shadow-[0_4px_0_0_rgb(226,232,240)] hover:shadow-[0_4px_0_0_rgb(216,180,254)] translate-y-[-2px] active:translate-y-[2px] active:shadow-none'}`}
          >
            <Settings className="w-6 h-6 mb-1" />
            <span className="text-[10px] uppercase text-center leading-tight">KẾT QUẢ<br/>BÀI LÀM</span>
          </button>
        </div>

        {/* Khu Vực Tải Tệp */}
        {activeMode === 'results' ? (
           <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-5">
              <div className="bg-white rounded-xl shadow border border-purple-200 p-5">
                 <h2 className="text-sm font-semibold text-purple-700 uppercase mb-3">Quản lý kết quả</h2>
                 <p className="text-xs text-slate-500 mb-4">Chọn xuất kết quả ra file Excel để lưu trữ hoặc nhập liệu vào hệ thống khác.</p>
                 <button onClick={() => exportSubmissionsToExcel(submissions)} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-lg shadow flex items-center justify-center gap-2">
                   <Download className="w-5 h-5" /> Xuất Excel
                 </button>
                 <button onClick={loadSubmissions} className="w-full mt-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2 rounded-lg shadow-sm flex items-center justify-center gap-2">
                   Tải lại kết quả
                 </button>
              </div>
           </div>
        ) : (
        <>
        <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Tài liệu Nguồn</h2>
            
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer relative shrink-0">
              <input 
                id="file-upload-input"
                type="file" 
                multiple 
                accept=".txt,.pdf,.doc,.docx,.xls,.xlsx,.csv,image/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    const newFiles = Array.from(e.target.files);
                    setFiles(prev => [...prev, ...newFiles]);
                  }
                  e.target.value = ''; // Reset to allow re-upload 
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <FileType className="w-8 h-8 mx-auto mb-2 text-blue-400 relative z-0" />
              <p className="text-sm font-medium text-slate-700 relative z-0">Nhấp để tải file lên</p>
              <p className="text-xs text-slate-400 mt-1 relative z-0">Nhiều file (docx, pdf, txt, ảnh...)</p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="shrink-0 bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
              <h3 className="text-xs font-semibold text-slate-500 mb-2">ĐÃ TẢI LÊN ({files.length} TỆP)</h3>
              <ul className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {files.map((file, idx) => (
                  <li key={idx} className="flex justify-between items-center text-sm bg-slate-50 p-2 rounded border border-slate-100">
                    <span className="truncate flex-1 font-medium text-slate-700" title={file.name}>{file.name}</span>
                    <div className="flex bg-white rounded border border-slate-200 ml-2 shrink-0 overflow-hidden shadow-sm">
                      <button onClick={() => handlePreviewFile(file)} className="text-blue-500 hover:bg-blue-50 px-2 py-1.5 transition-colors border-r border-slate-200" title="Xem trước">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeFile(idx)} className="text-red-500 hover:bg-red-50 px-2 py-1.5 transition-colors" title="Xóa">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}


          {/* Exam Builder Configurations */}
          {activeMode === 'exam-builder' && (
            <div className="shrink-0 bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cấu hình bài thi</h3>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Tên bài thi:</label>
                <select 
                  className="w-full text-sm border border-slate-300 rounded p-2 outline-none focus:border-blue-500"
                  value={examBuilderConfig.examTitle}
                  onChange={e => setExamBuilderConfig({...examBuilderConfig, examTitle: e.target.value})}
                >
                  <option value="KIỂM TRA GIỮA KÌ">KIỂM TRA GIỮA KÌ</option>
                  <option value="KIỂM TRA CUỐI KÌ">KIỂM TRA CUỐI KÌ</option>
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-slate-600 mb-1">Môn:</label>
                  <input 
                    type="text" 
                    readOnly 
                    value={examBuilderConfig.subject}
                    className="w-full text-sm border border-slate-300 rounded p-2 outline-none bg-slate-50"
                  />
                </div>
                <div className="w-20">
                  <label className="block text-xs text-slate-600 mb-1">Lớp:</label>
                  <select 
                    className="w-full text-sm border border-slate-300 rounded p-2 outline-none focus:border-blue-500"
                    value={examBuilderConfig.grade}
                    onChange={e => setExamBuilderConfig({...examBuilderConfig, grade: e.target.value})}
                  >
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                    <option value="9">9</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Exam Score Configurations */}
          {activeMode === 'exam-builder' && (
            <div className="shrink-0 bg-white border border-slate-200 rounded-xl p-3 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                 <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cấu hình điểm</h3>
                 <div className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded font-bold border border-blue-100 flex gap-4">
                    <span>Tổng câu: {totalExamQuestions}</span>
                    <span>Tổng điểm: {Number(totalExamScore.toFixed(2))}</span>
                 </div>
              </div>
              <div className="space-y-3 overflow-y-auto max-h-[350px] pr-1">
                 {renderScoreGroup('TNNLC - Trắc nghiệm nhiều lựa chọn', 'multipleChoice')}
                 {renderScoreGroup('TN ĐÚNG - SAI - Trắc nghiệm đúng sai', 'trueFalse')}
                 {renderScoreGroup('TỰ LUẬN', 'essay')}
              </div>
            </div>
          )}

          {/* Khung Nhập Prompt */}
          <div className="shrink-0">
             <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Yêu cầu cho AI (Prompt)</label>
             <textarea 
               value={promptText}
               onChange={(e) => setPromptText(e.target.value)}
               placeholder={activeMode === 'exam-builder' ? "Ví dụ: Tạo đề theo mức độ nhận biết, thông hiểu, vận dụng; bám sát nội dung tài liệu..." : activeMode === 'multiple-choice' ? "VD: Tạo 10 câu hỏi trắc nghiệm mức độ cơ bản..." : "VD: Chú trọng vào nội dung phần 2 của tài liệu..."}
               className="w-full text-sm border border-slate-300 rounded-xl p-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 min-h-[100px] resize-y bg-white shadow-sm"
             />
          </div>

          {/* Action Buttons */}
          <div className="mt-auto pt-2 space-y-2 shrink-0">
            <button 
              onClick={handleGenerate}
              disabled={isAnalyzing || files.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-2.5 rounded-lg flex justify-center items-center gap-2 transition-colors shadow-sm"
            >
              {isAnalyzing ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                  Đang phân tích...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Tạo đề với AI
                </>
              )}
            </button>
            <button 
              onClick={handleCancelGenerate}
              disabled={!isAnalyzing}
              className="w-full bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-medium py-2.5 rounded-lg flex justify-center items-center gap-2 transition-colors"
            >
              <X className="w-4 h-4" />
              Hủy tạo đề
            </button>
            <button 
              onClick={handleReset}
              className="w-full bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium py-2.5 rounded-lg flex justify-center items-center gap-2 transition-colors border border-rose-200"
            >
              <RefreshCw className="w-4 h-4" />
              Làm mới hệ thống
            </button>
          </div>
        </div>
        </>
        )}

        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-red-600 hover:bg-red-50 hover:border-red-100 border border-transparent rounded-lg transition-colors font-medium text-sm"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>

      {/* KHUNG BÊN PHẢI: KẾT QUẢ AI & ACTION */}
      <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden relative">
        {activeMode === 'results' ? (
          <div className="flex-1 p-6 overflow-y-auto">
            <h2 className="text-2xl font-bold text-slate-800 border-b border-slate-200 pb-4 mb-6">Kết quả bài làm của học sinh</h2>
            
            {submissions.length === 0 ? (
              <p className="text-slate-500 text-center py-10 bg-white rounded-xl shadow-sm border border-slate-200">Chưa có kết quả nộp bài nào.</p>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="p-3 font-semibold">Thời gian</th>
                      <th className="p-3 font-semibold">Học sinh</th>
                      <th className="p-3 font-semibold">Lớp</th>
                      <th className="p-3 font-semibold">Bài thi</th>
                      <th className="p-3 font-semibold">Điểm TN</th>
                      <th className="p-3 font-semibold">Điểm Đ/S</th>
                      <th className="p-3 font-semibold">Điểm Tự luận</th>
                      <th className="p-3 font-semibold">Tổng điểm</th>
                      <th className="p-3 font-semibold text-center">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {submissions.map((sub: any) => (
                      <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 text-slate-500 whitespace-nowrap">{new Date(sub.submitted_at).toLocaleString('vi-VN')}</td>
                        <td className="p-3 font-medium text-slate-800">{sub.student_name}</td>
                        <td className="p-3 text-slate-600">{sub.class_name}</td>
                        <td className="p-3 text-slate-700">
                           <div className="font-semibold text-blue-700">{sub.exams?.title}</div>
                           <div className="text-xs text-slate-500">{sub.exams?.subject} - Lớp {sub.exams?.grade}</div>
                        </td>
                        <td className="p-3 text-blue-600 font-medium">{Number(sub.multiple_choice_score || 0).toFixed(2)}</td>
                        <td className="p-3 text-indigo-600 font-medium">{Number(sub.true_false_score || 0).toFixed(2)}</td>
                        <td className="p-3 text-orange-600 font-medium">{Number(sub.essay_score || 0).toFixed(2)}</td>
                        <td className="p-3 text-green-600 font-bold text-base">{Number(sub.total_score || 0).toFixed(2)}</td>
                        <td className="p-3 text-center">
                          <button 
                            onClick={() => setSelectedSubmission(sub)}
                            className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold rounded"
                          >
                            Xem
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : generatedType === 'exam-builder' ? (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto w-full max-w-5xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-slate-800 border-b border-slate-200 pb-4">
              Kết Quả Tạo Đề Thi: {examBuilderConfig.examTitle}
            </h2>

            {/* Tiến độ 3 bước */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex gap-4 justify-between items-center text-center">
              {[
                { id: 'matrix', label: '1. Ma trận & Bảng đặc tả' },
                { id: 'exam', label: '2. Đề thi' },
                { id: 'answer', label: '3. Đáp án & Hướng dẫn chấm' }
              ].map(step => (
                <div key={step.id} className="flex-1 flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm mb-2 shadow-sm ${
                    examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'done' ? 'bg-green-100 text-green-700' :
                    examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'loading' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                    examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'error' ? 'bg-red-100 text-red-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'done' ? '✓' : step.id === 'matrix' ? '1' : step.id === 'exam' ? '2' : '3'}
                  </div>
                  <span className="text-sm font-semibold text-slate-700">{step.label}</span>
                  <span className="text-xs mt-1 px-2 py-0.5 rounded-full bg-slate-50 text-slate-500">
                    {examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'done' ? 'Hoàn thành' : 
                     examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'loading' ? 'Đang tạo...' : 
                     examBuilderProgress[step.id as keyof typeof examBuilderProgress] === 'error' ? 'Lỗi' : 'Chưa bắt đầu'}
                  </span>
                </div>
              ))}
            </div>

            {/* Nội dung đã tạo */}
            {examBuilderProgress.matrix === 'done' && (
              <div className="grid grid-cols-1 gap-6">
                
                {/* Hành động tải */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-wrap gap-3 items-center justify-between">
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => handleDownloadWordDocx(examBuilderContent.matrixAndSpecification, 'Ma_tran_va_bang_dac_ta')}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm border border-indigo-200"
                    >
                      <Download className="w-4 h-4" /> Tải Ma trận
                    </button>
                    <button 
                      onClick={() => handleDownloadWordDocx(examBuilderContent.examContent, 'De_thi')}
                      className="bg-sky-50 hover:bg-sky-100 text-sky-700 font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm border border-sky-200"
                    >
                      <Download className="w-4 h-4" /> Tải Đề thi
                    </button>
                    <button 
                      onClick={() => handleDownloadWordDocx(examBuilderContent.answerAndRubric, 'Dap_an_va_huong_dan_cham')}
                      className="bg-orange-50 hover:bg-orange-100 text-orange-700 font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm border border-orange-200"
                    >
                      <Download className="w-4 h-4" /> Tải Đáp án
                    </button>
                    <button 
                      onClick={() => handleDownloadWordDocx(examBuilderContent.fullExamContent, `De_thi_hoan_chinh_${examBuilderConfig.subject}_Lop_${examBuilderConfig.grade}_${examBuilderConfig.examTitle.replace(/ /g, '_')}`)}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2 rounded-lg flex items-center gap-2 transition-colors tracking-wide text-sm shadow-sm"
                    >
                      <Download className="w-4 h-4" /> Tải file đề thi hoàn chỉnh
                    </button>
                  </div>
                  <button 
                    onClick={() => {
                        setGeneratedQuestions(examBuilderContent.questions);
                        setGeneratedTrueFalseQuestions(examBuilderContent.trueFalseQuestions);
                        setGeneratedEssay(examBuilderContent.essayPrompt);
                        setExamName(`Đề thi ${examBuilderConfig.subject} Lớp ${examBuilderConfig.grade} - ${examBuilderConfig.examTitle}`);
                        setIsConfigModalOpen(true); 
                        setGeneratedLink('');
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm text-sm shrink-0"
                  >
                    <Settings className="w-4 h-4" /> Tạo link làm bài online
                  </button>
                </div>

                {/* Preview Content */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 prose prose-slate max-w-none text-slate-800 text-sm overflow-hidden" style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: '14px' }}>
                   <Markdown>{examBuilderContent.fullExamContent}</Markdown>
                </div>
              </div>
            )}
            
          </div>
        ) : generatedType ? (
          <>
            {/* Thanh công cụ Tải/Cấu hình */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm z-10 shrink-0">
              <div className="flex gap-4 items-center">
                <button 
                  onClick={() => setViewMode('analysis')}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${viewMode === 'analysis' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Eye className="w-4 h-4" />
                  Bản phân tích (Định dạng chuẩn)
                </button>
                <button 
                  onClick={() => setViewMode('preview')}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${viewMode === 'preview' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <LayoutList className="w-4 h-4" />
                  Giao diện đề thi (Học sinh)
                </button>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={handleDownloadWord}
                  className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm text-sm"
                >
                  <Download className="w-4 h-4 text-blue-600" />
                  Tải file Word (.docx)
                </button>
                <button 
                  onClick={() => { setIsConfigModalOpen(true); setGeneratedLink(''); }}
                  className="bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm text-sm"
                >
                  <Settings className="w-4 h-4" />
                  Cấu hình & Copy Link
                </button>
              </div>
            </div>

            {/* Vùng hiển thị nội dung AI */}
            <div className="flex-1 overflow-auto p-8">
              <div className="max-w-4xl mx-auto bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
                {viewMode === 'analysis' ? (
                   <div className="prose prose-slate max-w-none">
                     <Markdown>{analysisResult || "Đang chờ phân tích..."}</Markdown>
                   </div>
                ) : (
                  generatedType === 'multiple-choice' ? (
                    <div className="space-y-6">
                      <div className="text-center mb-8 border-b border-slate-100 pb-4">
                        <h2 className="text-2xl font-bold text-slate-800 uppercase">ĐỀ THI TRẮC NGHIỆM</h2>
                      </div>
                      {generatedQuestions.length > 0 ? generatedQuestions.map((q, i) => (
                        <div key={q.id} className="pb-6 border-b border-slate-100 last:border-0 last:pb-0">
                          <p className="font-semibold text-slate-800 mb-3"><span className="mr-2 text-blue-600">Câu {i + 1}.</span>{q.text}</p>
                          <div className="grid grid-cols-2 gap-3 pl-6">
                            {q.options.map((opt, optIndex) => (
                              <div key={optIndex} className={`text-sm p-2 rounded-md ${q.correctAnswerIndex === optIndex ? 'bg-green-50 border border-green-200 text-green-800 font-medium' : 'bg-slate-50 border border-slate-100 text-slate-600'}`}>
                                {['A', 'B', 'C', 'D'][optIndex]}. {opt}
                              </div>
                            ))}
                          </div>
                        </div>
                      )) : <p className="text-slate-500 text-center">Không có câu hỏi nào được tạo thành cấu trúc.</p>}
                    </div>
                  ) : (
                    <div>
                      <div className="text-center mb-8 border-b border-slate-100 pb-4">
                        <h2 className="text-2xl font-bold text-slate-800 uppercase" style={{ fontFamily: "'Times New Roman', Times, serif" }}>ĐỀ THI TỰ LUẬN</h2>
                      </div>
                      <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed" style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: '14px' }}>
                        {!generatedEssay ? "Không có câu hỏi tự luận nào được tạo thành cấu trúc." : (
                          (() => {
                            const normalizedEssay = generatedEssay.normalize('NFC');
                            const paragraphs = normalizedEssay.split('\n\n').filter((p: string) => p.trim());
                            
                            return (
                              <div className="space-y-4">
                                {paragraphs.map((p: string, i: number) => {
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
                                })}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
            {files.length > 0 ? (
               <>
                 <FileType className="w-16 h-16 mb-4 text-blue-500" />
                 <p className="text-lg font-bold text-slate-700">Đã tải lên {files.length} tài liệu</p>
                 <p className="text-sm mt-2 text-slate-500 max-w-md line-clamp-2">Nhập thêm yêu cầu Prompt (nếu có) và nhấn <strong>Tạo đề với AI</strong> để bắt đầu.</p>
               </>
            ) : (
               <>
                 <Target className="w-16 h-16 mb-4 text-slate-200" />
                 <p className="text-lg font-medium">Bảng kết quả trung tâm</p>
                 <p className="text-sm mt-1">Nội dung đề bài tự động tạo bằng AI sẽ hiển thị ở đây sau khi bạn tải tài liệu và bấm nút Tạo.</p>
               </>
            )}
          </div>
        )}
      </div>

      {/* MODAL CẤU HÌNH & GỬI LINK */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-600" />
                Cấu hình Bài Kiểm Tra
              </h3>
              <button onClick={() => setIsConfigModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
               <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Tên bài kiểm tra</label>
                  <input type="text" value={examName} onChange={e => setExamName(e.target.value)} className="w-full border border-slate-200 px-3 py-2 rounded outline-none focus:border-blue-500" />
               </div>
               <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Thời gian làm bài (Phút)</label>
                  <input type="number" min="1" value={timeLimit} onChange={e => setTimeLimit(parseInt(e.target.value) || 45)} className="w-full border border-slate-200 px-3 py-2 rounded outline-none focus:border-blue-500" />
               </div>
               <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Thời gian khóa đề (Bắt buộc)</label>
                  <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full border border-slate-200 px-3 py-2 rounded outline-none focus:border-blue-500" />
               </div>
               <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Số lần làm bài</label>
                  <input type="number" min="1" value={attempts} onChange={e => setAttempts(parseInt(e.target.value) || 1)} className="w-full border border-slate-200 px-3 py-2 rounded outline-none focus:border-blue-500" />
               </div>
               <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {generatedType === 'multiple-choice' ? 'Điểm cho mỗi câu đúng' : 'Thang điểm tối đa'}
                  </label>
                  <input type="number" min="0.1" step="0.1" value={pointsPerQuestion} onChange={e => setPointsPerQuestion(parseFloat(e.target.value) || 1)} className="w-full border border-slate-200 px-3 py-2 rounded outline-none focus:border-blue-500" />
               </div>
               
               {generatedType === 'multiple-choice' && (
                 <label className="flex items-center gap-2 mt-4 cursor-pointer">
                    <input type="checkbox" checked={showResult} onChange={e => setShowResult(e.target.checked)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300" />
                    <span className="text-sm font-medium text-slate-700">Xem điểm ngay sau khi nộp</span>
                 </label>
               )}
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 space-y-3">
               {!generatedLink ? (
                 <button onClick={createExamLink} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded shadow flex items-center justify-center gap-2">
                   Xác nhận & Tạo Link
                 </button>
               ) : (
                 <div className="bg-green-50 border border-green-200 rounded p-4 space-y-2">
                   <p className="text-xs text-green-800 font-bold uppercase">Link bài làm:</p>
                   <input readOnly value={generatedLink} className="w-full border border-green-300 bg-white text-green-900 px-2 py-1.5 rounded outline-none text-xs font-mono" />
                   <button onClick={() => { 
                     navigator.clipboard.writeText(generatedLink); 
                     setIsCopied(true);
                     setTimeout(() => setIsCopied(false), 2000);
                   }} className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded shadow flex justify-center text-sm transition-all duration-200">
                     {isCopied ? "Đã copy" : "Copy Link"}
                   </button>
                 </div>
               )}
               <button onClick={() => setIsConfigModalOpen(false)} className="w-full bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2.5 rounded shadow-sm flex items-center justify-center gap-2 transition-colors">
                 Đóng
               </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL XEM TRƯỚC FILE */}
      {previewFile && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <FileType className="w-5 h-5 text-blue-600" />
                {previewFile.name}
              </h3>
              <button onClick={closePreview} className="text-slate-400 hover:text-slate-600 transition-colors p-1 bg-white rounded-md border border-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 bg-slate-100 p-4 overflow-hidden">
              {previewFile.type.includes('pdf') || previewFile.type.includes('text') || previewFile.name.endsWith('.pdf') || previewFile.name.endsWith('.txt') ? (
                <iframe 
                  src={previewFile.url} 
                  className="w-full h-full bg-white border border-slate-200 rounded-xl shadow-inner" 
                  title="Preview" 
                />
              ) : (
                <div className="w-full h-full bg-white border border-slate-200 rounded-xl shadow-inner flex flex-col items-center justify-center text-slate-500">
                  <FileType className="w-16 h-16 mb-4 text-slate-300" />
                  <p className="text-lg font-medium text-slate-800">Trình duyệt không hỗ trợ xem trước tệp này.</p>
                  <p className="text-sm mt-2">Đừng lo, AI vẫn có thể đọc và trích xuất dữ liệu từ các định dạng này.</p>
                  <a href={previewFile.url} download={previewFile.name} className="mt-6 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Tải tệp xuống
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL CHI TIẾT KẾT QUẢ */}
      {selectedSubmission && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                Chi tiết bài làm: {selectedSubmission.student_name}
              </h3>
              <button onClick={() => setSelectedSubmission(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
               <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div><span className="text-slate-500 font-medium">Họ tên:</span> <span className="font-bold">{selectedSubmission.student_name}</span></div>
                  <div><span className="text-slate-500 font-medium">Lớp:</span> <span className="font-bold">{selectedSubmission.class_name}</span></div>
                  <div><span className="text-slate-500 font-medium">Đề thi:</span> <span className="font-bold text-blue-700">{selectedSubmission.exams?.title}</span></div>
                  <div><span className="text-slate-500 font-medium">Tổng điểm:</span> <span className="font-bold text-green-600 text-xl">{Number(selectedSubmission.total_score || 0).toFixed(2)}</span></div>
               </div>

               <div>
                 <h4 className="font-bold text-slate-700 mb-2 border-b pb-1">Trả lời Trắc Nghiệm TN (Điểm: {Number(selectedSubmission.multiple_choice_score || 0).toFixed(2)})</h4>
                 <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm font-mono overflow-auto max-h-40">
                   {JSON.stringify(selectedSubmission.multiple_choice_answers || {}, null, 2)}
                 </div>
               </div>

               <div>
                 <h4 className="font-bold text-slate-700 mb-2 border-b pb-1">Trả lời Đ/S (Điểm: {Number(selectedSubmission.true_false_score || 0).toFixed(2)})</h4>
                 <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm font-mono overflow-auto max-h-40">
                   {JSON.stringify(selectedSubmission.true_false_answers || {}, null, 2)}
                 </div>
               </div>

               <div>
                 <h4 className="font-bold text-slate-700 mb-2 border-b pb-1">Bài làm Tự luận (Điểm: {Number(selectedSubmission.essay_score || 0).toFixed(2)})</h4>
                 <div className="bg-white p-4 rounded-lg border border-slate-200 text-sm whitespace-pre-wrap font-serif leading-relaxed">
                   {selectedSubmission.essay_answer || 'Không có dữ liệu'}
                 </div>
               </div>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 text-right">
              <button 
                onClick={() => setSelectedSubmission(null)} 
                className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium px-5 py-2.5 rounded shadow-sm"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

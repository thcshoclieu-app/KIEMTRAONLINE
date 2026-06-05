import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, User, Lock, Mail, Key, Eye, EyeOff } from 'lucide-react';
import { signInTeacher, getSupabaseClient, isSupabaseConfigured } from '../../lib/supabase';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Load saved credentials on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('saved_email');
    const savedApiKey = sessionStorage.getItem('gemini_api_key');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
    if (savedApiKey) setApiKey(savedApiKey);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isSupabaseConfigured) {
      alert('Chưa cấu hình Supabase. Vui lòng thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trên Netlify rồi redeploy.');
      setLoading(false);
      return;
    }

    if (!email || !password) {
      alert("Vui lòng nhập đầy đủ Email và Mật khẩu!");
      return;
    }

    console.log('[LOGIN] Supabase configured:', isSupabaseConfigured);
    console.log('[LOGIN] Email:', email.trim());

    setLoading(true);
    
    try {
      // 1. Authenticate with Supabase
      const { data: authData, error: authError } = await signInTeacher(email.trim(), password);
      
      if (authError || !authData.user) {
        setLoading(false);
        let msg = authError?.message || "Đăng nhập Supabase thất bại.";
        if (msg.toLowerCase().includes("invalid login credentials") || msg.toLowerCase().includes("invalid credentials")) {
          msg = "Sai email/mật khẩu hoặc tài khoản giáo viên chưa được tạo trong Supabase Authentication.";
        } else if (msg.toLowerCase().includes("email not confirmed")) {
          msg = "Email giáo viên chưa được xác nhận. Hãy vào Supabase Auth để confirm user hoặc tắt yêu cầu confirm email.";
        } else if (msg.toLowerCase().includes("failed to fetch")) {
          msg = "Không kết nối được Supabase. Kiểm tra VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY và mạng.";
        }
        alert(msg);
        return;
      }

      console.log('[LOGIN] Supabase user:', authData.user?.email);
      console.log('[LOGIN] Has session:', Boolean(authData.session));

      // Validate session was saved
      const { data: sessionData } = await getSupabaseClient().auth.getSession();

      if (!sessionData.session) {
        alert('Đăng nhập thành công nhưng không lưu được session. Vui lòng kiểm tra trình duyệt hoặc cấu hình Supabase.');
        setLoading(false);
        return;
      }

      // 2. Validate Gemini API Key (Không bắt buộc chặn đăng nhập)
      let models = [];
      let apiKeyStatus = 'pending';
      try {
        const res = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiKey.trim() })
        });
        const data = await res.json();
        
        if (res.ok && !data.error && data.models && data.models.length > 0) {
           models = data.models;
           apiKeyStatus = 'valid';
        } else {
           console.warn("Gemini validation warning:", data.error);
           apiKeyStatus = 'invalid';
        }
      } catch (e) {
        console.warn("Lỗi kiểm tra API Key:", e);
        apiKeyStatus = 'error';
      }

      // Vẫn cho phép đăng nhập thành công
      if (models.length > 0) {
        const newestModel = models[0].name;
        sessionStorage.setItem('gemini_model', newestModel);
        localStorage.setItem('gemini_model', newestModel);
      }
      
      sessionStorage.setItem('gemini_api_key', apiKey.trim());
      sessionStorage.setItem('gemini_model_sync_time', new Date().toISOString());
      sessionStorage.setItem('gemini_api_key_status', apiKeyStatus);
      
      if (rememberMe) {
        localStorage.setItem('saved_email', email.trim());
      } else {
        localStorage.removeItem('saved_email');
      }

      // alert("Đăng nhập thành công!"); // Có thể bỏ alert nếu navigate
      navigate('/admin', { replace: true });

    } catch (e: any) {
      setLoading(false);
      console.error(e);
      alert("Lỗi khi đăng nhập: " + (e.message || e));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        {/* Left Side: Branding */}
        <div className="p-8 md:p-12 text-center bg-blue-600 text-white flex flex-col items-center justify-center md:w-5/12">
          <BookOpen className="w-20 h-20 mx-auto mb-6 text-white/90" />
          <h1 className="text-3xl font-bold mb-3 tracking-tight">KIỂM TRA ONLINE</h1>
          <p className="text-blue-100 text-lg">Nền tảng kiểm tra trực tuyến</p>
        </div>
        
        {/* Right Side: Form */}
        <div className="p-8 md:p-12 md:w-7/12 flex flex-col justify-center">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">
            Đăng nhập hệ thống (Giáo viên)
          </h2>
          
          {!isSupabaseConfigured && (
            <div className="mb-6 p-4 bg-yellow-50 border whitespace-pre-wrap border-yellow-200 text-yellow-800 rounded-lg text-sm">
              Chưa cấu hình Supabase frontend. Hãy thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trên Netlify rồi redeploy.
              <br/><br/>
              <span className="font-semibold text-xs">Lưu ý: VITE_* được inject lúc build, sau khi thêm biến môi trường trên Netlify phải Redeploy.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (Supabase Auth)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="teacher@example.com"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gemini API Key (Tùy chọn)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                    placeholder="Để trống nếu Server đã cấu hình sẵn"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showApiKey ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-sm text-gray-600">Nhớ email đăng nhập</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 mt-2 disabled:opacity-70 shadow-sm"
            >
              {loading ? (
                <span className="animate-pulse">Đang xử lý...</span>
              ) : (
                'Đăng nhập'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

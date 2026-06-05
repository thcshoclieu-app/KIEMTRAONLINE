import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './pages/Admin/AdminLayout';
import AdminLogin from './pages/Admin/AdminLogin';
import ExamEntry from './pages/Exam/ExamEntry';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        
        {/* Route Giới thiệu đăng nhập Giáo viên */}
        <Route path="/admin/login" element={<AdminLogin />} />
        
        {/* Route Bảng điều khiển Giáo viên */}
        <Route path="/admin/*" element={<AdminLayout />} />
        
        {/* Route Bài thi học sinh */}
        <Route path="/exam/:encodedConfig" element={<ExamEntry />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

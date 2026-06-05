# Kiểm tra online AI

Ứng dụng tạo đề kiểm tra bằng Gemini, giao bài online cho học sinh, lưu đề và bài làm vào Supabase, giáo viên xem kết quả và xuất Excel. Phiên bản này đã tích hợp đầy đủ Backend chấm bài và Supabase Auth cho Giáo viên.

## Mô hình triển khai

- **Frontend**: Vite + React, deploy lên Netlify
- **Backend (API)**: Netlify Functions (chấm điểm, fetch models)
- **Database + Auth**: Supabase

## Luồng dữ liệu bảo mật (Mới)

1. **Giáo viên**: Phải dùng Supabase Auth (Email/Password) để đăng nhập vào Admin. Tài khoản được tạo từ Supabase Auth Dashboard.
2. **Tạo Đề**: Giáo viên tạo đề, hệ thống lưu đề vào Supabase kèm theo `owner_id` (được bảo vệ qua RLS).
3. **Học sinh làm bài**: Học sinh mở link (không cần đăng nhập). Frontend sẽ fetch đề từ Supabase (bản đã xóa đáp án để chống gian lận).
4. **Nộp bài & Chấm tự động**: Học sinh gửi POST lên `/api/submit-exam` (Netlify function backend). Backend dùng biến môi trường có quyền Service Role để đọc đáp án, chấm điểm trắc nghiệm và chấm đúng/sai, sau đó chèn bài làm vào bảng `submissions`.
5. **Xem kết quả**: Giáo viên xem kết quả ở dashboard (RLS bảo vệ: chỉ xem được bài làm thuộc các đề do mình sở hữu).

## Cài đặt local

```bash
npm install
npm run build
```

## Biến môi trường cần có

### Trên Frontend (.env)
Dùng để kết nối Supabase client bằng quyền ẩn danh.
```bash
VITE_SUPABASE_URL="yours"
VITE_SUPABASE_ANON_KEY="yours"
```

### Trên Backend Netlify Environment Variables
Bắt buộc phải có để chấm điểm và gọi AI.
```bash
GEMINI_API_KEY="yours"
SUPABASE_URL="yours"
SUPABASE_SERVICE_ROLE_KEY="yours"  # Không được đưa biến này ra frontend
```

## Supabase Cài Đặt

1. Tạo database.
2. Tạo Auth User (Giáo viên) trong bảng `auth.users`.
3. Chạy lệnh SQL trong file sau tại trình duyệt SQL của Supabase để khởi tạo hoặc cập nhật bảng:

   **Bản thi thật, bảo mật an toàn:**
   Chạy file `supabase_schema_secure.sql`.

## Thử nghiệm chống xem trộm đáp án
1. Mở link học sinh `/exam/uuid`.
2. Mở DevTools (F12) → tab **Network**.
3. Chọn Request có đường dẫn `/api/get-exam...`
4. Ở phần Preview hoặc Response, kiểm tra cấu trúc JSON trả về.
5. Sẽ **KHÔNG** hề tồn tại trường dữ liệu `answer_data`, `correctAnswerIndex`, `isTrue`, `answerAndRubric`, hay `fullExamContent` chứa đáp án.

## Lưu ý bảo mật
- **Không bao giờ lộ đáp án:** Hàm lấy đề của học sinh thông qua endpoint `/api/get-exam` đã lọc sạch toàn bộ dữ liệu nhạy cảm.
- **Không lộ dữ liệu nộp bài:** Bảng `submissions` có RLS ẩn hoàn toàn dữ liệu với anon và chỉ dùng service_role trong nội bộ `/api/submit-exam`. Bảng `exams` cũng không cho phép anon SELECT trực tiếp.
- Không đưa `SUPABASE_SERVICE_ROLE_KEY` vào mã nguồn `.env` gửi cho trình duyệt.
- Không bao giờ lưu Password tải xuống `localStorage`.

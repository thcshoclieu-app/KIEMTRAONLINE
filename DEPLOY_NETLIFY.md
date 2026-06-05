# Hướng Dẫn Deploy Lên Netlify & Cấu Hình Supabase

Dự án này sử dụng mô hình **Vite Frontend + Netlify Functions + Supabase**. Mọi phụ thuộc vào Express Server (Render) hay Google Sheets (trực tiếp) đã được chuyển sang luồng mới an toàn và mở rộng hơn.

---

## 1. Cấu hình Supabase (Auth + RLS Bảo mật)

Ứng dụng dùng Supabase để lưu trữ **Đề thi** (`exams`) và **Kết quả bài làm** (`submissions`), đồng thời dùng Supabase Auth để bảo mật trang admin cho Giáo Viên.

### Bước 1: Tạo Project Supabase
1. Đăng nhập [Supabase](https://supabase.com).
2. Tạo 1 **Project** mới.

### Bước 2: Tạo Tài Khoản Giáo Viên
1. Vào mục **Authentication** -> **Users**.
2. Chọn **Add User** -> Tạo một email và password cho giáo viên (VD: teacher@example.com / password123).
3. Tài khoản này sẽ được dùng để đăng nhập vào trang Admin nhằm tạo đề và xem điểm.

### Bước 3: Chạy Script SQL Bảo Mật
Vào trang quản trị Supabase -> **SQL Editor** -> Dán nội dung của file `supabase_schema_secure.sql` vào và bấm **Run**.

Script này sẽ:
- Tạo bảng `exams` (có cột `owner_id` nối với bảng user).
- Tạo bảng `submissions`.
- Bật **Row Level Security (RLS)** để:
  - Học sinh KHÔNG THỂ đọc (SELECT) bảng `exams` hay `submissions` bằng client. App thay vào đó gọi Netlify Function `/api/get-exam` để tải đề an toàn.
  - Giáo viên chỉ thấy đề và bài làm do chính tài khoản của mình tạo ra.

### Bước 4: Lấy thông tin API và Service Role Key
Vào phần **Project Settings** -> **API**, copy các chuỗi sau:
- `Project URL` (VITE_SUPABASE_URL và SUPABASE_URL)
- `Project API Keys -> anon / public` (VITE_SUPABASE_ANON_KEY)
- `Project API Keys -> service_role` (SUPABASE_SERVICE_ROLE_KEY) - **Tuyệt đối bảo mật, không share cho học sinh**.

---

## 2. Deploy lên Netlify

### Bước 1: Liên kết Git Repository
1. Đưa toàn bộ mã nguồn này lên GitHub (Repository có thể là Private/Public).
2. Đăng nhập [Netlify](https://www.netlify.com).
3. Bấm **Add new site** -> **Import an existing project**.
4. Chọn GitHub và tìm đến Repository của bạn.

### Bước 2: Cấu hình Build settings
Trong mục Build settings khi chọn repository, điền các thông tin sau:
- **Base directory:** `(để trống)`
- **Build command:** `npm run build`
- **Publish directory:** `dist`

### Bước 3: Cấu hình Biến môi trường (Environment Variables)
Vào Site Settings -> Environment Variables, điền 4 biến này:

| Key | Value | Yêu cầu |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Bắt đầu bằng `https://...` | Cần cho Frontend |
| `VITE_SUPABASE_ANON_KEY` | Bắt đầu bằng `eyJhb...` | Cần cho Frontend |
| `SUPABASE_URL` | Bắt đầu bằng `https://...` | Cần cho Backend Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | (Khóa bí mật có chữ service_role)| Cần cho Backend (Chấm điểm) |
| `GEMINI_API_KEY` | Bắt đầu bằng `AIzaSy...` | Cần cho Backend (Tạo đề) |

> **Lưu ý:** `SUPABASE_SERVICE_ROLE_KEY` và `GEMINI_API_KEY` là khoá bí mật nên **KHÔNG** dùng tiền tố `VITE_`. Netlify Functions sẽ chạy ẩn và dùng Service Role Key để đọc đáp án chấm điểm tự động.

### Bước 4: Deploy
Bấm **Deploy site** và đợi Netlify pull code, chạy `npm run build`, và deploy functions.

---

## 3. Quá Trình Làm Việc Thực Tế

1. **Giáo viên truy cập Admin:** Mở `/admin` -> Sẽ bị chặn về `/admin/login`. Nhập Email/Password (Supabase Auth) từ Bước 2.
2. **Tạo Đề:** Giáo viên thao tác bình thường, hệ thống sẽ lưu file với danh tính của giáo viên đó (`owner_id`).
3. **Học sinh làm bài:** Học sinh mở `/exam/uuid`. Frontend truy vấn `/api/get-exam` từ Netlify Function. Đề thi trả về **đã bị backend lọc sạch toàn bộ đáp án** (an toàn 100% trước DevTools).
4. **Nộp bài:** Học sinh bấm Nộp, gửi Request POST kèm bài làm gửi lên Endpoint `/.netlify/functions/submit-exam`. Function này ẩn danh tính, dùng `service_role key` chọc vào Database lấy đáp án đúng, chấm điểm chuẩn, sau đó đẩy lên bảng `submissions`.
5. **Xem Kết Quả:** Giáo viên đang đăng nhập sẽ đọc được từ RLS, có thể xuất Excel.

---

## 4. Xử lý lỗi đăng nhập (Troubleshooting)

Nếu không đăng nhập được vào hệ thống Admin, hãy kiểm tra danh sách sau:

1. **Netlify phải có đủ biến môi trường:**
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
2. **Deploy lại sau khi thêm biến:** Sau khi thêm biến môi trường `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` vào Netlify, bạn **phải Redeploy lại**, vì Vite cần biến `VITE_*` để đóng gói code frontend lúc quá trình Build diễn ra.
3. **Tài khoản chưa được tạo:** Phải rạo tài khoản cho giáo viên trong: `Supabase Dashboard → Authentication → Users → Add User`. Không dùng Admin local như các bản cũ.
4. **Confirm Email:** Nếu Supabase đang bật xác nhận thư điện tử, hãy vào hộp thư để xác nhận link. Hoặc chọn cách nhanh hơn, tắt Confirm email tại: `Authentication → Providers → Email`.

---

## 5. Đặc tả quan trọng trong bản nâng cấp
- Toàn bộ thuật toán tra ngược ID / Index đáp án tại frontend ở bài thi thật đã bị xóa.
- Thay vì `submitExamToSupabase` ở frontend, tất cả gọi vào API Endpoint backend.
- `netlify.toml` chứa route fallback và functions redirect.

import { StudentResult } from '../types';

/**
 * FILE CẤU HÌNH KẾT NỐI GOOGLE SHEETS API & GOOGLE OAUTH
 * Bạn cần thay thế các thông tin bên dưới bằng thông tin thật từ Google Cloud Console.
 */

// 1. THAY THẾ "YOUR_CLIENT_ID" BẰNG CLIENT ID CỦA BẠN ĐỂ ĐĂNG NHẬP GOOGLE
export const GOOGLE_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";

// Legacy Google Sheet submission.
// Current flow stores submissions in Supabase and exports Excel from admin.
// Do not call this during student submission.
export const GOOGLE_APPS_SCRIPT_URL = "";

/**
 * Legacy Google Sheet submission. Current flow stores submissions in Supabase and exports Excel from admin.
 * Hàm gửi kết quả của học sinh lên Google Sheets.
 * Gửi dữ liệu qua phương thức POST tới Google Apps Script URL.
 */
export const submitResultToGoogleSheets = async (result: StudentResult) => {
  try {
    // Nếu chưa cấu hình URL, ta log ra console để test giao diện trước
    if (String(GOOGLE_APPS_SCRIPT_URL) === "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL") {
      console.log("GIẢ LẬP GỬI DỮ LIỆU LÊN GOOGLE SHEETS:", result);
      console.log("-> Vui lòng cấu hình GOOGLE_APPS_SCRIPT_URL trong src/lib/api.ts để gửi thật.");
      return { success: true, message: "Đã lưu (Giả lập)" };
    }

    const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors', // Sử dụng no-cors để tránh lỗi CORS khi gọi form từ client
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(result),
    });
    
    // Lưu ý: với mode no-cors, response sẽ là opaque, không đọc được json trả về.
    return { success: true, message: "Đã gửi dữ liệu thành công" };
    
  } catch (error) {
    console.error("Lỗi khi gửi kết quả lên Google Sheets:", error);
    return { success: false, error };
  }
};

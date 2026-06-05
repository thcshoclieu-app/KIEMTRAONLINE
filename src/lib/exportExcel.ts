import * as xlsx from 'xlsx';

export const exportSubmissionsToExcel = (submissions: any[]) => {
  const data = submissions.map((sub, index) => {
    return {
      'STT': index + 1,
      'Thời gian nộp': sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('vi-VN') : '',
      'Họ tên': sub.student_name,
      'Lớp': sub.class_name,
      'Tên đề': sub.exams?.title || 'Không rõ',
      'Môn': sub.exams?.subject || '',
      'Khối': sub.exams?.grade || '',
      'Loại đề': sub.exam_type || 'full-exam',
      'Điểm trắc nghiệm': sub.multiple_choice_score || 0,
      'Điểm đúng/sai': sub.true_false_score || 0,
      'Điểm tự luận': sub.essay_score || 0,
      'Tổng điểm': sub.total_score || 0,
      'Trả lời TN': sub.multiple_choice_answers ? JSON.stringify(sub.multiple_choice_answers) : '',
      'Trả lời Đ/S': sub.true_false_answers ? JSON.stringify(sub.true_false_answers) : '',
      'Bài tự luận': sub.essay_answer || ''
    };
  });

  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Kết quả bài làm');

  // Adjust column widths
  const wscols = [
    {wch: 5},
    {wch: 20},
    {wch: 25},
    {wch: 10},
    {wch: 30},
    {wch: 15},
    {wch: 10},
    {wch: 15},
    {wch: 15},
    {wch: 15},
    {wch: 15},
    {wch: 10},
    {wch: 30},
    {wch: 30},
    {wch: 50}
  ];
  worksheet['!cols'] = wscols;

  xlsx.writeFile(workbook, 'ket-qua-bai-lam.xlsx');
};

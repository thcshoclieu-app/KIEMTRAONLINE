import { ExamConfig } from '../types';
import LZString from 'lz-string';

export function encodeExamConfig(config: ExamConfig): string {
  try {
    const jsonString = JSON.stringify(config);
    // Use LZString to drastically compress the URI, to dodge 414 URL too large error in Nginx 
    return LZString.compressToEncodedURIComponent(jsonString);
  } catch (error) {
    console.error("Lỗi mã hóa cấu hình bài thi", error);
    return "";
  }
}

export function decodeExamConfig(encodedStr: string): ExamConfig | null {
  try {
    // Try to decompress using LZString
    let jsonString = LZString.decompressFromEncodedURIComponent(encodedStr);
    
    // If it fails to decompress, try the old base-64 decode logic for backward compatibility
    if (!jsonString) {
      jsonString = decodeURIComponent(atob(decodeURIComponent(encodedStr)));
    }
    
    return JSON.parse(jsonString) as ExamConfig;
  } catch (error) {
    console.error("Lỗi giải mã cấu hình bài thi", error);
    return null;
  }
}

// Fisher-Yates Shuffle array
export function shuffleArray<T>(array: T[]): T[] {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

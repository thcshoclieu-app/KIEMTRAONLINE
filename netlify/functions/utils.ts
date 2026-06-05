import { GoogleGenAI, Type } from "@google/genai";

export const PRIORITY_MODELS = [
  "gemini-3.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash"
];

export function normalizeModelName(modelName?: string) {
  if (!modelName) return "";
  return modelName.replace("models/", "").trim();
}

export function buildCandidateModels(selectedModel?: string, availableModels?: any[] | string[]) {
  const candidates = new Set<string>();
  const normalizedSelected = normalizeModelName(selectedModel);
  if (normalizedSelected) {
    candidates.add(normalizedSelected);
  }
  
  if (availableModels && availableModels.length > 0) {
    const availStr = availableModels.map((m: any) => typeof m === 'string' ? normalizeModelName(m) : normalizeModelName(m.name));
    PRIORITY_MODELS.forEach(pm => {
      if (availStr.includes(pm)) {
        candidates.add(pm);
      }
    });
  } else {
    PRIORITY_MODELS.forEach(pm => candidates.add(pm));
  }
  
  return Array.from(candidates);
}

export function isRetryableGeminiError(error: any) {
  const status = error?.status;
  const msg = (error?.message || "").toLowerCase();
  
  if (status === 401 || msg.includes("api key not valid")) {
    return false;
  }
  
  if ([403, 404, 429, 500, 502, 503, 504].includes(status)) return true;
  
  const retryableKeywords = ["quota", "rate limit", "overloaded", "unavailable", "not found", "permission", "model", "exhausted", "resource exhausted", "503", "429"];
  for (const keyword of retryableKeywords) {
    if (msg.includes(keyword)) return true;
  }
  
  return false;
}

export async function generateContentWithFallback(ai: any, candidateModels: string[], buildPayload: (model: string) => any) {
  let lastError = null;

  console.log(`Candidate Gemini models: ${JSON.stringify(candidateModels)}`);

  for (const model of candidateModels) {
    try {
      console.log("Trying Gemini model:", model);
      const payload = buildPayload(model);
      const response = await ai.models.generateContent(payload);
      console.log("Using Gemini model:", model);
      return { response, usedModel: model };
    } catch (error: any) {
      lastError = error;
      console.error("Gemini model failed:", model, error?.message || error);

      if (!isRetryableGeminiError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Không có Gemini model nào gọi được.");
}

export const maskApiKey = (key: string) => {
  if (!key || key.length < 10) return "****";
  return key.substring(0, 6) + "****" + key.substring(key.length - 4);
};

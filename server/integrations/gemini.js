// Google Gemini (generateContent REST API). Used only to (1) extract a structured request from
// the user's message and (2) phrase answers from facts the server computed.
import { config } from '../config.js';
import { request } from '../lib/http.js';

export const geminiEnabled = () => Boolean(config.keys.gemini);

let workingModel = null;

async function callModel(model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return request('gemini', url, {
    method: 'POST', timeout: 30000, retries: 1,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.keys.gemini },
    body: JSON.stringify(body),
  });
}

/**
 * @param {{system: string, messages: {role:'user'|'model', text:string}[], schema?: object, temperature?: number}} opts
 * @returns {Promise<string|object>} text, or parsed JSON when a schema is given
 */
export async function generate({ system, messages, schema, temperature = 0.3 }) {
  if (!geminiEnabled()) throw new Error('GEMINI_API_KEY is not set');
  const generationConfig = { temperature, maxOutputTokens: schema ? 1024 : 900 };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = schema; }
  const candidates = [...new Set([workingModel, config.geminiModel, 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean))];
  let lastErr;
  for (const model of candidates) {
    const gc = { ...generationConfig };
    if (/2\.5-flash/.test(model)) gc.thinkingConfig = { thinkingBudget: 0 };
    try {
      const data = await callModel(model, {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: gc,
      });
      workingModel = model;
      const out = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!out) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'empty'})`);
      return schema ? JSON.parse(out) : out;
    } catch (err) {
      lastErr = err;
      // Unknown/retired model name: try the next candidate. Anything else: stop.
      if (!(err.status === 404 || (err.status === 400 && /model/i.test(err.message)))) break;
    }
  }
  throw lastErr;
}

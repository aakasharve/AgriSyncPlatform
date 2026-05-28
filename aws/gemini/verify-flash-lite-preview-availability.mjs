#!/usr/bin/env node
// verify-flash-lite-preview-availability.mjs
//
// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Phase 0.3b pre-deploy gate.
// Confirms the Gemini structurer model configured in appsettings is
// callable from our production API key (or any provided key).
//
// Usage:
//   GEMINI_API_KEY=... node aws/gemini/verify-flash-lite-preview-availability.mjs
//
// Optional env:
//   GEMINI_MODEL_ID   override the model id to test (default matches the
//                     value in src/AgriSync.Bootstrapper/appsettings.Production.json
//                     `Gemini.StructurerModelId` as of 2026-05-28 = "gemini-3.1-flash-lite-preview")
//   GEMINI_BASE_URL   override the API base URL (default matches
//                     appsettings.Production.json `Gemini.BaseUrl`)
//
// Output:
//   PASS / FAIL line + response status + a one-token preview of the
//   generated text. NEVER prints the API key (length + sha256-prefix
//   only, per _COFOUNDER/memory/feedback_redacted_secret_inspection).
//
// Exit codes:
//   0  model callable + returns text + reports token usage
//   2  setup error: GEMINI_API_KEY env var missing
//   3  HTTP error (404 = model unavailable on this key, 401 = key invalid,
//      403 = quota, etc.)
//   4  HTTP 200 but response shape unexpected (no candidates / no text)
//
// This file ships INERT — no secret is committed to git. Founder runs it
// separately when ready to clear gate B-Gemini-Model-Availability.

import { createHash } from 'node:crypto';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('FAIL: GEMINI_API_KEY env var required');
  console.error('Hint: GEMINI_API_KEY=$(aws secretsmanager get-secret-value --secret-id agrisync/prod/gemini-api-key --query SecretString --output text --region ap-south-1) node aws/gemini/verify-flash-lite-preview-availability.mjs');
  process.exit(2);
}

const MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-3.1-flash-lite-preview';
const BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

const keyLen = API_KEY.length;
const keyFp = createHash('sha256').update(API_KEY).digest('hex').slice(0, 12);
console.log(`Using GEMINI_API_KEY len=${keyLen} fp_sha256_12=${keyFp}`);
console.log(`Using MODEL_ID=${MODEL_ID}`);
console.log(`Using BASE_URL=${BASE_URL}`);

const url = `${BASE_URL}/models/${encodeURIComponent(MODEL_ID)}:generateContent?key=${encodeURIComponent(API_KEY)}`;

const body = {
  contents: [{
    role: 'user',
    parts: [{ text: 'Respond with exactly the word OK and nothing else.' }],
  }],
  generationConfig: {
    temperature: 0.0,
    maxOutputTokens: 8,
  },
};

let response;
try {
  response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
} catch (err) {
  console.error(`FAIL: network error: ${err.message}`);
  process.exit(3);
}

console.log(`HTTP ${response.status}`);

if (!response.ok) {
  const text = await response.text();
  console.error('FAIL: non-200 response from Gemini');
  console.error(text.slice(0, 800));
  if (response.status === 404) {
    console.error(
      `Action: model '${MODEL_ID}' is unavailable for this key. ` +
      'Check the model id at https://ai.google.dev/gemini-api/docs/models, ' +
      'or fall back to gemini-2.5-flash-lite per SARVAM plan §0.3b Step 3 option (b).'
    );
  } else if (response.status === 401 || response.status === 403) {
    console.error(
      'Action: key invalid or quota/permission denied. ' +
      'Verify the secret stored under agrisync/prod/gemini-api-key in AWS Secrets Manager.'
    );
  }
  process.exit(3);
}

const data = await response.json();
const candidate = data?.candidates?.[0];
const generatedText = candidate?.content?.parts?.[0]?.text;
const tokenUsage = data?.usageMetadata;

if (!generatedText) {
  console.error('FAIL: response shape unexpected (no candidates[0].content.parts[0].text)');
  console.error(JSON.stringify(data, null, 2).slice(0, 1200));
  process.exit(4);
}

console.log(`PASS: model '${MODEL_ID}' is callable from this key`);
console.log(`generated_text_preview="${generatedText.slice(0, 60).replace(/\n/g, ' ')}"`);
if (tokenUsage) {
  console.log(`token_usage promptTokens=${tokenUsage.promptTokenCount ?? '?'} candidateTokens=${tokenUsage.candidatesTokenCount ?? '?'} totalTokens=${tokenUsage.totalTokenCount ?? '?'}`);
}
console.log(`finish_reason=${candidate.finishReason ?? '?'}`);

process.exit(0);

const fs = require('fs');

async function testProvider() {
  const GEMINI_API_KEY = 'AIzaSyCZTLGVnL7eZWQaucbShQnjnGVZBFtCUuE';
  const GEMINI_MODEL = 'gemini-3.1-pro-preview';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  const dataPrompt = `You are an AI assistant. Return a JSON object with a single key "test" and value true.`;

  try {
    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: dataPrompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingLevel: 'medium' },
          },
        }),
      });
      
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}
testProvider();

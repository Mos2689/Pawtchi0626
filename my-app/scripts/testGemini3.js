const fs = require('fs');

const env = fs.readFileSync('c:/Users/pradi/Downloads/Pawtchi/my-app/.env', 'utf8');
const keyMatch = env.match(/EXPO_PUBLIC_GEMINI_API_KEY=(.*)/);
const apiKey = keyMatch ? keyMatch[1].trim() : null;

if (!apiKey) {
  console.log('No API key found in .env');
  process.exit(1);
}

// Minimal 1x1 base64 transparent png and a dummy dog base64 just for testing payload acceptance
const dummyWearableBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="; 
const dummyDogBase64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const prompt = "Image 1 is a dog. Image 2 is a wearable item. Keep the exact identity of Image 1 and perfectly composite Image 2 onto it. Photorealistic blending.";

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + apiKey;

fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: dummyDogBase64 } },
          { inlineData: { mimeType: "image/png", data: dummyWearableBase64 } }
        ]
      }
    ]
  })
})
.then(res => res.json())
.then(data => {
    if (data.error) {
       console.log("API ERROR:", JSON.stringify(data.error));
    } else if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
       console.log("SUCCESS! Payload accepted inlineData!");
    } else {
       console.log("UNKNOWN RESPONSE:", JSON.stringify(data));
    }
})
.catch(err => console.error('Fetch Error:', err));

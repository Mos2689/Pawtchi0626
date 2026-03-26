const fs = require('fs');

const env = fs.readFileSync('c:/Users/pradi/Downloads/Pawtchi/my-app/.env', 'utf8');
const keyMatch = env.match(/EXPO_PUBLIC_GEMINI_API_KEY=(.*)/);
const apiKey = keyMatch ? keyMatch[1].trim() : null;

if (!apiKey) {
  console.log('No API key found in .env');
  process.exit(1);
}

const prompt = "Composite photorealistic image integrating a dog and [Retro Propeller Hat (worn perfectly on its head)]. The exact subject must be depicted naturally wearing the specified items at their correct anatomical locations. Strictly preserve the original identity, facial features, fur texture, and coloring of the dog. Seamlessly integrate the elements by generating coherent, natural lighting across the subject. Add realistic contact shadows cast by the wearables onto the dog's fur to ground the objects. High-resolution, seamless blending, photorealistic composite.";

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + apiKey;

fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt }
        ]
      }
    ]
  })
})
.then(res => res.json())
.then(data => {
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        const parts = data.candidates[0].content.parts;
        const imagePart = parts.find(p => p.inlineData);
        if (imagePart) {
           console.log('SUCCESS! Received Base64 string of length:', imagePart.inlineData.data.length);
        } else {
           console.log('NO IMAGE DATA. Parts:', JSON.stringify(parts));
        }
    } else {
        console.log('API FAILURE. Raw response:');
        console.log(JSON.stringify(data, null, 2));
    }
})
.catch(err => console.error('Fetch Error:', err));

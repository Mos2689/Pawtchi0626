const fs = require('fs');

const env = fs.readFileSync('c:/Users/pradi/Downloads/Pawtchi/my-app/.env', 'utf8');
const keyMatch = env.match(/EXPO_PUBLIC_GEMINI_API_KEY=(.*)/);
const apiKey = keyMatch ? keyMatch[1].trim() : null;

if (!apiKey) {
  console.log('No API key found in .env');
  process.exit(1);
}

const prompt = "Composite photorealistic image integrating a dog and [Retro Propeller Hat (worn perfectly on its head)]. The exact subject must be depicted naturally wearing the specified items at their correct anatomical locations. Strictly preserve the original identity, facial features, fur texture, and coloring of the dog. Seamlessly integrate the elements by generating coherent, natural lighting across the subject. Add realistic contact shadows cast by the wearables onto the dog's fur to ground the objects. High-resolution, seamless blending, photorealistic composite.";

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=' + apiKey;

fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    instances: [ { prompt: prompt } ],
    parameters: { sampleCount: 1, personGeneration: 'ALLOW_ADULT' }
  })
})
.then(res => res.json())
.then(data => {
    if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
        console.log('SUCCESS! Received Base64 string of length:', data.predictions[0].bytesBase64Encoded.length);
        // Save the image just to prove it works
        fs.writeFileSync('/tmp/test-gemini-output.jpg', data.predictions[0].bytesBase64Encoded, 'base64');
        console.log('Saved image to /tmp/test-gemini-output.jpg');
    } else {
        console.log('API FAILURE. Raw response:');
        console.log(JSON.stringify(data, null, 2));
    }
})
.catch(err => console.error('Fetch Error:', err));

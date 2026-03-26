require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing DB credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const uploads = [
  { path: 'C:/Users/pradi/.gemini/antigravity/brain/63c0355b-e88d-4905-bc1e-24398c10e3b4/neon_bandana_asset_1774451986654.png', name: 'neon_bandana_asset.png' },
  { path: 'C:/Users/pradi/.gemini/antigravity/brain/63c0355b-e88d-4905-bc1e-24398c10e3b4/propeller_hat_asset_1774452037973.png', name: 'propeller_hat_asset.png' },
  { path: 'C:/Users/pradi/.gemini/antigravity/brain/63c0355b-e88d-4905-bc1e-24398c10e3b4/rad_shades_asset_1774452067385.png', name: 'rad_shades_asset.png' },
  { path: 'C:/Users/pradi/.gemini/antigravity/brain/63c0355b-e88d-4905-bc1e-24398c10e3b4/cozy_sweater_asset_1774452097821.png', name: 'cozy_sweater_asset.png' }
];

async function uploadFiles() {
  for (const file of uploads) {
    try {
      const fileBuffer = fs.readFileSync(file.path);
      const { data, error } = await supabase
        .storage
        .from('wearables')
        .upload(file.name, fileBuffer, {
          contentType: 'image/png',
          upsert: true
        });

      if (error) {
        console.error("Error uploading " + file.name + ":", error);
      } else {
        const { data: publicUrl } = supabase.storage.from('wearables').getPublicUrl(file.name);
        console.log("SUCCESS:", file.name, "->", publicUrl.publicUrl);
      }
    } catch(e) {
      console.error("Failed to read " + file.path, e);
    }
  }
}

uploadFiles();

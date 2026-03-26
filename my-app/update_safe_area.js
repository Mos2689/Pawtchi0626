const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, 'app');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(file));
        } else {
            if (file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk(appDir);

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // Remove SafeAreaView from react-native imports
    if (content.includes("SafeAreaView") && content.includes("'react-native'")) {
        // Regex to remove SafeAreaView, (or , SafeAreaView) from the react-native import
        content = content.replace(/,\s*SafeAreaView/, '');
        content = content.replace(/SafeAreaView,\s*/, '');
        
        // Add new import if it doesn't exist
        if (!content.includes("'react-native-safe-area-context'")) {
            content = "import { SafeAreaView } from 'react-native-safe-area-context';\n" + content;
        }
        changed = true;
    }

    // Increase paddingBottom for scrollContent/scrollContent etc by a bit more if it exists
    if (content.match(/paddingBottom:\s*([0-9]+)/)) {
        content = content.replace(/paddingBottom:\s*([0-9]+)/g, (match, p1) => {
            let pb = parseInt(p1);
            if (pb >= 40 && pb < 140) {
                // bump padding bottom up heavily for lists
                return `paddingBottom: 140`;
            }
            return match;
        });
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});

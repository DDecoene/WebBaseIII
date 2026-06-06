const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', '@sqlite.org', 'sqlite-wasm', 'sqlite-wasm', 'jswasm', 'sqlite3.wasm');
const destDir = path.join(__dirname, '..', 'public');
const dest = path.join(destDir, 'sqlite3.wasm');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log('Copied sqlite3.wasm to public/');
} else {
  console.warn('sqlite3.wasm not found at', src, '— skipping copy');
}

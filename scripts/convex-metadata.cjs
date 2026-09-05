// Parse one snapshot before any writes. Exit 2 means missing fields, not invalid data.
const fs = require('node:fs');
const keys = ['CONVEX_DEPLOYMENT', 'CONVEX_URL', 'CONVEX_SITE_URL'];
function invalid() { throw new Error('Invalid Convex metadata; expected unique local deployment and loopback URLs only.'); }
try {
  let values = {};
  if (process.argv[2] === '--env') {
    for (const key of keys) if (process.env[key]) values[key] = process.env[key];
  } else {
    const file = process.argv[2];
    let stat;
    try { stat = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') process.exit(2); throw e; }
    if (!stat.isFile() || stat.isSymbolicLink()) invalid();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line === '' || line === '# Deployment used by `npx convex dev`') continue;
      const match = /^(CONVEX_DEPLOYMENT|(?:VITE_)?CONVEX_(?:URL|SITE_URL))=(.*)$/.exec(line);
      if (!match) invalid();
      const key = match[1].replace(/^VITE_/, '');
      if (Object.hasOwn(values, key)) invalid();
      values[key] = match[2].replace(/\s#.*$/, '');
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (key === 'CONVEX_DEPLOYMENT') {
      if (!/^(?:local|anonymous):[A-Za-z0-9._-]+$/.test(value)) invalid();
    } else {
      const url = new URL(value);
      if (url.protocol !== 'http:' || url.username || url.password || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.pathname !== '/' || url.search || url.hash) invalid();
    }
  }
  if (keys.some(key => !Object.hasOwn(values, key))) process.exit(2);
  if (process.argv[3] !== '--check') process.stdout.write(keys.map(key => `${key}=${values[key]}`).join('\n'));
} catch {
  console.error('Invalid Convex metadata; expected unique local deployment and loopback URLs only.');
  process.exit(1);
}

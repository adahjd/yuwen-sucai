const { spawn } = require('child_process');
const path = require('path');

// Start Express server
const server = spawn('node', [path.join(__dirname, 'server.js')], {
  stdio: 'inherit'
});

server.on('error', (err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

// Wait for server to start, then start tunnel
setTimeout(() => {
  const lt = spawn('npx', ['lt', '--port', '3000', '--subdomain', 'yuwen-sucai'], {
    stdio: 'inherit',
    shell: true
  });

  lt.on('exit', (code) => {
    console.log('Tunnel closed. Server still running.');
  });
}, 2000);

console.log('Starting 语文素材库 with public tunnel...');

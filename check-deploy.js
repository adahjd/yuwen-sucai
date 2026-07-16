const https = require('https');
https.get('https://yuwen-sucai.onrender.com', (res) => {
  console.log('Status:', res.statusCode);
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    if (d.length < 500) console.log('Body:', d);
    else console.log('Body length:', d.length, '- first 200 chars:', d.slice(0, 200));
  });
}).on('error', (e) => {
  console.log('Error:', e.message);
  console.log('Not deployed yet. Go to https://dashboard.render.com to check status.');
});

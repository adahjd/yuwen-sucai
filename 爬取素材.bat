@echo off
cd /d "C:\Users\Administrator\Documents\Codex\2026-07-16\summary-web-json-node-js-express"
set DATABASE_URL=postgresql://neondb_owner:npg_lL0BdPKSI6Hc@ep-royal-feather-aubs3qr7-pooler.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
set USE_AI=false
echo === 语文素材爬虫 ===
node scripts/crawl.js
echo.
echo === 完成！去 https://yuwensucai.netlify.app/ 查看待审核素材 ===
pause

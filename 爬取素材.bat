@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 语文素材爬虫 ===
echo 读取 .env 中的 DATABASE_URL（如未配置请先复制 .env.example 为 .env）
node scripts\crawl.js
echo.
echo === 完成！去 https://yuwensucai.netlify.app/ 查看待审核素材 ===
pause

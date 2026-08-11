@echo off
chcp 65001 >nul
title 英语教学平台 — 一键启动

echo.
echo ╔══════════════════════════════════════╗
echo ║  🎓 英语教学平台 — 一键启动          ║
echo ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ── 1. Docker ──────────────────────────────────
echo [1/5] 启动 Docker 服务...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠ Docker 未运行，请先启动 Docker Desktop
    echo 跳过数据库启动，后端将连接失败
) else (
    docker-compose up -d
    echo ✓ PostgreSQL ^& Redis 已启动
)

:: ── 2. Backend deps ─────────────────────────────
echo.
echo [2/5] 检查后端依赖...
cd backend
if not exist "node_modules" (
    echo 正在安装后端依赖...
    npm install
)
echo ✓ 后端依赖就绪

:: ── 3. Seed ────────────────────────────────────
echo.
echo [3/5] 初始化数据库...
call npm run seed 2>nul
echo ✓ 数据库已初始化 ^(admin@platform.com / admin123456^)

:: ── 4. Start backend ───────────────────────────
echo.
echo [4/5] 启动后端 ^(端口 3001^)...
start "英语平台-后端" cmd /c "cd /d %cd% && npm run start:dev"

:: ── 5. Frontend ────────────────────────────────
cd ..\frontend
if not exist "node_modules" (
    echo 正在安装前端依赖...
    npm install
)

echo.
echo [5/5] 启动前端 ^(端口 3000^)...
echo.
echo ╔══════════════════════════════════════╗
echo ║  ✅ 启动完成！                       ║
echo ║                                      ║
echo ║  前端: http://localhost:3000         ║
echo ║  后端: http://localhost:3001/api     ║
echo ║                                      ║
echo ║  管理员: admin@platform.com          ║
echo ║  密码:   admin123456                 ║
echo ╚══════════════════════════════════════╝
echo.

start "英语平台-前端" cmd /c "cd /d %cd% && npm run dev"

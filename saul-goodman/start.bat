@echo off
cd /d "%~dp0backend"
echo Starting Saul Goodman site at http://127.0.0.1:8000 ...
echo (press Ctrl+C to stop)
uvicorn main:app --host 127.0.0.1 --port 8000

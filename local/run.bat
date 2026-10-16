@echo off
cd /d "%~dp0"
echo.
echo   VANTAGE EDGE
echo   Starting at http://localhost:5555
echo.
python -m pip install flask -q 2>nul
python app.py
pause

Set-Location $PSScriptRoot
Write-Host ""
Write-Host "  VANTAGE EDGE" -ForegroundColor Yellow
Write-Host "  http://localhost:5555" -ForegroundColor Cyan
Write-Host ""
python -m pip install flask -q 2>$null
python "$PSScriptRoot\app.py"

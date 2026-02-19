#!/usr/bin/env bash
set -e

echo ""
echo "=============================="
echo "  VideoForge — Setup"
echo "=============================="
echo ""

# --- Check Python ---
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "[ERROR] Python not found."
    echo "  Windows : https://www.python.org/downloads/"
    echo "  Mac     : brew install python3"
    echo "  Ubuntu  : sudo apt install python3 python3-pip python3-venv"
    exit 1
fi
echo "[OK] $($PYTHON --version)"

# --- Check FFmpeg ---
if ! command -v ffmpeg &>/dev/null; then
    echo "[ERROR] FFmpeg not found."
    echo "  Windows : https://www.gyan.dev/ffmpeg/builds/"
    echo "  Mac     : brew install ffmpeg"
    echo "  Ubuntu  : sudo apt install ffmpeg"
    exit 1
fi
echo "[OK] $(ffmpeg -version 2>&1 | head -1)"

# --- Install dependencies ---
echo ""
echo "[...] Installing Python packages (this may take a few minutes)..."
$PYTHON -m pip install -r requirements.txt --quiet
echo "[OK] All packages installed."

mkdir -p uploads exports

echo ""
echo "=============================="
echo "  Ready!"
echo "=============================="
echo ""
echo "  Start:  $PYTHON app.py"
echo "  Open:   http://localhost:5000"
echo ""
echo "  First run downloads AI models (~200 MB)."
echo "  This is automatic and only happens once."
echo ""

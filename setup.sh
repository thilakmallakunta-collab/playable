#!/usr/bin/env bash
set -e

echo ""
echo "=============================="
echo "  VideoForge — Setup Script"
echo "=============================="
echo ""

# --- Check Python ---
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "[ERROR] Python is not installed."
    echo ""
    echo "Install it first:"
    echo "  Windows  : https://www.python.org/downloads/"
    echo "  Mac      : brew install python3"
    echo "  Ubuntu   : sudo apt install python3 python3-pip"
    echo ""
    exit 1
fi

echo "[OK] Found Python: $($PYTHON --version)"

# --- Check FFmpeg ---
if ! command -v ffmpeg &>/dev/null; then
    echo "[ERROR] FFmpeg is not installed."
    echo ""
    echo "Install it first:"
    echo "  Windows  : https://ffmpeg.org/download.html  (or: choco install ffmpeg)"
    echo "  Mac      : brew install ffmpeg"
    echo "  Ubuntu   : sudo apt install ffmpeg"
    echo ""
    exit 1
fi

echo "[OK] Found FFmpeg: $(ffmpeg -version 2>&1 | head -1)"

# --- Create virtual environment (optional but recommended) ---
if [ ! -d "venv" ]; then
    echo ""
    echo "[...] Creating virtual environment..."
    $PYTHON -m venv venv
    echo "[OK] Virtual environment created in ./venv"
fi

# --- Activate venv ---
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
elif [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
fi

# --- Install dependencies ---
echo ""
echo "[...] Installing Python packages..."
pip install -r requirements.txt --quiet
echo "[OK] All packages installed."

# --- Create folders ---
mkdir -p uploads exports

echo ""
echo "=============================="
echo "  Setup complete!"
echo "=============================="
echo ""
echo "To start the app, run:"
echo ""
echo "  $PYTHON app.py"
echo ""
echo "Then open http://localhost:5000 in your browser."
echo ""

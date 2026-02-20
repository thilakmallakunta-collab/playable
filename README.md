# VideoForge — AI-Powered Video Editor

A web-based tool that uses AI to **detect and edit** elements in your competition video:

- **Background Detection** — AI segments the foreground, lets you replace the background with any color or image
- **Text Detection (OCR)** — Finds all text in the video, lets you edit the content, font size, and colors
- **Image/Object Detection** — Identifies logos, graphics, and image regions, lets you replace them
- **Color Adjustments** — Brightness, contrast, saturation, hue, RGB gamma

---

## Prerequisites

### Python 3.10+ (3.12 recommended)

| Platform | Install |
|----------|---------|
| **Windows** | [python.org/downloads](https://www.python.org/downloads/) — **check "Add Python to PATH"** |
| **Mac** | `brew install python3` |
| **Ubuntu** | `sudo apt update && sudo apt install python3 python3-pip python3-venv` |

### FFmpeg

| Platform | Install |
|----------|---------|
| **Windows** | [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) — download "essentials", extract, add `bin` folder to PATH |
| **Mac** | `brew install ffmpeg` |
| **Ubuntu** | `sudo apt update && sudo apt install ffmpeg` |

---

## Quick Start

### Option 1 — With Git

```bash
git clone https://github.com/thilakmallakunta-collab/playable.git
cd playable
pip install -r requirements.txt
python app.py
```

### Option 2 — Download ZIP (no Git needed)

1. Download: https://github.com/thilakmallakunta-collab/playable/archive/refs/heads/cursor/missing-task-details-ff14.zip
2. Extract the ZIP
3. Open a terminal in the extracted folder
4. Run:

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000** in your browser.

> First run downloads AI models (~200 MB). This is automatic and only happens once.

---

## How to Use

### 1. Upload your video
Drag & drop or click to browse. Supports MP4, MOV, AVI, MKV, WebM (up to 500 MB).

### 2. Seek to the frame you want to analyze
Use the video player and timeline to navigate to a frame that shows the elements you want to change.

### 3. Click "Analyze Frame"
The AI will detect:
- **Background** — segments foreground from background
- **Text** — finds all text with OCR, shows bounding boxes
- **Images** — finds logos, graphics, and image regions

### 4. Edit detected elements

**Background tab:**
- Check "Enable Background Replacement"
- Pick a solid color, or upload a replacement background image

**Text tab:**
- Each detected text shows the original content and position
- Check the box next to a text to enable editing
- Type your new text, set font size and colors
- "Cover Color" fills over the original text before drawing the new one

**Images tab:**
- Each detected image region shows a thumbnail and position
- Check the box to enable replacement
- Upload a replacement image

**Colors tab:**
- Adjust brightness, contrast, saturation, hue rotation
- Fine-tune RGB gamma channels
- Changes preview instantly on the video

### 5. Export
Click **"Export Video"** to render the final video with all changes.
- Text and image edits use fast FFmpeg processing
- Background replacement processes frame-by-frame (slower, but accurate)
- Download the result when it finishes

---

## Project Structure

```
├── app.py                  # Flask backend + export logic
├── analyzer.py             # AI detection: background, OCR, objects
├── requirements.txt        # Python dependencies
├── setup.sh                # One-command setup (Mac/Linux)
├── templates/
│   └── index.html          # Editor UI
├── static/
│   ├── css/style.css       # Styles
│   └── js/app.js           # Frontend logic
├── uploads/                # Uploaded files (gitignored)
└── exports/                # Rendered videos (gitignored)
```

## Dependencies

| Package | Purpose |
|---------|---------|
| Flask | Web server |
| OpenCV | Frame extraction, image detection |
| EasyOCR | Text detection in video frames |
| rembg + onnxruntime | Background segmentation (U2Net model) |
| Pillow | Image processing |
| NumPy | Array operations |

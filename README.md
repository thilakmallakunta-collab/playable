# VideoForge — Video Color, Text & Image Editor

A web-based tool that lets you customize your competition video by adjusting colors, adding text overlays, and placing images — all from your browser.

---

## Prerequisites (install these first)

You need **two things** installed on your computer before starting:

### 1. Python (version 3.10 or newer)

| Platform | How to install |
|----------|---------------|
| **Windows** | Download from [python.org/downloads](https://www.python.org/downloads/). During install, **check "Add Python to PATH"**. |
| **Mac** | `brew install python3` (if you have Homebrew), or download from [python.org](https://www.python.org/downloads/) |
| **Ubuntu/Debian** | `sudo apt update && sudo apt install python3 python3-pip python3-venv` |

Verify it works by opening a terminal and running:
```
python3 --version
```

### 2. FFmpeg

| Platform | How to install |
|----------|---------------|
| **Windows** | `choco install ffmpeg` (if you have Chocolatey), or download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH |
| **Mac** | `brew install ffmpeg` |
| **Ubuntu/Debian** | `sudo apt update && sudo apt install ffmpeg` |

Verify it works:
```
ffmpeg -version
```

---

## Quick Start (3 steps)

### Step 1 — Get the code

```bash
git clone https://github.com/thilakmallakunta-collab/playable.git
cd playable
```

### Step 2 — Run setup

**Mac / Linux:**
```bash
bash setup.sh
```

**Windows (or manual setup on any OS):**
```bash
pip install -r requirements.txt
```

### Step 3 — Start the app

```bash
python3 app.py
```

You will see output like:
```
 * Running on http://0.0.0.0:5000
```

Open your browser and go to **http://localhost:5000**

---

## How to Use the Editor

### Upload your video
- Drag and drop your video onto the upload area, or click to browse
- Supports MP4, MOV, AVI, MKV, WebM (up to 500 MB)

### Colors tab (left panel)
- **Brightness** — make the video lighter or darker
- **Contrast** — increase or decrease the difference between light and dark
- **Saturation** — make colors more vivid or muted
- **Hue Rotate** — shift all colors around the color wheel
- **RGB Gamma** — fine-tune individual red, green, blue channels
- Changes preview instantly on the video player

### Text tab
- Click **"Add Text Overlay"** to create a new text layer
- Set the text content, font size, color, and position (X, Y in pixels)
- Set **Start** and **End** times (in seconds) to control when the text appears
- Set End to **-1** to show the text for the entire video
- Add shadow and outline for readability

### Images tab
- Click **"Add Image Overlay"** to upload a PNG/JPG image
- Set position (X, Y), size (Width, Height), and opacity
- Set start/end times just like text overlays

### Export
- Click the **"Export Video"** button in the top-right
- Wait for FFmpeg to render your video with all changes baked in
- Click **"Download Video"** when it finishes

---

## Hosting on the Internet (optional)

If you want others to access your editor over the web:

### Option A — ngrok (quickest, temporary)
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 5000
```
This gives you a public URL like `https://abc123.ngrok.io` that anyone can visit.

### Option B — Deploy to a cloud server
1. Get a server (DigitalOcean, AWS, etc.)
2. SSH in and clone the repo
3. Run setup and start with:
```bash
bash setup.sh
source venv/bin/activate
python3 app.py
```
4. Open port 5000 in your firewall

### Option C — Deploy with Docker
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
```
```bash
docker build -t videoforge .
docker run -p 5000:5000 videoforge
```

---

## Project Structure

```
├── app.py                  # Flask backend + FFmpeg rendering
├── setup.sh                # One-command setup script
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Editor UI
├── static/
│   ├── css/style.css       # Dark theme styles
│   └── js/app.js           # Frontend logic
├── uploads/                # Uploaded files (auto-created, gitignored)
└── exports/                # Rendered videos (auto-created, gitignored)
```

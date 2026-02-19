# VideoForge — Video Color, Text & Image Editor

A web-based video editing tool that lets you customize your competition videos by changing colors, adding text overlays, and placing image overlays — all from your browser.

## Features

- **Color Adjustments** — Brightness, contrast, saturation, hue rotation, and per-channel gamma (R/G/B)
- **Text Overlays** — Add multiple text layers with customizable font, size, color, position, shadow, outline, and time range
- **Image Overlays** — Add image layers with position, size, opacity, and time range controls
- **Real-Time Preview** — See color changes and overlays instantly in the browser
- **Video Export** — Renders the final video with all modifications using FFmpeg

## Requirements

- Python 3.10+
- FFmpeg (must be on PATH)

## Quick Start

```bash
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000** in your browser.

## How to Use

1. **Upload** your video (MP4, MOV, AVI, MKV, or WebM — up to 500 MB)
2. **Colors tab** — Adjust brightness, contrast, saturation, hue, and RGB gamma sliders
3. **Text tab** — Click "Add Text Overlay" to add text; configure content, size, color, position, and timing
4. **Images tab** — Click "Add Image Overlay" to upload and position images over the video
5. **Export** — Click "Export Video" to render the final result; download when complete

## Project Structure

```
├── app.py                  # Flask backend + FFmpeg rendering
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Main page
├── static/
│   ├── css/style.css       # Styles
│   └── js/app.js           # Frontend logic
├── uploads/                # Uploaded files (gitignored)
└── exports/                # Rendered videos (gitignored)
```

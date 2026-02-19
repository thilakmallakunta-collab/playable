import os
import uuid
import json
import subprocess
import tempfile
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

import analyzer

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = Path(__file__).parent / "uploads"
EXPORT_FOLDER = Path(__file__).parent / "exports"
UPLOAD_FOLDER.mkdir(exist_ok=True)
EXPORT_FOLDER.mkdir(exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024

ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _allowed_video(fn: str) -> bool:
    return Path(fn).suffix.lower() in ALLOWED_VIDEO_EXT


def _allowed_image(fn: str) -> bool:
    return Path(fn).suffix.lower() in ALLOWED_IMAGE_EXT


# ── Pages ─────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── File upload / serve ───────────────────────────────────────────────────

@app.route("/upload/video", methods=["POST"])
def upload_video():
    if "video" not in request.files:
        return jsonify(error="No video file"), 400
    f = request.files["video"]
    if not f.filename or not _allowed_video(f.filename):
        return jsonify(error="Invalid format. Use mp4, mov, avi, mkv, or webm."), 400

    vid_id = uuid.uuid4().hex[:8]
    ext = Path(f.filename).suffix.lower()
    fname = f"{vid_id}{ext}"
    path = UPLOAD_FOLDER / fname
    f.save(path)

    return jsonify(id=vid_id, filename=fname,
                   url=f"/files/uploads/{fname}",
                   probe=_probe(path))


@app.route("/upload/image", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return jsonify(error="No image file"), 400
    f = request.files["image"]
    if not f.filename or not _allowed_image(f.filename):
        return jsonify(error="Invalid image format."), 400

    img_id = uuid.uuid4().hex[:8]
    ext = Path(f.filename).suffix.lower()
    fname = f"{img_id}{ext}"
    path = UPLOAD_FOLDER / fname
    f.save(path)
    return jsonify(id=img_id, filename=fname, url=f"/files/uploads/{fname}")


@app.route("/files/uploads/<path:fn>")
def serve_upload(fn):
    return send_from_directory(UPLOAD_FOLDER, fn)


@app.route("/files/exports/<path:fn>")
def serve_export(fn):
    return send_from_directory(EXPORT_FOLDER, fn)


# ── Status / health check ─────────────────────────────────────────────────

@app.route("/status")
def status():
    """Report which AI features are available."""
    s = analyzer.get_status()
    return jsonify(
        features=s,
        notes={
            "easyocr": "Full OCR: reads text content" if s["easyocr"] else "Fallback: finds text regions but cannot read content.",
            "rembg": "AI segmentation (U2Net)" if s["rembg"] else "Fallback: GrabCut (OpenCV).",
            "yolo": "YOLOv8 object detection (80 categories)" if s["yolo"] else "Fallback: OpenCV only.",
            "midas": "MiDaS depth-based layer separation" if s["midas"] else "Fallback: intensity-based layers.",
            "opencv": "Visual region detection (always available)",
        },
    )


# ── Analyze endpoints ─────────────────────────────────────────────────────

@app.route("/analyze/frame", methods=["POST"])
def analyze_frame():
    """Return the frame image at a given timestamp as a data-URI."""
    data = request.get_json()
    fname = data.get("videoFilename")
    ts = float(data.get("timestamp", 0))

    path = UPLOAD_FOLDER / fname
    if not path.exists():
        return jsonify(error="Video not found"), 404

    frame = analyzer.extract_frame(path, ts)
    return jsonify(
        frame=analyzer.frame_to_data_uri(frame),
        width=frame.width,
        height=frame.height,
    )


@app.route("/analyze/background", methods=["POST"])
def analyze_background():
    """Segment the foreground from background."""
    try:
        data = request.get_json()
        fname = data.get("videoFilename")
        ts = float(data.get("timestamp", 0))

        path = UPLOAD_FOLDER / fname
        if not path.exists():
            return jsonify(error="Video not found"), 404

        frame = analyzer.extract_frame(path, ts)
        result = analyzer.detect_background(frame)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Background analysis failed: {e}"), 500


@app.route("/analyze/text", methods=["POST"])
def analyze_text():
    """Run OCR on the frame."""
    try:
        data = request.get_json()
        fname = data.get("videoFilename")
        ts = float(data.get("timestamp", 0))

        path = UPLOAD_FOLDER / fname
        if not path.exists():
            return jsonify(error="Video not found"), 404

        frame = analyzer.extract_frame(path, ts)
        regions = analyzer.detect_text(frame)
        return jsonify(
            texts=regions,
            frame=analyzer.frame_to_data_uri(frame),
            width=frame.width,
            height=frame.height,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Text analysis failed: {e}"), 500


@app.route("/analyze/images", methods=["POST"])
def analyze_images():
    """Detect image / object regions."""
    try:
        data = request.get_json()
        fname = data.get("videoFilename")
        ts = float(data.get("timestamp", 0))

        path = UPLOAD_FOLDER / fname
        if not path.exists():
            return jsonify(error="Video not found"), 404

        frame = analyzer.extract_frame(path, ts)
        regions = analyzer.detect_images(frame)
        return jsonify(
            images=regions,
            frame=analyzer.frame_to_data_uri(frame),
            width=frame.width,
            height=frame.height,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Image analysis failed: {e}"), 500


@app.route("/analyze/video-scan", methods=["POST"])
def analyze_video_scan():
    """Scan entire video for objects/images across all frames."""
    try:
        data = request.get_json()
        fname = data.get("videoFilename")
        interval = float(data.get("interval", 1.0))

        path = UPLOAD_FOLDER / fname
        if not path.exists():
            return jsonify(error="Video not found"), 404

        objects = analyzer.scan_video_objects(path, sample_interval=interval)
        return jsonify(
            objects=objects,
            count=len(objects),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Video scan failed: {e}"), 500


# ── Export ─────────────────────────────────────────────────────────────────

@app.route("/export", methods=["POST"])
def export_video():
    data = request.get_json() or {}
    fname = data.get("videoFilename")
    if not fname:
        return jsonify(error="No video filename"), 400

    input_path = UPLOAD_FOLDER / fname
    if not input_path.exists():
        return jsonify(error="Video not found"), 404

    colors = data.get("colors", {})
    text_edits = data.get("textEdits", [])
    image_edits = data.get("imageEdits", [])
    bg_edit = data.get("backgroundEdit")

    export_id = uuid.uuid4().hex[:8]
    output_path = EXPORT_FOLDER / f"{export_id}.mp4"

    try:
        if bg_edit and bg_edit.get("enabled"):
            _export_with_bg_replace(input_path, output_path, colors,
                                    text_edits, image_edits, bg_edit)
        else:
            _export_ffmpeg(input_path, output_path, colors,
                           text_edits, image_edits)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Export failed: {e}"), 500

    return jsonify(url=f"/files/exports/{export_id}.mp4",
                   filename=f"{export_id}.mp4")


# ── FFmpeg-based export (fast path, no bg replace) ────────────────────────

def _export_ffmpeg(input_path, output_path, colors, text_edits, image_edits):
    color_filters = _build_color_filters(colors)
    text_filters = _build_text_filters(text_edits)

    valid_imgs = []
    for ie in image_edits:
        rp = ie.get("replacementFilename")
        if rp and (UPLOAD_FOLDER / rp).exists():
            valid_imgs.append(ie)

    input_args = ["-i", str(input_path)]
    for ie in valid_imgs:
        input_args.extend(["-i", str(UPLOAD_FOLDER / ie["replacementFilename"])])

    has_overlays = bool(valid_imgs)
    has_vf = bool(color_filters) or bool(text_filters)

    if not has_overlays and not has_vf:
        cmd = ["ffmpeg", "-y"] + input_args + [
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path)]
    elif not has_overlays:
        vf = ",".join(color_filters + text_filters)
        cmd = ["ffmpeg", "-y"] + input_args + [
            "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path)]
    else:
        segs = []
        base = "[0:v]" + ",".join(color_filters) + "[base]" if color_filters else "[0:v]null[base]"
        segs.append(base)

        for idx, ie in enumerate(valid_imgs):
            inp = idx + 1
            ox, oy = ie.get("x", 0), ie.get("y", 0)
            ow, oh = ie.get("width", 200), ie.get("height", 200)

            cover = (
                f"[{inp}:v]scale={ow}:{oh}[ov{idx}]"
            )
            segs.append(cover)

            src = f"[v{idx}]" if idx > 0 else "[base]"
            dst = f"[v{idx + 1}]"
            segs.append(f"{src}[ov{idx}]overlay={ox}:{oy}{dst}")

        last = f"v{len(valid_imgs)}"
        if text_filters:
            segs.append(f"[{last}]{','.join(text_filters)}[final]")
            ml = "[final]"
        else:
            ml = f"[{last}]"

        cmd = ["ffmpeg", "-y"] + input_args + [
            "-filter_complex", ";".join(segs),
            "-map", ml, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path)]

    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-800:])


# ── Frame-by-frame export (slow path, with bg replace) ───────────────────

def _export_with_bg_replace(input_path, output_path, colors, text_edits,
                            image_edits, bg_edit):
    probe = _probe(input_path)
    fps = _get_fps(input_path)
    w, h = probe["width"], probe["height"]

    bg_color = None
    bg_img = None
    if bg_edit.get("color"):
        hex_c = bg_edit["color"].lstrip("#")
        bg_color = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4))
    if bg_edit.get("imageFilename"):
        bg_path = UPLOAD_FOLDER / bg_edit["imageFilename"]
        if bg_path.exists():
            bg_img = Image.open(bg_path).convert("RGB")

    replacement_imgs = {}
    for ie in image_edits:
        rp = ie.get("replacementFilename")
        if rp and (UPLOAD_FOLDER / rp).exists():
            ri = Image.open(UPLOAD_FOLDER / rp).convert("RGBA")
            ri = ri.resize((ie["width"], ie["height"]))
            replacement_imgs[id(ie)] = (ie, ri)

    tmpdir = Path(tempfile.mkdtemp())
    try:
        cap = cv2.VideoCapture(str(input_path))
        frame_idx = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break

            pil = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            pil = analyzer.replace_background_frame(pil, bg_color=bg_color, bg_image=bg_img)

            for key, (ie, ri) in replacement_imgs.items():
                ox, oy = ie["x"], ie["y"]
                pil.paste(ri, (ox, oy), ri)

            out_arr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(tmpdir / f"{frame_idx:06d}.png"), out_arr)
            frame_idx += 1

        cap.release()

        text_vf = _build_text_filters(text_edits)
        color_vf = _build_color_filters(colors)
        vf_parts = color_vf + text_vf
        vf_str = ",".join(vf_parts) if vf_parts else "null"

        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", str(tmpdir / "%06d.png"),
            "-i", str(input_path),
            "-vf", vf_str,
            "-map", "0:v", "-map", "1:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-shortest",
            str(output_path),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-800:])
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# ── Filter builders ───────────────────────────────────────────────────────

def _build_color_filters(colors: dict) -> list[str]:
    filters = []
    eq = []
    b = colors.get("brightness", 0)
    c = colors.get("contrast", 0)
    s = colors.get("saturation", 0)
    gr = colors.get("gammaR", 1.0)
    gg = colors.get("gammaG", 1.0)
    gb = colors.get("gammaB", 1.0)
    h = colors.get("hueRotate", 0)

    if b:
        eq.append(f"brightness={b / 100:.2f}")
    if c:
        eq.append(f"contrast={1 + c / 100:.2f}")
    if s:
        eq.append(f"saturation={1 + s / 100:.2f}")
    if gr != 1.0 or gg != 1.0 or gb != 1.0:
        eq.extend([f"gamma_r={gr:.2f}", f"gamma_g={gg:.2f}", f"gamma_b={gb:.2f}"])
    if eq:
        filters.append(f"eq={':'.join(eq)}")
    if h:
        filters.append(f"hue=h={h}")
    return filters


def _build_text_filters(text_edits: list) -> list[str]:
    filters = []
    for te in text_edits:
        new_text = te.get("newText", "").replace("'", "'\\''").replace(":", "\\:")
        if not new_text.strip():
            continue

        ox, oy = te.get("x", 0), te.get("y", 0)
        ow, oh = te.get("width", 100), te.get("height", 30)
        fill_color = te.get("fillColor", "black")
        fill_transparent = te.get("fillTransparent", False)
        font_size = te.get("fontSize", 24)
        font_color = te.get("fontColor", "white")
        font_style = te.get("fontStyle", "bold")

        if not fill_transparent:
            filters.append(
                f"drawbox=x={ox}:y={oy}:w={ow}:h={oh}:"
                f"color={fill_color}:t=fill"
            )

        font_file = ""
        if "italic" in font_style and "bold" in font_style:
            font_file = "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf"
        elif "italic" in font_style:
            font_file = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"
        elif "bold" in font_style:
            font_file = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        else:
            font_file = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

        font_family = te.get("fontFamily", "sans-serif")
        if font_family == "serif":
            font_file = font_file.replace("DejaVuSans", "DejaVuSerif")
        elif font_family == "monospace":
            font_file = font_file.replace("DejaVuSans", "DejaVuSansMono")

        font_part = f"fontfile={font_file}:" if Path(font_file).exists() else ""

        filters.append(
            f"drawtext=text='{new_text}':"
            f"{font_part}"
            f"fontsize={font_size}:fontcolor={font_color}:"
            f"x={ox + 4}:y={oy + 2}"
        )
    return filters


# ── Helpers ───────────────────────────────────────────────────────────────

def _probe(filepath: Path) -> dict:
    try:
        cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
               "-show_format", "-show_streams", str(filepath)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        info = json.loads(r.stdout)
        vs = next((s for s in info.get("streams", [])
                    if s.get("codec_type") == "video"), {})
        return {
            "width": int(vs.get("width", 0)),
            "height": int(vs.get("height", 0)),
            "duration": float(info.get("format", {}).get("duration", 0)),
            "codec": vs.get("codec_name", "unknown"),
        }
    except Exception:
        return {}


def _get_fps(filepath: Path) -> float:
    try:
        cmd = ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
               "-show_entries", "stream=r_frame_rate",
               "-of", "csv=p=0", str(filepath)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        num, den = r.stdout.strip().split("/")
        return round(int(num) / int(den), 2)
    except Exception:
        return 30.0


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

import os
import sys
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


# ── Find FFmpeg ───────────────────────────────────────────────────────────

def _find_ffmpeg():
    """Locate ffmpeg binary. Checks pip packages, PATH, common Windows locations."""
    # 1. Try static-ffmpeg (full build with all filters)
    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()
        ff = shutil.which("ffmpeg")
        fp = shutil.which("ffprobe")
        if ff:
            return ff, fp or ff
    except Exception:
        pass

    # 2. Check system PATH
    if shutil.which("ffmpeg"):
        return "ffmpeg", "ffprobe"

    # 3. Try imageio-ffmpeg (minimal build, fallback)
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        if ff and Path(ff).exists():
            return str(ff), str(ff)
    except Exception:
        pass

    # 4. Common Windows install locations
    if sys.platform == "win32":
        common_paths = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "ffmpeg" / "bin",
            Path("C:/ffmpeg/bin"),
            Path("C:/Program Files/ffmpeg/bin"),
            Path("C:/Program Files (x86)/ffmpeg/bin"),
            Path(os.environ.get("USERPROFILE", "")) / "ffmpeg" / "bin",
            Path(os.environ.get("USERPROFILE", "")) / "Downloads" / "ffmpeg" / "bin",
        ]
        for p in common_paths:
            ff = p / "ffmpeg.exe"
            if ff.exists():
                return str(ff), str(p / "ffprobe.exe")

        for drive in ["C:", "D:", "E:"]:
            for d in Path(drive + "/").glob("ffmpeg*/bin/ffmpeg.exe"):
                return str(d), str(d.parent / "ffprobe.exe")

    return None, None


FFMPEG, FFPROBE = _find_ffmpeg()

if not FFMPEG:
    print("\n" + "=" * 60)
    print("  FFmpeg NOT FOUND!")
    print("=" * 60)
    print()
    print("  VideoForge needs FFmpeg to export videos.")
    print()
    if sys.platform == "win32":
        print("  How to install on Windows:")
        print("  1. Go to https://www.gyan.dev/ffmpeg/builds/")
        print("  2. Download 'ffmpeg-release-essentials.zip'")
        print("  3. Extract to C:\\ffmpeg")
        print("  4. Add C:\\ffmpeg\\bin to your system PATH:")
        print("     - Press Win+S, search 'Environment Variables'")
        print("     - Edit 'Path' under System variables")
        print("     - Add: C:\\ffmpeg\\bin")
        print("     - Restart this terminal")
    else:
        print("  sudo apt install ffmpeg   # Ubuntu/Debian")
        print("  brew install ffmpeg       # Mac")
    print()
    print("  The app will start but export will not work.")
    print("=" * 60 + "\n")
    FFMPEG = "ffmpeg"
    FFPROBE = "ffprobe"

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
    s["ffmpeg"] = shutil.which(FFMPEG) is not None or Path(FFMPEG).exists()
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


@app.route("/analyze/custom-search", methods=["POST"])
def analyze_custom_search():
    """Search for any objects by text description using YOLO-World."""
    try:
        data = request.get_json()
        fname = data.get("videoFilename")
        ts = float(data.get("timestamp", 0))
        search_terms = data.get("searchTerms", [])

        if not search_terms:
            return jsonify(error="No search terms provided"), 400

        path = UPLOAD_FOLDER / fname
        if not path.exists():
            return jsonify(error="Video not found"), 404

        frame = analyzer.extract_frame(path, ts)
        results = analyzer.detect_custom_objects(frame, search_terms)
        return jsonify(
            objects=results,
            count=len(results),
            searchTerms=search_terms,
        )
    except ImportError as e:
        return jsonify(error=f"Custom search requires the 'clip' package which failed to install on your Python version. Try: python -m pip install --force-reinstall setuptools && python -m pip install openai-clip. Error: {e}"), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Custom search failed: {e}"), 500


@app.route("/analyze/track", methods=["POST"])
def analyze_track():
    """Track an object across frames."""
    try:
        data = request.get_json()
        fname = data.get("videoFilename")
        bbox = data.get("bbox")
        t_start = float(data.get("startTime", 0))
        t_end = float(data.get("endTime", -1))

        if not bbox:
            return jsonify(error="No bounding box provided"), 400

        path = UPLOAD_FOLDER / fname
        if not path.exists():
            return jsonify(error="Video not found"), 404

        positions = analyzer.track_object(path, bbox, t_start, t_end)
        return jsonify(
            positions=positions,
            count=len(positions),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify(error=f"Tracking failed: {e}"), 500


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
        if not (shutil.which(FFMPEG) or Path(FFMPEG).exists()):
            return jsonify(error="FFmpeg is not installed. Run: python -m pip install static-ffmpeg"), 500

        has_tracked = any(ie.get("tracked") and ie.get("positions") for ie in image_edits)

        if has_tracked or (bg_edit and bg_edit.get("enabled")):
            _export_frame_by_frame(input_path, output_path, colors,
                                   text_edits, image_edits, bg_edit)
        else:
            _export_ffmpeg(input_path, output_path, colors,
                           text_edits, image_edits)
    except FileNotFoundError:
        return jsonify(error="FFmpeg not found. Install it from https://www.gyan.dev/ffmpeg/builds/ — download 'ffmpeg-release-essentials.zip', extract to C:\\ffmpeg, and add C:\\ffmpeg\\bin to your system PATH. Then restart this app."), 500
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
        cmd = [FFMPEG, "-y"] + input_args + [
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path)]
    elif not has_overlays:
        vf = ",".join(color_filters + text_filters)
        cmd = [FFMPEG, "-y"] + input_args + [
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
            t_start = ie.get("startTime", 0)
            t_end = ie.get("endTime", 9999)

            segs.append(f"[{inp}:v]scale={ow}:{oh}[ov{idx}]")

            src = f"[v{idx}]" if idx > 0 else "[base]"
            dst = f"[v{idx + 1}]"
            enable = f"enable='between(t\\,{t_start}\\,{t_end})'"
            segs.append(f"{src}[ov{idx}]overlay={ox}:{oy}:{enable}{dst}")

        last = f"v{len(valid_imgs)}"
        if text_filters:
            segs.append(f"[{last}]{','.join(text_filters)}[final]")
            ml = "[final]"
        else:
            ml = f"[{last}]"

        cmd = [FFMPEG, "-y"] + input_args + [
            "-filter_complex", ";".join(segs),
            "-map", ml, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path)]

    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-800:])


# ── Frame-by-frame export (bg replace + tracked image overlays) ───────────

def _export_frame_by_frame(input_path, output_path, colors, text_edits,
                           image_edits, bg_edit):
    fps = _get_fps(input_path)

    do_bg = bg_edit and bg_edit.get("enabled")
    bg_color = None
    bg_img = None
    if do_bg:
        if bg_edit.get("color"):
            hex_c = bg_edit["color"].lstrip("#")
            bg_color = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4))
        if bg_edit.get("imageFilename"):
            bg_path = UPLOAD_FOLDER / bg_edit["imageFilename"]
            if bg_path.exists():
                bg_img = Image.open(bg_path).convert("RGB")

    replacements = []
    for ie in image_edits:
        rp = ie.get("replacementFilename")
        if not rp or not (UPLOAD_FOLDER / rp).exists():
            continue
        ri = Image.open(UPLOAD_FOLDER / rp).convert("RGBA")
        positions = ie.get("positions")
        t_start = ie.get("startTime", 0)
        t_end = ie.get("endTime", 9999)
        base_w = ie.get("width", 200)
        base_h = ie.get("height", 200)
        replacements.append({
            "image": ri,
            "positions": positions,
            "tracked": bool(positions),
            "x": ie.get("x", 0), "y": ie.get("y", 0),
            "width": base_w, "height": base_h,
            "startTime": t_start, "endTime": t_end,
        })

    tmpdir = Path(tempfile.mkdtemp())
    try:
        cap = cv2.VideoCapture(str(input_path))
        frame_idx = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break

            current_time = frame_idx / fps
            pil = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

            if do_bg:
                pil = analyzer.replace_background_frame(pil, bg_color=bg_color, bg_image=bg_img)

            for repl in replacements:
                if current_time < repl["startTime"] or current_time > repl["endTime"]:
                    continue

                if repl["tracked"] and repl["positions"]:
                    pos = _find_tracked_position(repl["positions"], frame_idx, current_time)
                    px, py = pos["x"], pos["y"]
                    pw, ph = pos["width"], pos["height"]
                else:
                    px, py = repl["x"], repl["y"]
                    pw, ph = repl["width"], repl["height"]

                ri = repl["image"].resize((max(1, int(pw)), max(1, int(ph))))
                pil.paste(ri, (int(px), int(py)), ri)

            out_arr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(tmpdir / f"{frame_idx:06d}.png"), out_arr)
            frame_idx += 1

        cap.release()

        text_vf = _build_text_filters(text_edits)
        color_vf = _build_color_filters(colors)
        vf_parts = color_vf + text_vf
        vf_str = ",".join(vf_parts) if vf_parts else "null"

        cmd = [
            FFMPEG, "-y",
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


def _find_tracked_position(positions, frame_idx, current_time):
    for pos in positions:
        if pos["frame"] == frame_idx:
            return pos
    closest = min(positions, key=lambda p: abs(p["time"] - current_time))
    return closest


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

        ox, oy = te.get("x", 0), te.get("y", 0)
        ow, oh = te.get("width", 100), te.get("height", 30)
        fill_color = te.get("fillColor", "black")
        cover_mode = te.get("coverMode", "cover")
        font_size = te.get("fontSize", 24)
        font_color = te.get("fontColor", "white")
        font_style = te.get("fontStyle", "bold")

        t_start = te.get("startTime", 0)
        t_end = te.get("endTime", 9999)
        enable = f"enable='between(t\\,{t_start}\\,{t_end})'"

        if cover_mode == "cover":
            filters.append(
                f"drawbox=x={ox}:y={oy}:w={ow}:h={oh}:"
                f"color={fill_color}:t=fill:{enable}"
            )
        elif cover_mode == "remove":
            pad = 2
            dx = max(0, ox - pad)
            dy = max(0, oy - pad)
            dw = ow + pad * 2
            dh = oh + pad * 2
            filters.append(f"delogo=x={dx}:y={dy}:w={dw}:h={dh}:{enable}")

        if not new_text.strip():
            continue

        font_file = _pick_font_file(font_style, te.get("fontFamily", "sans-serif"))
        font_part = f"fontfile={font_file}:" if font_file and Path(font_file).exists() else ""

        filters.append(
            f"drawtext=text='{new_text}':"
            f"{font_part}"
            f"fontsize={font_size}:fontcolor={font_color}:"
            f"x={ox + 4}:y={oy + 2}:{enable}"
        )
    return filters


def _pick_font_file(style: str, family: str) -> str:
    base = "DejaVuSans"
    if family == "serif":
        base = "DejaVuSerif"
    elif family == "monospace":
        base = "DejaVuSansMono"

    if "italic" in style and "bold" in style:
        variant = "-BoldOblique"
    elif "italic" in style:
        variant = "-Oblique"
    elif "bold" in style:
        variant = "-Bold"
    else:
        variant = ""

    path = f"/usr/share/fonts/truetype/dejavu/{base}{variant}.ttf"
    if Path(path).exists():
        return path

    for fallback_dir in ["/usr/share/fonts/truetype/dejavu/",
                         "/usr/share/fonts/truetype/liberation/",
                         "C:/Windows/Fonts/"]:
        p = Path(fallback_dir)
        if p.exists():
            fonts = list(p.glob("*.ttf"))
            if fonts:
                return str(fonts[0])
    return ""


# ── Helpers ───────────────────────────────────────────────────────────────

def _probe(filepath: Path) -> dict:
    # Try ffprobe first
    try:
        if FFPROBE and (shutil.which(FFPROBE) or Path(FFPROBE).exists()):
            cmd = [FFPROBE, "-v", "quiet", "-print_format", "json",
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
        pass

    # Fallback: use OpenCV
    try:
        cap = cv2.VideoCapture(str(filepath))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total / fps if fps > 0 else 0
        cap.release()
        return {"width": w, "height": h, "duration": duration, "codec": "unknown"}
    except Exception:
        return {}


def _get_fps(filepath: Path) -> float:
    try:
        if FFPROBE and (shutil.which(FFPROBE) or Path(FFPROBE).exists()):
            cmd = [FFPROBE, "-v", "quiet", "-select_streams", "v:0",
                   "-show_entries", "stream=r_frame_rate",
                   "-of", "csv=p=0", str(filepath)]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            num, den = r.stdout.strip().split("/")
            return round(int(num) / int(den), 2)
    except Exception:
        pass

    # Fallback: OpenCV
    try:
        cap = cv2.VideoCapture(str(filepath))
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
        return round(fps, 2) if fps > 0 else 30.0
    except Exception:
        return 30.0


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

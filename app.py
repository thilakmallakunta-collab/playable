import os
import uuid
import json
import subprocess
import shlex
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = Path(__file__).parent / "uploads"
EXPORT_FOLDER = Path(__file__).parent / "exports"
UPLOAD_FOLDER.mkdir(exist_ok=True)
EXPORT_FOLDER.mkdir(exist_ok=True)

app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

ALLOWED_VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def _allowed_video(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_VIDEO_EXT


def _allowed_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_IMAGE_EXT


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload/video", methods=["POST"])
def upload_video():
    if "video" not in request.files:
        return jsonify(error="No video file provided"), 400

    file = request.files["video"]
    if not file.filename or not _allowed_video(file.filename):
        return jsonify(error="Invalid video format. Use mp4, mov, avi, mkv, or webm."), 400

    video_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower()
    filename = f"{video_id}{ext}"
    filepath = UPLOAD_FOLDER / filename
    file.save(filepath)

    probe = _probe_video(filepath)

    return jsonify(
        id=video_id,
        filename=filename,
        url=f"/files/uploads/{filename}",
        probe=probe,
    )


@app.route("/upload/image", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return jsonify(error="No image file provided"), 400

    file = request.files["image"]
    if not file.filename or not _allowed_image(file.filename):
        return jsonify(error="Invalid image format."), 400

    img_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower()
    filename = f"{img_id}{ext}"
    filepath = UPLOAD_FOLDER / filename
    file.save(filepath)

    return jsonify(
        id=img_id,
        filename=filename,
        url=f"/files/uploads/{filename}",
    )


@app.route("/files/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


@app.route("/files/exports/<path:filename>")
def serve_export(filename):
    return send_from_directory(EXPORT_FOLDER, filename)


@app.route("/export", methods=["POST"])
def export_video():
    data = request.get_json()
    if not data:
        return jsonify(error="No data provided"), 400

    video_filename = data.get("videoFilename")
    if not video_filename:
        return jsonify(error="No video filename"), 400

    input_path = UPLOAD_FOLDER / video_filename
    if not input_path.exists():
        return jsonify(error="Video not found"), 404

    colors = data.get("colors", {})
    texts = data.get("texts", [])
    images = data.get("images", [])

    export_id = str(uuid.uuid4())[:8]
    output_path = EXPORT_FOLDER / f"{export_id}.mp4"

    try:
        _render_video(input_path, output_path, colors, texts, images)
    except Exception as e:
        return jsonify(error=f"Export failed: {str(e)}"), 500

    return jsonify(
        url=f"/files/exports/{export_id}.mp4",
        filename=f"{export_id}.mp4",
    )


@app.route("/download/<path:filename>")
def download_export(filename):
    return send_file(EXPORT_FOLDER / filename, as_attachment=True)


def _probe_video(filepath: Path) -> dict:
    try:
        cmd = [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format", "-show_streams",
            str(filepath),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        info = json.loads(result.stdout)

        video_stream = next(
            (s for s in info.get("streams", []) if s.get("codec_type") == "video"),
            {},
        )
        return {
            "width": int(video_stream.get("width", 0)),
            "height": int(video_stream.get("height", 0)),
            "duration": float(info.get("format", {}).get("duration", 0)),
            "codec": video_stream.get("codec_name", "unknown"),
        }
    except Exception:
        return {}


def _render_video(
    input_path: Path,
    output_path: Path,
    colors: dict,
    texts: list,
    images: list,
):
    color_filters = []

    brightness = colors.get("brightness", 0)
    contrast = colors.get("contrast", 0)
    saturation = colors.get("saturation", 0)
    hue_rotate = colors.get("hueRotate", 0)
    gamma_r = colors.get("gammaR", 1.0)
    gamma_g = colors.get("gammaG", 1.0)
    gamma_b = colors.get("gammaB", 1.0)

    eq_parts = []
    if brightness != 0:
        eq_parts.append(f"brightness={brightness / 100:.2f}")
    if contrast != 0:
        eq_parts.append(f"contrast={1 + contrast / 100:.2f}")
    if saturation != 0:
        eq_parts.append(f"saturation={1 + saturation / 100:.2f}")
    if gamma_r != 1.0 or gamma_g != 1.0 or gamma_b != 1.0:
        eq_parts.extend([f"gamma_r={gamma_r:.2f}", f"gamma_g={gamma_g:.2f}", f"gamma_b={gamma_b:.2f}"])

    if eq_parts:
        color_filters.append(f"eq={':'.join(eq_parts)}")
    if hue_rotate != 0:
        color_filters.append(f"hue=h={hue_rotate}")

    text_filters = []
    for txt in texts:
        content = txt.get("text", "").replace("'", "'\\''").replace(":", "\\:")
        if not content.strip():
            continue
        enable_expr = (
            f"between(t\\,{txt.get('startTime', 0)}\\,{txt.get('endTime', -1)})"
            if txt.get("endTime", -1) > 0
            else f"gte(t\\,{txt.get('startTime', 0)})"
        )
        dt = (
            f"drawtext=text='{content}':"
            f"fontsize={txt.get('fontSize', 48)}:"
            f"fontcolor={txt.get('color', 'white')}:"
            f"x={txt.get('x', 10)}:y={txt.get('y', 10)}:"
            f"shadowcolor={txt.get('shadowColor', 'black')}:"
            f"shadowx={txt.get('shadowX', 2)}:shadowy={txt.get('shadowY', 2)}:"
            f"borderw={txt.get('borderW', 0)}:bordercolor={txt.get('borderColor', 'black')}:"
            f"enable='{enable_expr}'"
        )
        text_filters.append(dt)

    valid_images = []
    for img in images:
        img_path = UPLOAD_FOLDER / img["filename"]
        if img_path.exists():
            valid_images.append(img)

    input_args = ["-i", str(input_path)]
    for img in valid_images:
        input_args.extend(["-i", str(UPLOAD_FOLDER / img["filename"])])

    has_overlays = bool(valid_images)
    has_simple_filters = bool(color_filters) or bool(text_filters)

    if not has_overlays and not has_simple_filters:
        cmd = ["ffmpeg", "-y"] + input_args + [
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path),
        ]
    elif not has_overlays:
        vf = ",".join(color_filters + text_filters)
        cmd = ["ffmpeg", "-y"] + input_args + [
            "-vf", vf,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path),
        ]
    else:
        segments = []

        base_chain = "[0:v]" + ",".join(color_filters) + "[base]" if color_filters else "[0:v]null[base]"
        segments.append(base_chain)

        for idx, img in enumerate(valid_images):
            input_idx = idx + 1
            w = img.get("width", 200)
            h = img.get("height", 200)
            opacity = img.get("opacity", 1.0)
            segments.append(
                f"[{input_idx}:v]scale={w}:{h},format=rgba,"
                f"colorchannelmixer=aa={opacity}[img{idx}]"
            )

            enable_expr = (
                f"between(t\\,{img.get('startTime', 0)}\\,{img.get('endTime', -1)})"
                if img.get("endTime", -1) > 0
                else f"gte(t\\,{img.get('startTime', 0)})"
            )
            src = f"[v{idx}]" if idx > 0 else "[base]"
            dst = f"[v{idx + 1}]"
            segments.append(
                f"{src}[img{idx}]overlay={img.get('x', 0)}:{img.get('y', 0)}:"
                f"enable='{enable_expr}'{dst}"
            )

        last_label = f"v{len(valid_images)}"

        if text_filters:
            segments.append(f"[{last_label}]{','.join(text_filters)}[final]")
            map_label = "[final]"
        else:
            map_label = f"[{last_label}]"

        filter_complex = ";".join(segments)

        cmd = ["ffmpeg", "-y"] + input_args + [
            "-filter_complex", filter_complex,
            "-map", map_label, "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", str(output_path),
        ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr[-500:]}")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

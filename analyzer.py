"""
Video frame analysis: background segmentation, text detection (OCR), and
image/object detection.

All heavy ML imports are lazy so the app still starts quickly even if a
dependency is missing.
"""

import io
import base64
import logging
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------

def extract_frame(video_path: str | Path, timestamp: float = 0) -> Image.Image:
    """Return a PIL Image for the frame at *timestamp* seconds."""
    cap = cv2.VideoCapture(str(video_path))
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError(f"Cannot read frame at {timestamp}s")
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(frame_rgb)
    finally:
        cap.release()


def frame_to_data_uri(img: Image.Image, fmt: str = "JPEG", quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode()
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64,{b64}"


def frame_to_bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Background detection & removal
# ---------------------------------------------------------------------------

_rembg_session = None


def _get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("u2net")
    return _rembg_session


def detect_background(frame: Image.Image) -> dict:
    """
    Return the foreground (RGBA with transparent background) and a binary
    mask image.  Both are returned as data-URIs for the frontend.
    """
    from rembg import remove

    session = _get_rembg_session()
    fg_rgba = remove(frame, session=session)

    alpha = fg_rgba.split()[-1]
    mask = alpha.point(lambda p: 255 if p > 128 else 0)

    return {
        "foreground": frame_to_data_uri(fg_rgba, fmt="PNG"),
        "mask": frame_to_data_uri(mask.convert("RGB"), fmt="PNG"),
        "width": frame.width,
        "height": frame.height,
    }


def replace_background_frame(
    frame: Image.Image,
    bg_color: tuple[int, int, int] | None = None,
    bg_image: Image.Image | None = None,
) -> Image.Image:
    """Replace the background of a single frame."""
    from rembg import remove

    session = _get_rembg_session()
    fg_rgba = remove(frame, session=session)

    if bg_image is not None:
        bg = bg_image.resize(frame.size).convert("RGBA")
    elif bg_color is not None:
        bg = Image.new("RGBA", frame.size, (*bg_color, 255))
    else:
        bg = Image.new("RGBA", frame.size, (0, 0, 0, 255))

    bg.paste(fg_rgba, mask=fg_rgba.split()[-1])
    return bg.convert("RGB")


# ---------------------------------------------------------------------------
# Text detection (OCR)
# ---------------------------------------------------------------------------

_ocr_reader = None


def _get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        import easyocr
        _ocr_reader = easyocr.Reader(["en"], gpu=False)
    return _ocr_reader


def detect_text(frame: Image.Image) -> list[dict]:
    """
    Detect text regions.  Returns a list of dicts:
        { bbox: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], text: str, confidence: float,
          x, y, width, height }
    """
    reader = _get_ocr_reader()
    arr = np.array(frame)
    results = reader.readtext(arr)

    detected = []
    for bbox, text, conf in results:
        pts = [[int(p[0]), int(p[1])] for p in bbox]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x, y = min(xs), min(ys)
        w, h = max(xs) - x, max(ys) - y
        detected.append({
            "bbox": pts,
            "text": text,
            "confidence": round(float(conf), 3),
            "x": x,
            "y": y,
            "width": w,
            "height": h,
        })

    return detected


# ---------------------------------------------------------------------------
# Image / object detection (OpenCV contour-based)
# ---------------------------------------------------------------------------

def detect_images(frame: Image.Image, min_area_ratio: float = 0.005) -> list[dict]:
    """
    Detect distinct rectangular image regions (logos, photos, graphics)
    using edge detection and contour analysis.

    *min_area_ratio* is the minimum fraction of total frame area for a region
    to be reported (filters out tiny noise).
    """
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    total_area = gray.shape[0] * gray.shape[1]
    min_area = total_area * min_area_ratio
    max_area = total_area * 0.85  # ignore regions covering almost the whole frame

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 120)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=3)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detected = []
    seen_rects: list[tuple] = []

    for cnt in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        aspect = w / h if h > 0 else 0
        if aspect < 0.15 or aspect > 7:
            continue

        duplicate = False
        for sx, sy, sw, sh in seen_rects:
            overlap_x = max(0, min(x + w, sx + sw) - max(x, sx))
            overlap_y = max(0, min(y + h, sy + sh) - max(y, sy))
            overlap_area = overlap_x * overlap_y
            if overlap_area > 0.5 * min(w * h, sw * sh):
                duplicate = True
                break
        if duplicate:
            continue

        seen_rects.append((x, y, w, h))

        thumb = frame.crop((x, y, x + w, y + h))
        thumb.thumbnail((120, 120))

        detected.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "area": int(area),
            "thumbnail": frame_to_data_uri(thumb, fmt="JPEG", quality=70),
        })

        if len(detected) >= 20:
            break

    return detected

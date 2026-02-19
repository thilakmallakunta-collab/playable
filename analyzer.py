"""
Video frame analysis with graceful fallbacks.

AI features (easyocr, rembg) are used when available. If they're not
installed (e.g. Python 3.14 or missing deps), OpenCV-only fallbacks kick in
automatically.
"""

import io
import base64
import logging
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# ── Optional dependency detection ──────────────────────────────────────────

HAS_EASYOCR = False
HAS_REMBG = False

try:
    import easyocr
    HAS_EASYOCR = True
    log.info("easyocr available")
except Exception as e:
    log.warning(f"easyocr not available: {e}")

try:
    from rembg import remove as _rembg_remove, new_session as _rembg_new_session
    HAS_REMBG = True
    log.info("rembg available")
except Exception as e:
    log.warning(f"rembg not available: {e}")


def get_status() -> dict:
    return {
        "easyocr": HAS_EASYOCR,
        "rembg": HAS_REMBG,
        "opencv": True,
    }


# ── Frame extraction ───────────────────────────────────────────────────────

def extract_frame(video_path: str | Path, timestamp: float = 0) -> Image.Image:
    cap = cv2.VideoCapture(str(video_path))
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError(f"Cannot read frame at {timestamp}s")
        return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    finally:
        cap.release()


def frame_to_data_uri(img: Image.Image, fmt: str = "JPEG", quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode()
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64,{b64}"


# ── Background detection ──────────────────────────────────────────────────

_rembg_session = None


def detect_background(frame: Image.Image) -> dict:
    if HAS_REMBG:
        return _detect_bg_rembg(frame)
    return _detect_bg_grabcut(frame)


def _detect_bg_rembg(frame: Image.Image) -> dict:
    global _rembg_session
    if _rembg_session is None:
        _rembg_session = _rembg_new_session("u2net")

    fg_rgba = _rembg_remove(frame, session=_rembg_session)
    alpha = fg_rgba.split()[-1]
    mask = alpha.point(lambda p: 255 if p > 128 else 0)

    return {
        "foreground": frame_to_data_uri(fg_rgba, fmt="PNG"),
        "mask": frame_to_data_uri(mask.convert("RGB"), fmt="PNG"),
        "width": frame.width,
        "height": frame.height,
        "method": "rembg (AI)",
    }


def _detect_bg_grabcut(frame: Image.Image) -> dict:
    """Fallback: OpenCV GrabCut for foreground/background segmentation."""
    arr = np.array(frame)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    mask = np.zeros((h, w), np.uint8)
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)

    margin_x = max(10, w // 15)
    margin_y = max(10, h // 15)
    rect = (margin_x, margin_y, w - 2 * margin_x, h - 2 * margin_y)

    cv2.grabCut(bgr, mask, rect, bg_model, fg_model, 5, cv2.GC_INIT_WITH_RECT)

    fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    fg_rgba = np.dstack([arr, fg_mask])
    fg_img = Image.fromarray(fg_rgba, "RGBA")

    mask_img = Image.fromarray(fg_mask).convert("RGB")

    return {
        "foreground": frame_to_data_uri(fg_img, fmt="PNG"),
        "mask": frame_to_data_uri(mask_img, fmt="PNG"),
        "width": frame.width,
        "height": frame.height,
        "method": "GrabCut (OpenCV)",
    }


def replace_background_frame(
    frame: Image.Image,
    bg_color: tuple[int, int, int] | None = None,
    bg_image: Image.Image | None = None,
) -> Image.Image:
    if HAS_REMBG:
        return _replace_bg_rembg(frame, bg_color, bg_image)
    return _replace_bg_grabcut(frame, bg_color, bg_image)


def _replace_bg_rembg(frame, bg_color, bg_image):
    global _rembg_session
    if _rembg_session is None:
        _rembg_session = _rembg_new_session("u2net")
    fg_rgba = _rembg_remove(frame, session=_rembg_session)
    return _composite(fg_rgba, frame.size, bg_color, bg_image)


def _replace_bg_grabcut(frame, bg_color, bg_image):
    arr = np.array(frame)
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    mask = np.zeros((h, w), np.uint8)
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)
    margin_x, margin_y = max(10, w // 15), max(10, h // 15)
    rect = (margin_x, margin_y, w - 2 * margin_x, h - 2 * margin_y)
    cv2.grabCut(bgr, mask, rect, bg_model, fg_model, 5, cv2.GC_INIT_WITH_RECT)

    fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    fg_rgba = np.dstack([arr, fg_mask])
    fg_img = Image.fromarray(fg_rgba, "RGBA")
    return _composite(fg_img, frame.size, bg_color, bg_image)


def _composite(fg_rgba, size, bg_color, bg_image):
    if bg_image is not None:
        bg = bg_image.resize(size).convert("RGBA")
    elif bg_color is not None:
        bg = Image.new("RGBA", size, (*bg_color, 255))
    else:
        bg = Image.new("RGBA", size, (0, 0, 0, 255))
    bg.paste(fg_rgba, mask=fg_rgba.split()[-1])
    return bg.convert("RGB")


# ── Text detection ─────────────────────────────────────────────────────────

_ocr_reader = None


def detect_text(frame: Image.Image) -> list[dict]:
    if HAS_EASYOCR:
        return _detect_text_easyocr(frame)
    return _detect_text_opencv(frame)


def _detect_text_easyocr(frame: Image.Image) -> list[dict]:
    global _ocr_reader
    if _ocr_reader is None:
        _ocr_reader = easyocr.Reader(["en"], gpu=False)

    arr = np.array(frame)
    results = _ocr_reader.readtext(arr)

    detected = []
    for bbox, text, conf in results:
        pts = [[int(p[0]), int(p[1])] for p in bbox]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        x, y = min(xs), min(ys)
        w, h = max(xs) - x, max(ys) - y
        detected.append({
            "bbox": pts, "text": text, "confidence": round(float(conf), 3),
            "x": x, "y": y, "width": w, "height": h,
        })
    return detected


def _detect_text_opencv(frame: Image.Image) -> list[dict]:
    """
    Fallback: find text-like regions using MSER + heuristic filtering.
    Cannot read the text content, but finds where text is located.
    """
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    mser = cv2.MSER_create()
    mser.setMinArea(60)
    mser.setMaxArea(14400)

    regions, _ = mser.detectRegions(gray)

    bboxes = []
    for region in regions:
        x, y, w, h = cv2.boundingRect(region)
        aspect = w / h if h > 0 else 0
        if 0.1 < aspect < 15 and h > 8 and h < frame.height * 0.3:
            bboxes.append((x, y, w, h))

    if not bboxes:
        return []

    merged = _merge_text_boxes(bboxes, frame.width, frame.height)

    detected = []
    for x, y, w, h in merged:
        region_img = gray[y:y+h, x:x+w]
        text_hint = f"[Text region at {x},{y}]"

        detected.append({
            "bbox": [[x, y], [x+w, y], [x+w, y+h], [x, y+h]],
            "text": text_hint,
            "confidence": 0.0,
            "x": x, "y": y, "width": w, "height": h,
        })

    detected.sort(key=lambda d: (d["y"], d["x"]))
    return detected[:20]


def _merge_text_boxes(bboxes, img_w, img_h):
    """Group nearby small boxes into larger text line regions."""
    if not bboxes:
        return []

    rects = np.array(bboxes)
    xs = rects[:, 0]
    ys = rects[:, 1]
    ws = rects[:, 2]
    hs = rects[:, 3]

    mask = np.zeros((img_h, img_w), dtype=np.uint8)
    for x, y, w, h in bboxes:
        pad = max(3, h // 3)
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(img_w, x + w + pad)
        y2 = min(img_h, y + h + pad)
        cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 5))
    mask = cv2.dilate(mask, kernel, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    merged = []
    min_area = img_w * img_h * 0.001
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w * h < min_area:
            continue
        if w < 15 or h < 10:
            continue
        merged.append((x, y, w, h))

    return merged


# ── Image / object detection ──────────────────────────────────────────────

def detect_images(frame: Image.Image, min_area_ratio: float = 0.005) -> list[dict]:
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    total_area = gray.shape[0] * gray.shape[1]
    min_area = total_area * min_area_ratio
    max_area = total_area * 0.85

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 120)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=3)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detected = []
    seen: list[tuple] = []

    for cnt in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        aspect = w / h if h > 0 else 0
        if aspect < 0.15 or aspect > 7:
            continue

        duplicate = False
        for sx, sy, sw, sh in seen:
            ox = max(0, min(x + w, sx + sw) - max(x, sx))
            oy = max(0, min(y + h, sy + sh) - max(y, sy))
            if ox * oy > 0.5 * min(w * h, sw * sh):
                duplicate = True
                break
        if duplicate:
            continue
        seen.append((x, y, w, h))

        thumb = frame.crop((x, y, x + w, y + h))
        thumb.thumbnail((120, 120))

        detected.append({
            "x": int(x), "y": int(y), "width": int(w), "height": int(h),
            "area": int(area),
            "thumbnail": frame_to_data_uri(thumb, fmt="JPEG", quality=70),
        })

        if len(detected) >= 20:
            break

    return detected

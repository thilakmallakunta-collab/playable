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
HAS_YOLO = False

try:
    import easyocr
    HAS_EASYOCR = True
except Exception as e:
    log.warning(f"easyocr not available: {e}")

try:
    from rembg import remove as _rembg_remove, new_session as _rembg_new_session
    HAS_REMBG = True
except Exception as e:
    log.warning(f"rembg not available: {e}")

try:
    from ultralytics import YOLO as _YOLO
    HAS_YOLO = True
except Exception as e:
    log.warning(f"ultralytics/YOLO not available: {e}")


def get_status() -> dict:
    return {
        "easyocr": HAS_EASYOCR,
        "rembg": HAS_REMBG,
        "yolo": HAS_YOLO,
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

_yolo_model = None


def detect_images(frame: Image.Image) -> list[dict]:
    """
    Detect all objects and visual regions in the frame.
    Uses YOLO for named object detection + enhanced visual region
    detection for logos, graphics, icons, and other non-standard elements.
    Results from both methods are merged and de-duplicated.
    """
    results = []

    if HAS_YOLO:
        results.extend(_detect_yolo(frame))

    results.extend(_detect_visual_regions(frame))

    results = _deduplicate(results, frame.width, frame.height)

    results.sort(key=lambda d: d["area"], reverse=True)

    for idx, r in enumerate(results):
        r["index"] = idx

    return results


def _detect_yolo(frame: Image.Image) -> list[dict]:
    global _yolo_model
    if _yolo_model is None:
        _yolo_model = _YOLO("yolov8n.pt")

    arr = np.array(frame)
    preds = _yolo_model(arr, verbose=False, conf=0.25)

    detected = []
    for result in preds:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = result.names[cls_id]

            x, y = int(x1), int(y1)
            w, h = int(x2 - x1), int(y2 - y1)

            if w < 5 or h < 5:
                continue

            thumb = frame.crop((x, y, x + w, y + h))
            thumb.thumbnail((120, 120))

            detected.append({
                "x": x, "y": y, "width": w, "height": h,
                "area": w * h,
                "label": label,
                "confidence": round(conf, 3),
                "source": "yolo",
                "thumbnail": frame_to_data_uri(thumb, fmt="JPEG", quality=70),
            })

    return detected


def _detect_visual_regions(frame: Image.Image) -> list[dict]:
    """
    Detect every distinct visual region (logos, icons, graphics, panels,
    embedded images) using multiple OpenCV techniques.  Each element is
    kept separate — only truly overlapping duplicates are merged.
    """
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    total_area = h * w
    min_area = max(150, total_area * 0.0003)
    max_area = total_area * 0.80

    candidates = []

    blurred = cv2.GaussianBlur(gray, (3, 3), 0)

    # Method 1a: Canny edges with moderate closing — larger panels/boxes
    edges = cv2.Canny(blurred, 20, 80)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, k, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        a = cv2.contourArea(cnt)
        if min_area <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    # Method 1b: Canny edges with light closing — smaller individual items
    k_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed_light = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, k_small, iterations=1)
    contours_light, _ = cv2.findContours(
        closed_light, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours_light:
        a = cv2.contourArea(cnt)
        if min_area * 0.5 <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    # Method 1c: Canny edges — nested/child contours (elements inside panels)
    contours_tree, hierarchy = cv2.findContours(
        closed, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is not None:
        for i, cnt in enumerate(contours_tree):
            if hierarchy[0][i][3] != -1:
                a = cv2.contourArea(cnt)
                if min_area * 0.3 <= a <= max_area * 0.5:
                    candidates.append(cv2.boundingRect(cnt))

    # Method 2: Color saturation segmentation
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    _, sat_mask = cv2.threshold(hsv[:, :, 1], 40, 255, cv2.THRESH_BINARY)
    sat_mask = cv2.morphologyEx(sat_mask, cv2.MORPH_CLOSE, k, iterations=2)
    contours_sat, _ = cv2.findContours(sat_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours_sat:
        a = cv2.contourArea(cnt)
        if min_area <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    # Method 3: Adaptive threshold — catches text blocks, subtle graphics
    adaptive = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 15, 4)
    k2 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    adaptive = cv2.morphologyEx(adaptive, cv2.MORPH_CLOSE, k2, iterations=2)
    contours_ad, _ = cv2.findContours(adaptive, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours_ad:
        a = cv2.contourArea(cnt)
        if min_area <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    # Method 4: MSER — stable regions (icons, small images, logos)
    mser = cv2.MSER_create()
    mser.setMinArea(max(80, int(min_area * 0.3)))
    mser.setMaxArea(int(min(max_area, 80000)))
    try:
        regions, _ = mser.detectRegions(gray)
        for region in regions:
            bx, by, bw, bh = cv2.boundingRect(region)
            if min_area * 0.3 <= bw * bh <= max_area:
                candidates.append((bx, by, bw, bh))
    except Exception:
        pass

    # De-duplicate: keep distinct elements, merge only true duplicates
    deduped = _dedup_boxes(candidates, min_area, max_area)

    detected = []
    for bx, by, bw, bh in deduped:
        if bw < 8 or bh < 8:
            continue
        aspect = bw / bh if bh > 0 else 0
        if aspect < 0.08 or aspect > 12:
            continue

        thumb = frame.crop((bx, by, bx + bw, by + bh))
        thumb.thumbnail((120, 120))

        detected.append({
            "x": int(bx), "y": int(by), "width": int(bw), "height": int(bh),
            "area": int(bw * bh),
            "label": "visual region",
            "confidence": 0.0,
            "source": "opencv",
            "thumbnail": frame_to_data_uri(thumb, fmt="JPEG", quality=70),
        })

    return detected


def _dedup_boxes(boxes, min_area, max_area):
    """
    Merge truly redundant detections (same region found by multiple
    methods) but keep distinct elements, including nested ones
    (e.g. a logo inside a header bar).
    """
    if not boxes:
        return []

    filtered = []
    for bx, by, bw, bh in boxes:
        a = bw * bh
        if a < min_area or a > max_area:
            continue
        filtered.append((bx, by, bw, bh, a))

    if not filtered:
        return []

    filtered.sort(key=lambda b: b[4], reverse=True)

    keep = []
    used = [False] * len(filtered)

    for i in range(len(filtered)):
        if used[i]:
            continue

        bx, by, bw, bh, area_i = filtered[i]
        used[i] = True

        for j in range(i + 1, len(filtered)):
            if used[j]:
                continue
            bx2, by2, bw2, bh2, area_j = filtered[j]

            ox = max(0, min(bx + bw, bx2 + bw2) - max(bx, bx2))
            oy = max(0, min(by + bh, by2 + bh2) - max(by, by2))
            inter = ox * oy
            union = area_i + area_j - inter
            iou = inter / union if union > 0 else 0

            if iou > 0.55:
                used[j] = True
                continue

            contained = inter / area_j if area_j > 0 else 0
            size_ratio = area_j / area_i if area_i > 0 else 0

            if contained > 0.8 and size_ratio > 0.6:
                used[j] = True

        keep.append((bx, by, bw, bh))

        if len(keep) >= 50:
            break

    return keep


def _deduplicate(items, img_w, img_h):
    """
    Remove near-duplicate detections while keeping nested elements.
    Prefers YOLO labels.  Two items are duplicates only if they cover
    roughly the same region (high IoU), not if one is inside the other
    at a different scale.
    """
    if not items:
        return []

    yolo_items = [i for i in items if i.get("source") == "yolo"]
    other_items = [i for i in items if i.get("source") != "yolo"]

    keep = list(yolo_items)

    for item in other_items:
        x, y, w, h = item["x"], item["y"], item["width"], item["height"]
        area = w * h
        is_dup = False

        for kept in keep:
            kx, ky, kw, kh = kept["x"], kept["y"], kept["width"], kept["height"]
            karea = kw * kh

            ox = max(0, min(x + w, kx + kw) - max(x, kx))
            oy = max(0, min(y + h, ky + kh) - max(y, ky))
            inter = ox * oy
            union = area + karea - inter
            iou = inter / union if union > 0 else 0

            if iou > 0.5:
                is_dup = True
                break

            size_ratio = min(area, karea) / max(area, karea) if max(area, karea) > 0 else 0
            contained = inter / min(area, karea) if min(area, karea) > 0 else 0
            if contained > 0.8 and size_ratio > 0.6:
                is_dup = True
                break

        if not is_dup:
            keep.append(item)

    return keep[:50]

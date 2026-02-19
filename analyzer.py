"""
Video frame analysis with graceful fallbacks.

- Layered background segmentation (depth-based via MiDaS, or GrabCut fallback)
- Text detection (EasyOCR or MSER fallback)
- Object/image detection (YOLO + multi-method OpenCV)
- Full-video object scanning across all frames
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
HAS_MIDAS = False

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

try:
    import torch
    _midas_model = None
    _midas_transform = None
    HAS_MIDAS = True
except Exception as e:
    log.warning(f"torch/MiDaS not available: {e}")


def get_status() -> dict:
    return {
        "easyocr": HAS_EASYOCR,
        "rembg": HAS_REMBG,
        "yolo": HAS_YOLO,
        "midas": HAS_MIDAS,
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


def get_video_info(video_path: str | Path) -> dict:
    cap = cv2.VideoCapture(str(video_path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total / fps if fps > 0 else 0
        return {"fps": fps, "totalFrames": total, "width": w, "height": h, "duration": duration}
    finally:
        cap.release()


def frame_to_data_uri(img: Image.Image, fmt: str = "JPEG", quality: int = 85) -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode()
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64,{b64}"


# ═══════════════════════════════════════════════════════════════════════════
# 1. BACKGROUND DETECTION (foreground/background segmentation)
# ═══════════════════════════════════════════════════════════════════════════

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
        global _rembg_session
        if _rembg_session is None:
            _rembg_session = _rembg_new_session("u2net")
        fg_rgba = _rembg_remove(frame, session=_rembg_session)
    else:
        arr = np.array(frame)
        bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        h, w = bgr.shape[:2]
        mask = np.zeros((h, w), np.uint8)
        bg_m = np.zeros((1, 65), np.float64)
        fg_m = np.zeros((1, 65), np.float64)
        mx, my = max(10, w // 15), max(10, h // 15)
        cv2.grabCut(bgr, mask, (mx, my, w - 2*mx, h - 2*my), bg_m, fg_m, 5, cv2.GC_INIT_WITH_RECT)
        fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        fg_rgba = Image.fromarray(np.dstack([arr, fg_mask]), "RGBA")

    if bg_image is not None:
        bg = bg_image.resize(frame.size).convert("RGBA")
    elif bg_color is not None:
        bg = Image.new("RGBA", frame.size, (*bg_color, 255))
    else:
        bg = Image.new("RGBA", frame.size, (0, 0, 0, 255))
    bg.paste(fg_rgba, mask=fg_rgba.split()[-1])
    return bg.convert("RGB")


# ═══════════════════════════════════════════════════════════════════════════
# 2. TEXT DETECTION
# ═══════════════════════════════════════════════════════════════════════════

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
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    mser = cv2.MSER_create()
    mser.setMinArea(60)
    mser.setMaxArea(14400)
    regions, _ = mser.detectRegions(gray)

    bboxes = []
    for region in regions:
        x, y, w, h = cv2.boundingRect(region)
        if 0.1 < (w / h if h > 0 else 0) < 15 and 8 < h < frame.height * 0.3:
            bboxes.append((x, y, w, h))

    merged = _merge_text_boxes(bboxes, frame.width, frame.height)

    detected = []
    for x, y, w, h in merged:
        detected.append({
            "bbox": [[x, y], [x+w, y], [x+w, y+h], [x, y+h]],
            "text": f"[Text region at {x},{y}]",
            "confidence": 0.0,
            "x": x, "y": y, "width": w, "height": h,
        })
    detected.sort(key=lambda d: (d["y"], d["x"]))
    return detected[:20]


def _merge_text_boxes(bboxes, img_w, img_h):
    if not bboxes:
        return []
    mask = np.zeros((img_h, img_w), dtype=np.uint8)
    for x, y, w, h in bboxes:
        pad = max(3, h // 3)
        cv2.rectangle(mask,
                      (max(0, x - pad), max(0, y - pad)),
                      (min(img_w, x + w + pad), min(img_h, y + h + pad)),
                      255, -1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 5))
    mask = cv2.dilate(mask, kernel, iterations=2)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    merged = []
    min_area = img_w * img_h * 0.001
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w * h >= min_area and w >= 15 and h >= 10:
            merged.append((x, y, w, h))
    return merged


# ═══════════════════════════════════════════════════════════════════════════
# 3. IMAGE / OBJECT DETECTION
# ═══════════════════════════════════════════════════════════════════════════

_yolo_det_model = None
_yolo_world_model = None
_rembg_session = None

YOLO_CATEGORIES = {
    "people": ["person"],
    "animals": ["bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"],
    "vehicles": ["bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat"],
    "food": ["banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake"],
    "furniture": ["chair", "couch", "bed", "dining table", "toilet"],
    "electronics": ["tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "refrigerator"],
    "sports": ["frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket"],
    "accessories": ["backpack", "umbrella", "handbag", "tie", "suitcase"],
    "kitchen": ["bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl"],
    "other": ["traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "potted plant", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush", "sink"],
}

def _get_category(label: str) -> str:
    for cat, items in YOLO_CATEGORIES.items():
        if label in items:
            return cat
    return "other"


def detect_images(frame: Image.Image) -> list[dict]:
    results = []
    if HAS_YOLO:
        results.extend(_detect_yolo(frame))
    results.extend(_detect_visual_regions(frame))
    results = _deduplicate(results, frame.width, frame.height)
    results.sort(key=lambda d: (-d.get("confidence", 0), -d["area"]))
    for idx, r in enumerate(results):
        r["index"] = idx
    return results


def _detect_yolo(frame: Image.Image) -> list[dict]:
    global _yolo_det_model

    if _yolo_det_model is None:
        for model_name in ["yolo11x.pt", "yolov8x.pt", "yolov8m.pt", "yolov8n.pt"]:
            if Path(model_name).exists():
                _yolo_det_model = _YOLO(model_name)
                log.info(f"Loaded {model_name}")
                break
        if _yolo_det_model is None:
            _yolo_det_model = _YOLO("yolo11x.pt")

    arr = np.array(frame)
    preds = _yolo_det_model(arr, verbose=False, conf=0.12, iou=0.4)

    return _parse_yolo_results(preds, frame)


def detect_custom_objects(frame: Image.Image, search_terms: list[str]) -> list[dict]:
    """
    Open-vocabulary detection: find ANY object described by text.
    Uses YOLO-World to search for custom categories like 'trophy',
    'medal', 'logo', 'jersey', etc.
    """
    global _yolo_world_model

    if _yolo_world_model is None:
        _yolo_world_model = _YOLO("yolov8x-worldv2.pt")

    _yolo_world_model.set_classes(search_terms)

    arr = np.array(frame)
    preds = _yolo_world_model(arr, verbose=False, conf=0.08)

    return _parse_yolo_results(preds, frame, source="yolo-world")


def _parse_yolo_results(preds, frame, source="yolo"):
    detected = []
    for result in preds:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = result.names[cls_id]
            category = _get_category(label)
            x, y, w, h = int(x1), int(y1), int(x2 - x1), int(y2 - y1)
            if w < 5 or h < 5:
                continue

            thumb = frame.crop((max(0, x), max(0, y),
                                min(frame.width, x + w), min(frame.height, y + h)))
            thumb.thumbnail((120, 120))

            detected.append({
                "x": x, "y": y, "width": w, "height": h,
                "area": w * h,
                "label": label,
                "category": category,
                "confidence": round(conf, 3),
                "source": source,
                "thumbnail": frame_to_data_uri(thumb, fmt="JPEG", quality=70),
            })
    return detected


def _detect_visual_regions(frame: Image.Image) -> list[dict]:
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    total_area = h * w
    min_area = max(150, total_area * 0.0003)
    max_area = total_area * 0.80

    candidates = []
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)

    edges = cv2.Canny(blurred, 20, 80)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, k, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours:
        a = cv2.contourArea(cnt)
        if min_area <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    k_small = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed_light = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, k_small, iterations=1)
    contours_light, _ = cv2.findContours(closed_light, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours_light:
        a = cv2.contourArea(cnt)
        if min_area * 0.5 <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    contours_tree, hierarchy = cv2.findContours(closed, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is not None:
        for i, cnt in enumerate(contours_tree):
            if hierarchy[0][i][3] != -1:
                a = cv2.contourArea(cnt)
                if min_area * 0.3 <= a <= max_area * 0.5:
                    candidates.append(cv2.boundingRect(cnt))

    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    _, sat_mask = cv2.threshold(hsv[:, :, 1], 40, 255, cv2.THRESH_BINARY)
    sat_mask = cv2.morphologyEx(sat_mask, cv2.MORPH_CLOSE, k, iterations=2)
    contours_sat, _ = cv2.findContours(sat_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours_sat:
        a = cv2.contourArea(cnt)
        if min_area <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

    adaptive = cv2.adaptiveThreshold(blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                      cv2.THRESH_BINARY_INV, 15, 4)
    k2 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3))
    adaptive = cv2.morphologyEx(adaptive, cv2.MORPH_CLOSE, k2, iterations=2)
    contours_ad, _ = cv2.findContours(adaptive, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in contours_ad:
        a = cv2.contourArea(cnt)
        if min_area <= a <= max_area:
            candidates.append(cv2.boundingRect(cnt))

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
            "area": int(bw * bh), "label": "visual region",
            "confidence": 0.0, "source": "opencv",
            "thumbnail": frame_to_data_uri(thumb, fmt="JPEG", quality=70),
        })
    return detected


def _dedup_boxes(boxes, min_area, max_area):
    if not boxes:
        return []
    filtered = [(bx, by, bw, bh, bw * bh) for bx, by, bw, bh in boxes
                 if min_area <= bw * bh <= max_area]
    if not filtered:
        return []
    filtered.sort(key=lambda b: b[4], reverse=True)
    keep = []
    used = [False] * len(filtered)
    for i in range(len(filtered)):
        if used[i]:
            continue
        bx, by, bw, bh, ai = filtered[i]
        used[i] = True
        for j in range(i + 1, len(filtered)):
            if used[j]:
                continue
            bx2, by2, bw2, bh2, aj = filtered[j]
            ox = max(0, min(bx + bw, bx2 + bw2) - max(bx, bx2))
            oy = max(0, min(by + bh, by2 + bh2) - max(by, by2))
            inter = ox * oy
            union = ai + aj - inter
            iou = inter / union if union > 0 else 0
            if iou > 0.55:
                used[j] = True
                continue
            contained = inter / aj if aj > 0 else 0
            size_ratio = aj / ai if ai > 0 else 0
            if contained > 0.8 and size_ratio > 0.6:
                used[j] = True
        keep.append((bx, by, bw, bh))
        if len(keep) >= 50:
            break
    return keep


def _deduplicate(items, img_w, img_h):
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


# ═══════════════════════════════════════════════════════════════════════════
# 4. FULL VIDEO SCANNING (objects across all frames)
# ═══════════════════════════════════════════════════════════════════════════

def scan_video_objects(video_path: str | Path, sample_interval: float = 1.0,
                       progress_cb=None) -> list[dict]:
    """
    Scan the entire video for objects/images by sampling frames at
    *sample_interval* seconds apart.  Returns a deduplicated list of
    unique objects with their time ranges.
    """
    info = get_video_info(video_path)
    duration = info["duration"]
    if duration <= 0:
        return []

    timestamps = []
    t = 0.0
    while t < duration:
        timestamps.append(t)
        t += sample_interval
    if timestamps and timestamps[-1] < duration - 0.1:
        timestamps.append(duration - 0.1)

    all_detections = []

    for idx, ts in enumerate(timestamps):
        if progress_cb:
            progress_cb(idx, len(timestamps))

        frame = extract_frame(video_path, ts)
        objects = detect_images(frame)

        for obj in objects:
            obj["timestamp"] = ts
            obj["frameIndex"] = idx
            all_detections.append(obj)

    unique = _track_objects_across_frames(all_detections, info["width"], info["height"])

    unique.sort(key=lambda o: o["area"], reverse=True)
    for i, obj in enumerate(unique):
        obj["index"] = i

    return unique


def _track_objects_across_frames(detections, img_w, img_h):
    """
    Group detections from different frames into unique tracked objects.
    Two detections are the same object if they have similar position,
    size, and label.
    """
    if not detections:
        return []

    tracks: list[dict] = []

    for det in detections:
        matched = False
        for track in tracks:
            if _is_same_object(det, track, img_w, img_h):
                track["timestamps"].append(det["timestamp"])
                track["appearances"] += 1
                if det.get("confidence", 0) > track.get("confidence", 0):
                    track["thumbnail"] = det["thumbnail"]
                    track["confidence"] = det["confidence"]
                matched = True
                break

        if not matched:
            tracks.append({
                "x": det["x"], "y": det["y"],
                "width": det["width"], "height": det["height"],
                "area": det["area"],
                "label": det.get("label", "visual region"),
                "confidence": det.get("confidence", 0),
                "source": det.get("source", "opencv"),
                "thumbnail": det["thumbnail"],
                "timestamps": [det["timestamp"]],
                "appearances": 1,
            })

    results = []
    for track in tracks:
        ts = sorted(track["timestamps"])
        track["startTime"] = ts[0]
        track["endTime"] = ts[-1]
        track["timeRange"] = f"{_fmt_time(ts[0])} – {_fmt_time(ts[-1])}"
        del track["timestamps"]
        results.append(track)

    return results


def _is_same_object(det, track, img_w, img_h):
    if det.get("label", "") != track.get("label", ""):
        if det.get("source") == "yolo" or track.get("source") == "yolo":
            return False

    dx = abs(det["x"] - track["x"])
    dy = abs(det["y"] - track["y"])
    dw = abs(det["width"] - track["width"])
    dh = abs(det["height"] - track["height"])

    pos_thresh = max(img_w, img_h) * 0.05
    size_thresh = max(det["width"], det["height"], track["width"], track["height"]) * 0.3

    return dx < pos_thresh and dy < pos_thresh and dw < size_thresh and dh < size_thresh


def _fmt_time(s):
    m = int(s // 60)
    sec = int(s % 60)
    return f"{m}:{sec:02d}"

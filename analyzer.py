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
# 1. LAYERED BACKGROUND DETECTION
# ═══════════════════════════════════════════════════════════════════════════

def detect_background_layers(frame: Image.Image, num_layers: int = 4) -> dict:
    """
    Segment the frame into depth-based layers:
      - Layer 0: Far background
      - Layer 1: Mid background
      - ...
      - Layer N-1: Foreground
    Each layer gets a mask and a preview image.
    """
    if HAS_MIDAS:
        return _layers_midas(frame, num_layers)
    return _layers_intensity(frame, num_layers)


def _get_midas():
    global _midas_model, _midas_transform
    if _midas_model is None:
        _midas_model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
        _midas_model.eval()
        transforms = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
        _midas_transform = transforms.small_transform
    return _midas_model, _midas_transform


def _compute_depth(frame: Image.Image) -> np.ndarray:
    """Return a normalized depth map (0..255, uint8). Higher = closer."""
    model, transform = _get_midas()
    arr = np.array(frame)
    input_batch = transform(arr)

    with torch.no_grad():
        prediction = model(input_batch)
        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=arr.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()

    depth = prediction.cpu().numpy()
    depth = (depth - depth.min()) / (depth.max() - depth.min() + 1e-8) * 255
    return depth.astype(np.uint8)


def _layers_midas(frame: Image.Image, num_layers: int) -> dict:
    depth = _compute_depth(frame)
    arr = np.array(frame)
    h, w = depth.shape

    thresholds = np.linspace(0, 255, num_layers + 1).astype(int)
    layer_names = _layer_names(num_layers)

    layers = []
    for i in range(num_layers):
        lo, hi = int(thresholds[i]), int(thresholds[i + 1])
        mask = ((depth >= lo) & (depth < hi)).astype(np.uint8) * 255
        if i == num_layers - 1:
            mask = ((depth >= lo) & (depth <= hi)).astype(np.uint8) * 255

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

        layer_rgba = np.dstack([arr, mask])
        layer_img = Image.fromarray(layer_rgba, "RGBA")

        coverage = float(np.count_nonzero(mask) / (h * w))

        layers.append({
            "index": i,
            "name": layer_names[i],
            "preview": frame_to_data_uri(layer_img, fmt="PNG"),
            "mask": frame_to_data_uri(Image.fromarray(mask).convert("RGB"), fmt="PNG"),
            "depthRange": [int(lo), int(hi)],
            "coverage": round(coverage, 3),
        })

    depth_vis = cv2.applyColorMap(depth, cv2.COLORMAP_INFERNO)
    depth_vis_rgb = cv2.cvtColor(depth_vis, cv2.COLOR_BGR2RGB)

    return {
        "layers": layers,
        "depthMap": frame_to_data_uri(Image.fromarray(depth_vis_rgb), fmt="JPEG"),
        "width": w,
        "height": h,
        "method": "MiDaS depth estimation",
        "numLayers": num_layers,
    }


def _layers_intensity(frame: Image.Image, num_layers: int) -> dict:
    """Fallback: approximate depth layers using blur + intensity."""
    arr = np.array(frame)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape

    blurred_heavy = cv2.GaussianBlur(gray, (51, 51), 0)
    detail = cv2.absdiff(gray, blurred_heavy)
    pseudo_depth = cv2.GaussianBlur(detail, (21, 21), 0)
    pseudo_depth = cv2.normalize(pseudo_depth, None, 0, 255, cv2.NORM_MINMAX)

    thresholds = np.linspace(0, 255, num_layers + 1).astype(int)
    layer_names = _layer_names(num_layers)

    layers = []
    for i in range(num_layers):
        lo, hi = int(thresholds[i]), int(thresholds[i + 1])
        mask = ((pseudo_depth >= lo) & (pseudo_depth < hi)).astype(np.uint8) * 255
        if i == num_layers - 1:
            mask = ((pseudo_depth >= lo) & (pseudo_depth <= hi)).astype(np.uint8) * 255

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

        layer_rgba = np.dstack([arr, mask])
        layer_img = Image.fromarray(layer_rgba, "RGBA")
        coverage = float(np.count_nonzero(mask) / (h * w))

        layers.append({
            "index": i,
            "name": layer_names[i],
            "preview": frame_to_data_uri(layer_img, fmt="PNG"),
            "mask": frame_to_data_uri(Image.fromarray(mask).convert("RGB"), fmt="PNG"),
            "depthRange": [int(lo), int(hi)],
            "coverage": round(coverage, 3),
        })

    depth_vis = cv2.applyColorMap(pseudo_depth, cv2.COLORMAP_INFERNO)
    depth_vis_rgb = cv2.cvtColor(depth_vis, cv2.COLOR_BGR2RGB)

    return {
        "layers": layers,
        "depthMap": frame_to_data_uri(Image.fromarray(depth_vis_rgb), fmt="JPEG"),
        "width": w,
        "height": h,
        "method": "Intensity-based (OpenCV fallback)",
        "numLayers": num_layers,
    }


def _layer_names(n: int) -> list[str]:
    if n <= 2:
        return ["Background", "Foreground"]
    if n == 3:
        return ["Far background", "Mid-ground", "Foreground"]
    if n == 4:
        return ["Far background", "Background", "Mid-ground", "Foreground"]
    return [f"Layer {i}" for i in range(n)]


def replace_layer_in_frame(
    frame: Image.Image,
    depth_map: np.ndarray | None,
    layer_idx: int,
    num_layers: int,
    bg_color: tuple[int, int, int] | None = None,
    bg_image: Image.Image | None = None,
) -> Image.Image:
    """Replace a single depth layer in one frame."""
    if depth_map is None:
        arr = np.array(frame)
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        blurred_heavy = cv2.GaussianBlur(gray, (51, 51), 0)
        detail = cv2.absdiff(gray, blurred_heavy)
        depth_map = cv2.GaussianBlur(detail, (21, 21), 0)
        depth_map = cv2.normalize(depth_map, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    thresholds = np.linspace(0, 255, num_layers + 1).astype(int)
    lo, hi = int(thresholds[layer_idx]), int(thresholds[layer_idx + 1])
    mask = ((depth_map >= lo) & (depth_map < hi)).astype(np.uint8) * 255
    if layer_idx == num_layers - 1:
        mask = ((depth_map >= lo) & (depth_map <= hi)).astype(np.uint8) * 255

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    arr = np.array(frame)
    if bg_image is not None:
        replacement = np.array(bg_image.resize(frame.size).convert("RGB"))
    elif bg_color is not None:
        replacement = np.full_like(arr, bg_color)
    else:
        replacement = np.zeros_like(arr)

    mask_3 = np.dstack([mask, mask, mask]) / 255.0
    result = (arr * (1 - mask_3) + replacement * mask_3).astype(np.uint8)
    return Image.fromarray(result)


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

_yolo_model = None
_rembg_session = None


def detect_images(frame: Image.Image) -> list[dict]:
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
            x, y, w, h = int(x1), int(y1), int(x2 - x1), int(y2 - y1)
            if w < 5 or h < 5:
                continue
            thumb = frame.crop((x, y, x + w, y + h))
            thumb.thumbnail((120, 120))
            detected.append({
                "x": x, "y": y, "width": w, "height": h,
                "area": w * h, "label": label,
                "confidence": round(conf, 3), "source": "yolo",
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

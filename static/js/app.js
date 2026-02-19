const App = {
    videoFilename: null,
    videoProbe: null,
    isPlaying: false,

    features: { easyocr: false, rembg: false, yolo: false, midas: false, opencv: true },

    // Background
    backgroundData: null,
    backgroundEdit: { enabled: false, color: "#000000", imageFilename: null, imageUrl: null },

    // Text
    detectedTexts: [],
    textEdits: [],

    // Images (single frame + full scan)
    detectedImages: [],
    imageEdits: [],
    videoScanResults: null,
    videoScanEdits: [],

    // Overlay visibility
    showOverlay: false,

    colors: {
        brightness: 0, contrast: 0, saturation: 0, hueRotate: 0,
        gammaR: 1.0, gammaG: 1.0, gammaB: 1.0,
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.checkStatus();
    },

    async checkStatus() {
        try {
            const res = await fetch("/status");
            const d = await res.json();
            this.features = d.features;
        } catch (e) { console.warn("Status check failed:", e); }
    },

    cacheDOM() {
        this.uploadScreen = document.getElementById("upload-screen");
        this.editorScreen = document.getElementById("editor");
        this.uploadZone = document.getElementById("upload-zone");
        this.fileInput = document.getElementById("file-input");
        this.videoEl = document.getElementById("preview-video");
        this.overlayCanvas = document.getElementById("overlay-canvas");
        this.ctx = this.overlayCanvas.getContext("2d");
        this.playBtn = document.getElementById("play-btn");
        this.timelineSlider = document.getElementById("timeline-slider");
        this.timeDisplay = document.getElementById("time-display");
        this.exportBtn = document.getElementById("export-btn");
        this.modalBackdrop = document.getElementById("export-modal");
        this.modalTitle = document.getElementById("modal-title");
        this.modalText = document.getElementById("modal-text");
        this.modalProgress = document.getElementById("modal-progress");
        this.modalActions = document.getElementById("modal-actions");
    },

    bindEvents() {
        this.uploadZone.addEventListener("click", () => this.fileInput.click());
        this.uploadZone.addEventListener("dragover", e => { e.preventDefault(); this.uploadZone.classList.add("drag-over"); });
        this.uploadZone.addEventListener("dragleave", () => this.uploadZone.classList.remove("drag-over"));
        this.uploadZone.addEventListener("drop", e => {
            e.preventDefault(); this.uploadZone.classList.remove("drag-over");
            if (e.dataTransfer.files.length) this.uploadVideo(e.dataTransfer.files[0]);
        });
        this.fileInput.addEventListener("change", () => {
            if (this.fileInput.files.length) this.uploadVideo(this.fileInput.files[0]);
        });

        this.playBtn.addEventListener("click", () => this.togglePlay());
        this.timelineSlider.addEventListener("input", () => { this.videoEl.currentTime = this.timelineSlider.value; });
        this.videoEl.addEventListener("timeupdate", () => this.onTimeUpdate());
        this.videoEl.addEventListener("loadedmetadata", () => this.onVideoLoaded());
        this.videoEl.addEventListener("play", () => { this.isPlaying = true; this.updatePlayBtn(); this.drawLoop(); });
        this.videoEl.addEventListener("pause", () => { this.isPlaying = false; this.updatePlayBtn(); });

        document.querySelectorAll(".panel-tab").forEach(t =>
            t.addEventListener("click", () => this.switchTab(t.dataset.tab)));

        this.exportBtn.addEventListener("click", () => this.exportVideo());
        document.getElementById("analyze-all-btn").addEventListener("click", () => this.analyzeAll());
        this.bindColorControls();
    },

    // ── Video ─────────────────────────────────────────────────────────
    async uploadVideo(file) {
        const fd = new FormData();
        fd.append("video", file);
        this.toast("Uploading video...", "info");
        try {
            const res = await fetch("/upload/video", { method: "POST", body: fd });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);
            this.videoFilename = d.filename;
            this.videoProbe = d.probe;
            this.videoEl.src = d.url;
            this.uploadScreen.style.display = "none";
            this.editorScreen.classList.add("active");
            this.exportBtn.disabled = false;
            document.getElementById("analyze-all-btn").disabled = false;
            this.renderBgPanel();
            this.renderTextPanel();
            this.renderImagePanel();
            this.toast("Video loaded! Click 'Analyze Frame' to detect elements.", "success");
        } catch (e) { this.toast("Upload failed: " + e.message, "error"); }
    },

    onVideoLoaded() {
        this.timelineSlider.max = this.videoEl.duration;
        this.resizeCanvas();
        window.addEventListener("resize", () => this.resizeCanvas());
    },

    resizeCanvas() {
        const r = this.videoEl.getBoundingClientRect();
        this.overlayCanvas.width = r.width;
        this.overlayCanvas.height = r.height;
        this.drawOverlay();
    },

    onTimeUpdate() {
        this.timelineSlider.value = this.videoEl.currentTime;
        this.timeDisplay.textContent = `${this.fmtTime(this.videoEl.currentTime)} / ${this.fmtTime(this.videoEl.duration)}`;
        if (this.showOverlay) this.drawOverlay();
    },

    togglePlay() { this.videoEl.paused ? this.videoEl.play() : this.videoEl.pause(); },

    updatePlayBtn() {
        this.playBtn.innerHTML = this.isPlaying
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    },

    fmtTime(s) { if (isNaN(s)) return "0:00"; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; },

    // ── Colors ────────────────────────────────────────────────────────
    bindColorControls() {
        ["brightness","contrast","saturation","hueRotate","gammaR","gammaG","gammaB"].forEach(k => {
            const el = document.getElementById(`color-${k}`);
            if (!el) return;
            el.addEventListener("input", () => {
                this.colors[k] = parseFloat(el.value);
                this.updateColorLabels();
                this.applyPreviewFilters();
            });
        });
        document.getElementById("reset-colors")?.addEventListener("click", () => {
            this.colors = { brightness:0, contrast:0, saturation:0, hueRotate:0, gammaR:1, gammaG:1, gammaB:1 };
            Object.keys(this.colors).forEach(k => { const el = document.getElementById(`color-${k}`); if(el) el.value = this.colors[k]; });
            this.updateColorLabels();
            this.applyPreviewFilters();
        });
    },

    updateColorLabels() {
        Object.entries(this.colors).forEach(([k, v]) => {
            const lbl = document.querySelector(`#color-${k}`)?.parentElement?.querySelector("label span");
            if (!lbl) return;
            if (k === "hueRotate") lbl.textContent = v + "°";
            else if (k.startsWith("gamma")) lbl.textContent = v.toFixed(2);
            else lbl.textContent = (v > 0 ? "+" : "") + v;
        });
    },

    applyPreviewFilters() {
        const { brightness: b, contrast: c, saturation: s, hueRotate: h } = this.colors;
        this.videoEl.style.filter = [
            `brightness(${1 + b/100})`, `contrast(${1 + c/100})`,
            `saturate(${1 + s/100})`, `hue-rotate(${h}deg)`,
        ].join(" ");
    },

    // ═══════════════════════════════════════════════════════════════════
    // ANALYZE ALL (sequential)
    // ═══════════════════════════════════════════════════════════════════

    async analyzeAll() {
        const btn = document.getElementById("analyze-all-btn");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Analyzing...';

        try {
            btn.innerHTML = '<span class="spinner"></span> 1/3 Background...';
            await this._analyzeBackgroundSilent();

            btn.innerHTML = '<span class="spinner"></span> 2/3 Text...';
            await this._analyzeTextSilent();

            btn.innerHTML = '<span class="spinner"></span> 3/3 Images...';
            await this._analyzeImagesSilent();

            this.toast("Analysis complete! Check each tab for results.", "success");
        } catch (e) {
            this.toast("Analysis error: " + e.message, "error");
        }

        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Frame`;
    },

    async _analyzeBackgroundSilent() {
        const ts = this.videoEl.currentTime || 0;
        const numLayers = parseInt(document.getElementById("num-layers-select")?.value || "4");
        const res = await fetch("/analyze/background", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts, numLayers }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        this.bgLayers = d;
        this.bgLayerEdits = d.layers.map(l => ({
            index: l.index, name: l.name, enabled: false,
            color: "#000000", imageFilename: null, imageUrl: null,
        }));
        this.renderBgPanel();
    },

    async _analyzeTextSilent() {
        const ts = this.videoEl.currentTime || 0;
        const res = await fetch("/analyze/text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        this.detectedTexts = d.texts || [];
        this.textEdits = this.detectedTexts.map(t => ({
            originalText: t.text, newText: "",
            x: t.x, y: t.y, width: t.width, height: t.height,
            fontSize: Math.max(12, Math.round(t.height * 0.7)),
            fontColor: "white", fillColor: "black", enabled: false,
        }));
        this.renderTextPanel();
    },

    async _analyzeImagesSilent() {
        const ts = this.videoEl.currentTime || 0;
        const res = await fetch("/analyze/images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        this.detectedImages = d.images || [];
        this.imageEdits = this.detectedImages.map(im => ({
            x: im.x, y: im.y, width: im.width, height: im.height,
            label: im.label || "region", confidence: im.confidence || 0,
            source: im.source || "opencv", thumbnail: im.thumbnail,
            replacementFilename: null, replacementUrl: null, enabled: false,
        }));
        this.renderImagePanel();
    },

    // ═══════════════════════════════════════════════════════════════════
    // ANALYZE ALL (runs background, text, images one after another)
    // ═══════════════════════════════════════════════════════════════════

    async analyzeAll() {
        const btn = document.getElementById("analyze-all-btn");
        if (!btn || !this.videoFilename) return;

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Analyzing...';

        try {
            this.toast("Step 1/3: Detecting background layers...", "info");
            await this.analyzeBackground();

            this.toast("Step 2/3: Detecting text...", "info");
            await this.analyzeText();

            this.toast("Step 3/3: Detecting images & objects...", "info");
            await this.analyzeImages();

            this.toast("Analysis complete!", "success");
        } catch (e) {
            this.toast("Analysis error: " + e.message, "error");
        }

        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Frame`;
    },

    // ═══════════════════════════════════════════════════════════════════
    // BACKGROUND LAYERS
    // ═══════════════════════════════════════════════════════════════════

    async analyzeBackground() {
        const btn = document.getElementById("analyze-bg-btn");
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Detecting background...';

        try {
            const ts = this.videoEl.currentTime || 0;
            const res = await fetch("/analyze/background", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);

            this.backgroundData = d;
            this.renderBgPanel();
            this.toast("Background detected! (" + d.method + ")", "success");
        } catch (e) {
            this.toast("Background detection failed: " + e.message, "error");
        }
        btn.disabled = false;
        btn.textContent = "Re-detect Background";
    },

    renderBgPanel() {
        const c = document.getElementById("bg-panel-content");
        const engine = this.features.rembg ? "rembg (AI)" : "GrabCut (OpenCV)";
        const engineClass = this.features.rembg ? "badge-ai" : "badge-fallback";

        let html = `
            <div class="analyze-prompt">
                <p class="section-info">Separates the foreground from the background. You can replace the background with a color or image.</p>
                <div class="engine-badge ${engineClass}">Engine: ${engine}</div>
                <button id="analyze-bg-btn" class="btn btn-analyze btn-full" onclick="App.analyzeBackground()">
                    ${this.backgroundData ? "Re-detect Background" : "Detect Background"}
                </button>
            </div>
        `;

        if (this.backgroundData) {
            html += `
                <div class="divider"></div>
                <div class="detection-preview">
                    <p class="section-label">Detected Foreground</p>
                    <img src="${this.backgroundData.foreground}" class="detection-img">
                </div>
                <div class="divider"></div>
                <div class="control-group">
                    <label class="toggle-label">
                        <input type="checkbox" id="bg-enable" ${this.backgroundEdit.enabled ? "checked" : ""}>
                        <span class="toggle-text">Enable Background Replacement</span>
                    </label>
                </div>
                <div id="bg-options" style="display:${this.backgroundEdit.enabled ? "block" : "none"}">
                    <div class="control-group">
                        <label>Replacement Color</label>
                        <input type="color" id="bg-color" value="${this.backgroundEdit.color}">
                    </div>
                    <div class="divider-sm"></div>
                    <div class="control-group">
                        <label>Or Upload Background Image</label>
                        <button class="btn btn-secondary btn-sm" id="bg-img-upload-btn">Choose Image</button>
                        ${this.backgroundEdit.imageUrl ? `<img src="${this.backgroundEdit.imageUrl}" class="bg-preview-thumb">` : ""}
                    </div>
                </div>
            `;
        }

        c.innerHTML = html;

        document.getElementById("bg-enable")?.addEventListener("change", e => {
            this.backgroundEdit.enabled = e.target.checked;
            document.getElementById("bg-options").style.display = e.target.checked ? "block" : "none";
        });
        document.getElementById("bg-color")?.addEventListener("input", e => {
            this.backgroundEdit.color = e.target.value;
            this.backgroundEdit.imageFilename = null;
            this.backgroundEdit.imageUrl = null;
            this.renderBgPanel();
        });
        document.getElementById("bg-img-upload-btn")?.addEventListener("click", () => this.uploadBgImage());
    },

    async uploadBgImage() {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = async () => {
            if (!input.files.length) return;
            const fd = new FormData();
            fd.append("image", input.files[0]);
            try {
                const res = await fetch("/upload/image", { method: "POST", body: fd });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error);
                this.backgroundEdit.imageFilename = d.filename;
                this.backgroundEdit.imageUrl = d.url;
                this.renderBgPanel();
                this.toast("Background image uploaded!", "success");
            } catch (e) { this.toast(e.message, "error"); }
        };
        input.click();
    },

    // ═══════════════════════════════════════════════════════════════════
    // TEXT
    // ═══════════════════════════════════════════════════════════════════

    async analyzeText() {
        const btn = document.getElementById("analyze-text-btn");
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Detecting text...';
        try {
            const ts = this.videoEl.currentTime || 0;
            const res = await fetch("/analyze/text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);

            this.detectedTexts = d.texts || [];
            this.textEdits = this.detectedTexts.map(t => ({
                originalText: t.text, newText: "",
                x: t.x, y: t.y, width: t.width, height: t.height,
                fontSize: Math.max(12, Math.round(t.height * 0.7)),
                fontColor: "white", fillColor: "black",
                coverMode: "cover",  // "cover" | "transparent" | "remove"
                fontStyle: "bold", fontFamily: "sans-serif",
                enabled: false,
            }));
            this.renderTextPanel();
            this.toast(`Found ${this.detectedTexts.length} text region(s)`, "success");
        } catch (e) { this.toast("Text detection failed: " + e.message, "error"); }
        btn.disabled = false;
        btn.textContent = "Re-analyze Text";
    },

    renderTextPanel() {
        const c = document.getElementById("text-panel-content");
        const hasOcr = this.features.easyocr;
        const engine = hasOcr ? "EasyOCR" : "OpenCV MSER";
        const engineClass = hasOcr ? "badge-ai" : "badge-fallback";

        let html = `
            <div class="analyze-prompt">
                <p class="section-info">Detect text in the current frame.</p>
                <div class="engine-badge ${engineClass}">Engine: ${engine}</div>
                <button id="analyze-text-btn" class="btn btn-analyze btn-full" onclick="App.analyzeText()">Detect Text</button>
            </div>
        `;

        if (this.textEdits.length) {
            // Toggle for showing overlay
            html += `
                <div class="divider"></div>
                <label class="toggle-label overlay-toggle">
                    <input type="checkbox" id="text-overlay-toggle" ${this.showOverlay ? "checked" : ""}>
                    <span class="toggle-text">Show detection boxes on video</span>
                </label>
            `;

            this.textEdits.forEach((te, i) => {
                html += `
                <div class="overlay-item ${te.enabled ? "item-active" : ""}">
                    <div class="overlay-item-header">
                        <label class="toggle-label">
                            <input type="checkbox" data-idx="${i}" class="text-enable-cb" ${te.enabled ? "checked" : ""}>
                            <h4>Text #${i + 1}</h4>
                        </label>
                    </div>
                    <div class="detected-value">"${this.escHtml(te.originalText)}"</div>
                    <div class="detected-pos">${te.x}, ${te.y} &mdash; ${te.width}x${te.height}</div>
                    <div class="edit-fields" style="display:${te.enabled ? "block" : "none"}">
                        <div class="control-group">
                            <label>New Text</label>
                            <input type="text" class="text-input" value="${this.escHtml(te.newText)}"
                                data-idx="${i}" data-key="newText" placeholder="Replacement text...">
                        </div>
                        <div class="inline-fields">
                            <div class="control-group">
                                <label>Font Size</label>
                                <input type="number" class="number-input" value="${te.fontSize}"
                                    data-idx="${i}" data-key="fontSize" min="8" max="200">
                            </div>
                            <div class="control-group">
                                <label>Text Color</label>
                                <input type="color" value="${te.fontColor}" data-idx="${i}" data-key="fontColor">
                            </div>
                        </div>
                        <div class="inline-fields">
                            <div class="control-group">
                                <label>Font Style</label>
                                <select class="text-input" data-idx="${i}" data-key="fontStyle">
                                    <option value="bold" ${te.fontStyle === "bold" ? "selected" : ""}>Bold</option>
                                    <option value="normal" ${te.fontStyle === "normal" ? "selected" : ""}>Normal</option>
                                    <option value="italic" ${te.fontStyle === "italic" ? "selected" : ""}>Italic</option>
                                    <option value="bold italic" ${te.fontStyle === "bold italic" ? "selected" : ""}>Bold Italic</option>
                                </select>
                            </div>
                            <div class="control-group">
                                <label>Font Family</label>
                                <select class="text-input" data-idx="${i}" data-key="fontFamily">
                                    <option value="sans-serif" ${te.fontFamily === "sans-serif" ? "selected" : ""}>Sans-serif</option>
                                    <option value="serif" ${te.fontFamily === "serif" ? "selected" : ""}>Serif</option>
                                    <option value="monospace" ${te.fontFamily === "monospace" ? "selected" : ""}>Monospace</option>
                                    <option value="cursive" ${te.fontFamily === "cursive" ? "selected" : ""}>Cursive</option>
                                    <option value="fantasy" ${te.fontFamily === "fantasy" ? "selected" : ""}>Fantasy</option>
                                </select>
                            </div>
                        </div>
                        <div class="control-group">
                            <label>Old Text Handling</label>
                            <select class="text-input cover-mode-select" data-idx="${i}">
                                <option value="cover" ${te.coverMode === "cover" ? "selected" : ""}>Cover with color</option>
                                <option value="remove" ${te.coverMode === "remove" ? "selected" : ""}>Remove old text, then write new</option>
                                <option value="transparent" ${te.coverMode === "transparent" ? "selected" : ""}>Write over (keep old text visible)</option>
                            </select>
                        </div>
                        <div class="cover-color-row" style="display:${te.coverMode === "cover" ? "block" : "none"}">
                            <div class="control-group">
                                <label>Cover Color</label>
                                <input type="color" value="${te.fillColor}" data-idx="${i}" data-key="fillColor">
                            </div>
                        </div>
                    </div>
                </div>`;
            });
        }

        c.innerHTML = html;

        document.getElementById("text-overlay-toggle")?.addEventListener("change", e => {
            this.showOverlay = e.target.checked;
            this.drawOverlay();
        });
        c.querySelectorAll(".text-enable-cb").forEach(cb => {
            cb.addEventListener("change", e => {
                this.textEdits[+e.target.dataset.idx].enabled = e.target.checked;
                this.renderTextPanel();
                this.drawOverlay();
            });
        });
        c.querySelectorAll("[data-key]").forEach(el => {
            const evType = (el.tagName === "SELECT") ? "change" : "input";
            el.addEventListener(evType, e => {
                const i = +e.target.dataset.idx;
                const k = e.target.dataset.key;
                this.textEdits[i][k] = (e.target.type === "number") ? +e.target.value : e.target.value;
                this.drawOverlay();
            });
        });
        c.querySelectorAll(".cover-mode-select").forEach(sel => {
            sel.addEventListener("change", e => {
                const i = +e.target.dataset.idx;
                this.textEdits[i].coverMode = e.target.value;
                this.renderTextPanel();
                this.drawOverlay();
            });
        });
    },

    // ═══════════════════════════════════════════════════════════════════
    // IMAGES — single frame + full video scan
    // ═══════════════════════════════════════════════════════════════════

    async analyzeImages() {
        const btn = document.getElementById("analyze-img-btn");
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Detecting...';
        try {
            const ts = this.videoEl.currentTime || 0;
            const res = await fetch("/analyze/images", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);

            this.detectedImages = d.images || [];
            this.imageEdits = this.detectedImages.map(im => ({
                x: im.x, y: im.y, width: im.width, height: im.height,
                label: im.label || "region", category: im.category || "",
                confidence: im.confidence || 0,
                source: im.source || "opencv", thumbnail: im.thumbnail,
                replacementFilename: null, replacementUrl: null, enabled: false,
            }));
            this.renderImagePanel();
            this.toast(`Found ${this.detectedImages.length} object(s) in this frame`, "success");
        } catch (e) { this.toast("Image detection failed: " + e.message, "error"); }
        btn.disabled = false;
        btn.textContent = "Re-detect (this frame)";
    },

    async scanFullVideo() {
        const btn = document.getElementById("scan-video-btn");
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Scanning all frames...';

        const interval = parseFloat(document.getElementById("scan-interval")?.value || "1.0");

        try {
            const res = await fetch("/analyze/video-scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoFilename: this.videoFilename, interval }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);

            this.videoScanResults = d.objects || [];
            this.videoScanEdits = this.videoScanResults.map(obj => ({
                ...obj, replacementFilename: null, replacementUrl: null, enabled: false,
            }));
            this.renderImagePanel();
            this.toast(`Full scan: ${d.count} unique objects across video`, "success");
        } catch (e) { this.toast("Video scan failed: " + e.message, "error"); }
        btn.disabled = false;
        btn.textContent = "Re-scan Full Video";
    },

    renderImagePanel() {
        const c = document.getElementById("image-panel-content");
        const hasYolo = this.features.yolo;
        const engine = hasYolo ? "YOLOv8 + OpenCV" : "OpenCV multi-method";
        const engineClass = hasYolo ? "badge-ai" : "badge-fallback";

        let html = `
            <div class="analyze-prompt">
                <div class="engine-badge ${engineClass}">Engine: ${engine}</div>
                <button id="analyze-img-btn" class="btn btn-analyze btn-full" onclick="App.analyzeImages()" style="margin-bottom:8px">
                    Detect in Current Frame
                </button>
                <div class="scan-row">
                    <button id="scan-video-btn" class="btn btn-primary btn-full" onclick="App.scanFullVideo()">
                        Scan Entire Video
                    </button>
                    <select id="scan-interval" class="text-input" style="width:auto;min-width:90px">
                        <option value="0.5">Every 0.5s</option>
                        <option value="1" selected>Every 1s</option>
                        <option value="2">Every 2s</option>
                        <option value="5">Every 5s</option>
                    </select>
                </div>
            </div>
        `;

        // Show overlay toggle
        const hasAnyItems = this.imageEdits.length || this.videoScanEdits.length;
        if (hasAnyItems) {
            html += `
                <div class="divider"></div>
                <label class="toggle-label overlay-toggle">
                    <input type="checkbox" id="img-overlay-toggle" ${this.showOverlay ? "checked" : ""}>
                    <span class="toggle-text">Show detection boxes on video</span>
                </label>
            `;
        }

        // Full video scan results
        if (this.videoScanEdits.length) {
            html += `<div class="divider"></div><p class="section-label">Full Video Scan (${this.videoScanEdits.length} unique objects)</p>`;
            html += this._renderObjectList(this.videoScanEdits, "vscan", true);
        }

        // Single frame results
        if (this.imageEdits.length) {
            html += `<div class="divider"></div><p class="section-label">Current Frame (${this.imageEdits.length} objects)</p>`;
            html += this._renderObjectList(this.imageEdits, "frame", false);
        }

        c.innerHTML = html;

        document.getElementById("img-overlay-toggle")?.addEventListener("change", e => {
            this.showOverlay = e.target.checked;
            this.drawOverlay();
        });

        this._bindObjectListEvents(c, "vscan", this.videoScanEdits);
        this._bindObjectListEvents(c, "frame", this.imageEdits);
    },

    _renderObjectList(edits, prefix, showTime) {
        // Group by category
        const grouped = {};
        edits.forEach((ie, i) => {
            const cat = ie.category || (ie.label === "visual region" ? "visual regions" : "detected");
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ ie, i });
        });

        let html = "";
        const catOrder = ["people", "animals", "food", "vehicles", "sports", "electronics", "furniture", "kitchen", "accessories", "other", "visual regions", "detected"];

        const sortedCats = Object.keys(grouped).sort((a, b) => {
            const ai = catOrder.indexOf(a), bi = catOrder.indexOf(b);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        for (const cat of sortedCats) {
            const items = grouped[cat];
            const catIcon = { people: "👤", animals: "🐾", food: "🍎", vehicles: "🚗", sports: "⚽", electronics: "📱", furniture: "🪑", kitchen: "🍽", accessories: "👜", other: "📦" }[cat] || "🔍";
            html += `<div class="category-header">${catIcon} ${cat.charAt(0).toUpperCase() + cat.slice(1)} <span class="cat-count">${items.length}</span></div>`;

            for (const { ie, i } of items) {
                const labelBadge = ie.label && ie.label !== "visual region"
                    ? `<span class="obj-label">${ie.label}</span>`
                    : `<span class="obj-label obj-label-region">region</span>`;
                const confText = ie.confidence > 0 ? `<span class="conf-text">${Math.round(ie.confidence * 100)}%</span>` : "";
                const timeText = showTime && ie.timeRange ? `<div class="time-badge">${ie.timeRange} (${ie.appearances}x)</div>` : "";

                html += `
                <div class="overlay-item ${ie.enabled ? "item-active" : ""}">
                    <div class="overlay-item-header">
                        <label class="toggle-label">
                            <input type="checkbox" data-prefix="${prefix}" data-idx="${i}" class="obj-enable-cb" ${ie.enabled ? "checked" : ""}>
                            <h4>${labelBadge} ${confText}</h4>
                        </label>
                    </div>
                    <div class="thumb-row">
                        <img src="${ie.thumbnail}" class="region-thumb">
                        <div class="detected-pos">${ie.x}, ${ie.y} &mdash; ${ie.width}x${ie.height}${timeText}</div>
                    </div>
                    <div class="edit-fields" style="display:${ie.enabled ? "block" : "none"}">
                        <div class="control-group">
                            <label>Replacement Image</label>
                            <button class="btn btn-secondary btn-sm obj-replace-btn" data-prefix="${prefix}" data-idx="${i}">Upload Replacement</button>
                            ${ie.replacementUrl ? `<img src="${ie.replacementUrl}" class="bg-preview-thumb">` : ""}
                        </div>
                    </div>
                </div>`;
            }
        }
        return html;
    },

    _bindObjectListEvents(container, prefix, edits) {
        container.querySelectorAll(`.obj-enable-cb[data-prefix="${prefix}"]`).forEach(cb => {
            cb.addEventListener("change", e => {
                edits[+e.target.dataset.idx].enabled = e.target.checked;
                this.renderImagePanel();
                this.drawOverlay();
            });
        });
        container.querySelectorAll(`.obj-replace-btn[data-prefix="${prefix}"]`).forEach(btn => {
            btn.addEventListener("click", e => {
                const idx = +e.target.dataset.idx;
                this._uploadReplacementFor(edits, idx);
            });
        });
    },

    async _uploadReplacementFor(edits, idx) {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = async () => {
            if (!input.files.length) return;
            const fd = new FormData();
            fd.append("image", input.files[0]);
            try {
                const res = await fetch("/upload/image", { method: "POST", body: fd });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error);
                edits[idx].replacementFilename = d.filename;
                edits[idx].replacementUrl = d.url;
                this.renderImagePanel();
                this.toast("Replacement image uploaded!", "success");
            } catch (e) { this.toast(e.message, "error"); }
        };
        input.click();
    },

    // ═══════════════════════════════════════════════════════════════════
    // OVERLAY — only drawn when toggled on, only for enabled items
    // ═══════════════════════════════════════════════════════════════════

    drawLoop() {
        if (!this.isPlaying) return;
        if (this.showOverlay) this.drawOverlay();
        requestAnimationFrame(() => this.drawLoop());
    },

    drawOverlay() {
        const { width: cw, height: ch } = this.overlayCanvas;
        if (!cw || !ch) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, cw, ch);

        if (!this.showOverlay) return;

        const vw = this.videoProbe?.width || this.videoEl.videoWidth || 1920;
        const vh = this.videoProbe?.height || this.videoEl.videoHeight || 1080;
        const sx = cw / vw, sy = ch / vh;

        this.textEdits.forEach(te => {
            if (!te.enabled) return;
            const x = te.x * sx, y = te.y * sy, w = te.width * sx, h = te.height * sy;
            ctx.strokeStyle = "#6c5ce7";
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);

            if (te.coverMode === "cover") {
                ctx.fillStyle = te.fillColor;
                ctx.fillRect(x, y, w, h);
            } else if (te.coverMode === "remove") {
                ctx.fillStyle = "rgba(0,0,0,0.3)";
                ctx.fillRect(x, y, w, h);
                ctx.fillStyle = "rgba(255,255,255,0.5)";
                ctx.font = "10px sans-serif";
                ctx.fillText("[erased]", x + 4, y + 12);
            }

            if (te.newText) {
                const fStyle = te.fontStyle || "bold";
                const fFamily = te.fontFamily || "sans-serif";
                ctx.font = `${fStyle} ${Math.round(te.fontSize * sy)}px ${fFamily}`;
                ctx.fillStyle = te.fontColor;
                ctx.fillText(te.newText, x + 4, y + h - 4 * sy);
            }
        });

        // Only draw enabled image edits
        const allImgEdits = [...this.imageEdits, ...this.videoScanEdits];
        allImgEdits.forEach(ie => {
            if (!ie.enabled) return;
            const x = ie.x * sx, y = ie.y * sy, w = ie.width * sx, h = ie.height * sy;
            ctx.strokeStyle = ie.source === "yolo" ? "#fdcb6e" : "#00b894";
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
            if (ie.label && ie.label !== "visual region") {
                ctx.fillStyle = "rgba(0,0,0,0.6)";
                const lbl = ie.label;
                const tw = ctx.measureText(lbl).width;
                ctx.fillRect(x, y - 16, tw + 8, 16);
                ctx.fillStyle = "#fff";
                ctx.font = "bold 11px sans-serif";
                ctx.fillText(lbl, x + 4, y - 4);
            }
        });
    },

    // ═══════════════════════════════════════════════════════════════════
    // EXPORT
    // ═══════════════════════════════════════════════════════════════════

    async exportVideo() {
        const activeTexts = this.textEdits.filter(t => t.enabled && t.newText.trim());
        const allImgEdits = [...this.imageEdits, ...this.videoScanEdits];
        const activeImgs = allImgEdits.filter(i => i.enabled && i.replacementFilename);
        const bgActive = this.backgroundEdit.enabled;
        const hasColorChange = Object.entries(this.colors).some(([k, v]) => k.startsWith("gamma") ? v !== 1 : v !== 0);

        if (!bgActive && !activeTexts.length && !activeImgs.length && !hasColorChange) {
            this.toast("Nothing to change. Adjust some settings first.", "info");
            return;
        }

        this.showModal("Exporting Video",
            bgActive ? "Replacing background frame-by-frame..." : "Rendering...",
            true);

        const payload = {
            videoFilename: this.videoFilename,
            colors: { ...this.colors },
            textEdits: activeTexts,
            imageEdits: activeImgs,
            backgroundEdit: bgActive ? this.backgroundEdit : null,
        };

        try {
            let p = 0;
            const iv = setInterval(() => { p = Math.min(p + Math.random() * 5, 90); this.modalProgress.style.width = p + "%"; }, 600);
            const res = await fetch("/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            clearInterval(iv);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);
            this.modalProgress.style.width = "100%";
            this.showModal("Export Complete!", "Your video is ready.", false,
                `<a href="${d.url}" download class="btn btn-primary">Download Video</a>
                 <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>`);
            this.toast("Video exported!", "success");
        } catch (e) {
            this.showModal("Export Failed", e.message, false,
                `<button class="btn btn-secondary" onclick="App.closeModal()">Close</button>`);
        }
    },

    showModal(title, text, prog, actions) {
        this.modalBackdrop.classList.add("active");
        this.modalTitle.textContent = title;
        this.modalText.textContent = text;
        this.modalProgress.parentElement.style.display = prog ? "block" : "none";
        if (prog) this.modalProgress.style.width = "0%";
        this.modalActions.innerHTML = actions || "";
    },
    closeModal() { this.modalBackdrop.classList.remove("active"); },

    switchTab(name) {
        document.querySelectorAll(".panel-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        document.querySelectorAll(".panel-section").forEach(s => s.classList.toggle("active", s.id === `section-${name}`));
    },

    toast(msg, type = "info") {
        const c = document.querySelector(".toast-container");
        const t = document.createElement("div");
        t.className = `toast ${type}`;
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(() => t.remove(), 4500);
    },

    escHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML.replace(/"/g, "&quot;");
    },
};

document.addEventListener("DOMContentLoaded", () => App.init());

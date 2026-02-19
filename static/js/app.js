const App = {
    videoFilename: null,
    videoProbe: null,
    isPlaying: false,
    analyzed: false,

    detectedTexts: [],
    detectedImages: [],
    backgroundData: null,

    textEdits: [],
    imageEdits: [],
    backgroundEdit: { enabled: false, color: "#000000", imageFilename: null, imageUrl: null },

    colors: {
        brightness: 0, contrast: 0, saturation: 0, hueRotate: 0,
        gammaR: 1.0, gammaG: 1.0, gammaB: 1.0,
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
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
        this.analyzeBtn = document.getElementById("analyze-btn");
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

        this.analyzeBtn.addEventListener("click", () => this.analyzeFrame());
        this.exportBtn.addEventListener("click", () => this.exportVideo());

        this.bindColorControls();
    },

    // ── Video upload ──────────────────────────────────────────────────
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
            this.analyzeBtn.disabled = false;
            this.toast("Video loaded!", "success");
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
        this.drawOverlay();
    },

    togglePlay() { this.videoEl.paused ? this.videoEl.play() : this.videoEl.pause(); },

    updatePlayBtn() {
        this.playBtn.innerHTML = this.isPlaying
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    },

    fmtTime(s) { if (isNaN(s)) return "0:00"; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`; },

    // ── Color controls ────────────────────────────────────────────────
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

    // ── Analyze frame ─────────────────────────────────────────────────
    async analyzeFrame() {
        const ts = this.videoEl.currentTime || 0;
        const body = JSON.stringify({ videoFilename: this.videoFilename, timestamp: ts });
        const headers = { "Content-Type": "application/json" };

        this.analyzeBtn.disabled = true;
        this.analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';

        try {
            const [bgRes, txtRes, imgRes] = await Promise.all([
                fetch("/analyze/background", { method: "POST", body, headers }),
                fetch("/analyze/text", { method: "POST", body, headers }),
                fetch("/analyze/images", { method: "POST", body, headers }),
            ]);

            const bgData = await bgRes.json();
            const txtData = await txtRes.json();
            const imgData = await imgRes.json();

            this.backgroundData = bgData;
            this.detectedTexts = txtData.texts || [];
            this.detectedImages = imgData.images || [];

            this.textEdits = this.detectedTexts.map(t => ({
                originalText: t.text,
                newText: "",
                x: t.x, y: t.y, width: t.width, height: t.height,
                fontSize: Math.max(12, Math.round(t.height * 0.7)),
                fontColor: "white",
                fillColor: "black",
                enabled: false,
            }));

            this.imageEdits = this.detectedImages.map(im => ({
                x: im.x, y: im.y, width: im.width, height: im.height,
                thumbnail: im.thumbnail,
                replacementFilename: null,
                replacementUrl: null,
                enabled: false,
            }));

            this.analyzed = true;
            this.renderBackgroundPanel();
            this.renderTextPanel();
            this.renderImagePanel();
            this.drawOverlay();

            this.toast(`Found: ${this.detectedTexts.length} text regions, ${this.detectedImages.length} image regions`, "success");
        } catch (e) {
            this.toast("Analysis failed: " + e.message, "error");
        }

        this.analyzeBtn.disabled = false;
        this.analyzeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze Frame`;
    },

    // ── Background panel ──────────────────────────────────────────────
    renderBackgroundPanel() {
        const c = document.getElementById("bg-panel-content");
        if (!this.backgroundData) {
            c.innerHTML = '<p class="empty-msg">Click "Analyze Frame" to detect the background.</p>';
            return;
        }
        c.innerHTML = `
            <div class="detection-preview">
                <p class="section-label">Detected Foreground</p>
                <img src="${this.backgroundData.foreground}" class="detection-img">
            </div>
            <div class="divider"></div>
            <div class="control-group">
                <label><input type="checkbox" id="bg-enable" ${this.backgroundEdit.enabled ? "checked" : ""}>
                Enable Background Replacement</label>
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

        document.getElementById("bg-enable").addEventListener("change", e => {
            this.backgroundEdit.enabled = e.target.checked;
            document.getElementById("bg-options").style.display = e.target.checked ? "block" : "none";
        });
        document.getElementById("bg-color").addEventListener("input", e => {
            this.backgroundEdit.color = e.target.value;
            this.backgroundEdit.imageFilename = null;
            this.backgroundEdit.imageUrl = null;
            this.renderBackgroundPanel();
        });
        document.getElementById("bg-img-upload-btn").addEventListener("click", () => this.uploadBgImage());
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
                this.renderBackgroundPanel();
                this.toast("Background image uploaded!", "success");
            } catch (e) { this.toast(e.message, "error"); }
        };
        input.click();
    },

    // ── Text panel ────────────────────────────────────────────────────
    renderTextPanel() {
        const c = document.getElementById("text-panel-content");
        if (!this.analyzed) {
            c.innerHTML = '<p class="empty-msg">Click "Analyze Frame" to detect text in the video.</p>';
            return;
        }
        if (!this.detectedTexts.length) {
            c.innerHTML = '<p class="empty-msg">No text detected in this frame. Try a different timestamp.</p>';
            return;
        }

        c.innerHTML = this.textEdits.map((te, i) => `
            <div class="overlay-item ${te.enabled ? "item-active" : ""}">
                <div class="overlay-item-header">
                    <label class="toggle-label">
                        <input type="checkbox" data-idx="${i}" class="text-enable-cb" ${te.enabled ? "checked" : ""}>
                        <h4>Text #${i + 1}</h4>
                    </label>
                </div>
                <div class="detected-value">Detected: <strong>"${this.escHtml(te.originalText)}"</strong></div>
                <div class="detected-pos">Position: ${te.x}, ${te.y} &mdash; Size: ${te.width} x ${te.height}</div>
                <div class="edit-fields" style="display:${te.enabled ? "block" : "none"}" id="text-fields-${i}">
                    <div class="control-group">
                        <label>New Text</label>
                        <input type="text" class="text-input" value="${this.escHtml(te.newText)}"
                            data-idx="${i}" data-key="newText" placeholder="Type replacement text...">
                    </div>
                    <div class="inline-fields">
                        <div class="control-group">
                            <label>Font Size</label>
                            <input type="number" class="number-input" value="${te.fontSize}"
                                data-idx="${i}" data-key="fontSize" min="8" max="200">
                        </div>
                        <div class="control-group">
                            <label>Text Color</label>
                            <input type="color" value="${te.fontColor}"
                                data-idx="${i}" data-key="fontColor">
                        </div>
                    </div>
                    <div class="control-group">
                        <label>Cover Color</label>
                        <input type="color" value="${te.fillColor}"
                            data-idx="${i}" data-key="fillColor">
                    </div>
                </div>
            </div>
        `).join("");

        c.querySelectorAll(".text-enable-cb").forEach(cb => {
            cb.addEventListener("change", e => {
                const i = +e.target.dataset.idx;
                this.textEdits[i].enabled = e.target.checked;
                this.renderTextPanel();
                this.drawOverlay();
            });
        });

        c.querySelectorAll("[data-key]").forEach(el => {
            el.addEventListener("input", e => {
                const i = +e.target.dataset.idx;
                const k = e.target.dataset.key;
                const v = (e.target.type === "number") ? +e.target.value : e.target.value;
                this.textEdits[i][k] = v;
                this.drawOverlay();
            });
        });
    },

    // ── Image panel ───────────────────────────────────────────────────
    renderImagePanel() {
        const c = document.getElementById("image-panel-content");
        if (!this.analyzed) {
            c.innerHTML = '<p class="empty-msg">Click "Analyze Frame" to detect images/objects in the video.</p>';
            return;
        }
        if (!this.detectedImages.length) {
            c.innerHTML = '<p class="empty-msg">No distinct image regions detected. Try a different timestamp.</p>';
            return;
        }

        c.innerHTML = this.imageEdits.map((ie, i) => `
            <div class="overlay-item ${ie.enabled ? "item-active" : ""}">
                <div class="overlay-item-header">
                    <label class="toggle-label">
                        <input type="checkbox" data-idx="${i}" class="img-enable-cb" ${ie.enabled ? "checked" : ""}>
                        <h4>Region #${i + 1}</h4>
                    </label>
                </div>
                <div class="thumb-row">
                    <img src="${ie.thumbnail}" class="region-thumb">
                    <div class="detected-pos">Position: ${ie.x}, ${ie.y}<br>Size: ${ie.width} x ${ie.height}</div>
                </div>
                <div class="edit-fields" style="display:${ie.enabled ? "block" : "none"}" id="img-fields-${i}">
                    <div class="control-group">
                        <label>Replacement Image</label>
                        <button class="btn btn-secondary btn-sm img-replace-btn" data-idx="${i}">Upload Replacement</button>
                        ${ie.replacementUrl ? `<img src="${ie.replacementUrl}" class="bg-preview-thumb">` : ""}
                    </div>
                </div>
            </div>
        `).join("");

        c.querySelectorAll(".img-enable-cb").forEach(cb => {
            cb.addEventListener("change", e => {
                const i = +e.target.dataset.idx;
                this.imageEdits[i].enabled = e.target.checked;
                this.renderImagePanel();
                this.drawOverlay();
            });
        });

        c.querySelectorAll(".img-replace-btn").forEach(btn => {
            btn.addEventListener("click", e => this.uploadReplacementImage(+e.target.dataset.idx));
        });
    },

    async uploadReplacementImage(idx) {
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
                this.imageEdits[idx].replacementFilename = d.filename;
                this.imageEdits[idx].replacementUrl = d.url;
                this.renderImagePanel();
                this.toast("Replacement image uploaded!", "success");
            } catch (e) { this.toast(e.message, "error"); }
        };
        input.click();
    },

    // ── Overlay drawing ───────────────────────────────────────────────
    drawLoop() {
        if (!this.isPlaying) return;
        this.drawOverlay();
        requestAnimationFrame(() => this.drawLoop());
    },

    drawOverlay() {
        const { width: cw, height: ch } = this.overlayCanvas;
        if (!cw || !ch) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, cw, ch);

        if (!this.analyzed) return;

        const vw = this.videoProbe?.width || this.videoEl.videoWidth || 1920;
        const vh = this.videoProbe?.height || this.videoEl.videoHeight || 1080;
        const sx = cw / vw, sy = ch / vh;

        this.textEdits.forEach((te, i) => {
            const x = te.x * sx, y = te.y * sy, w = te.width * sx, h = te.height * sy;
            if (te.enabled) {
                ctx.strokeStyle = "#6c5ce7";
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 3]);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);

                if (te.newText) {
                    ctx.fillStyle = te.fillColor;
                    ctx.fillRect(x, y, w, h);
                    ctx.font = `bold ${Math.round(te.fontSize * sy)}px sans-serif`;
                    ctx.fillStyle = te.fontColor;
                    ctx.fillText(te.newText, x + 4 * sx, y + h - 4 * sy);
                }
            } else {
                ctx.strokeStyle = "rgba(108,92,231,0.4)";
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);

                ctx.fillStyle = "rgba(108,92,231,0.6)";
                ctx.font = "11px sans-serif";
                ctx.fillText(`"${te.originalText}"`, x + 2, y - 4);
            }
        });

        this.imageEdits.forEach((ie, i) => {
            const x = ie.x * sx, y = ie.y * sy, w = ie.width * sx, h = ie.height * sy;
            if (ie.enabled) {
                ctx.strokeStyle = "#00b894";
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 3]);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);
            } else {
                ctx.strokeStyle = "rgba(0,184,148,0.4)";
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(x, y, w, h);
                ctx.setLineDash([]);
            }
        });
    },

    // ── Export ─────────────────────────────────────────────────────────
    async exportVideo() {
        const activeTexts = this.textEdits.filter(t => t.enabled && t.newText.trim());
        const activeImgs = this.imageEdits.filter(i => i.enabled && i.replacementFilename);
        const bgActive = this.backgroundEdit.enabled;

        if (!bgActive && !activeTexts.length && !activeImgs.length &&
            !Object.values(this.colors).some(v => v !== 0 && v !== 1)) {
            this.toast("Nothing to change — adjust some settings first.", "info");
            return;
        }

        this.showModal("Exporting Video",
            bgActive ? "Replacing background frame-by-frame. This may take several minutes..." : "Rendering your modified video...",
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

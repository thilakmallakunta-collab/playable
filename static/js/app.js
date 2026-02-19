const App = {
    video: null,
    videoFilename: null,
    videoProbe: null,
    isPlaying: false,

    colors: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        hueRotate: 0,
        gammaR: 1.0,
        gammaG: 1.0,
        gammaB: 1.0,
    },

    texts: [],
    images: [],

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
        this.panelContent = document.getElementById("panel-content");
        this.modalBackdrop = document.getElementById("export-modal");
        this.modalTitle = document.getElementById("modal-title");
        this.modalText = document.getElementById("modal-text");
        this.modalProgress = document.getElementById("modal-progress");
        this.modalActions = document.getElementById("modal-actions");
    },

    bindEvents() {
        this.uploadZone.addEventListener("click", () => this.fileInput.click());
        this.uploadZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            this.uploadZone.classList.add("drag-over");
        });
        this.uploadZone.addEventListener("dragleave", () => {
            this.uploadZone.classList.remove("drag-over");
        });
        this.uploadZone.addEventListener("drop", (e) => {
            e.preventDefault();
            this.uploadZone.classList.remove("drag-over");
            if (e.dataTransfer.files.length) this.uploadVideo(e.dataTransfer.files[0]);
        });
        this.fileInput.addEventListener("change", () => {
            if (this.fileInput.files.length) this.uploadVideo(this.fileInput.files[0]);
        });

        this.playBtn.addEventListener("click", () => this.togglePlay());
        this.timelineSlider.addEventListener("input", () => {
            this.videoEl.currentTime = this.timelineSlider.value;
        });
        this.videoEl.addEventListener("timeupdate", () => this.onTimeUpdate());
        this.videoEl.addEventListener("loadedmetadata", () => this.onVideoLoaded());
        this.videoEl.addEventListener("play", () => { this.isPlaying = true; this.updatePlayBtn(); this.drawOverlayLoop(); });
        this.videoEl.addEventListener("pause", () => { this.isPlaying = false; this.updatePlayBtn(); });

        document.querySelectorAll(".panel-tab").forEach((tab) => {
            tab.addEventListener("click", () => this.switchTab(tab.dataset.tab));
        });

        this.exportBtn.addEventListener("click", () => this.exportVideo());

        this.bindColorControls();
    },

    bindColorControls() {
        const sliders = {
            brightness: { prop: "brightness", range: [-100, 100] },
            contrast: { prop: "contrast", range: [-100, 100] },
            saturation: { prop: "saturation", range: [-100, 100] },
            hueRotate: { prop: "hueRotate", range: [0, 360] },
        };

        Object.entries(sliders).forEach(([id, cfg]) => {
            const slider = document.getElementById(`color-${id}`);
            if (!slider) return;
            slider.addEventListener("input", () => {
                this.colors[cfg.prop] = parseFloat(slider.value);
                this.updateColorValueLabels();
                this.applyPreviewFilters();
            });
        });

        ["gammaR", "gammaG", "gammaB"].forEach((key) => {
            const slider = document.getElementById(`color-${key}`);
            if (!slider) return;
            slider.addEventListener("input", () => {
                this.colors[key] = parseFloat(slider.value);
                this.updateColorValueLabels();
                this.applyPreviewFilters();
            });
        });

        const resetBtn = document.getElementById("reset-colors");
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                this.colors = { brightness: 0, contrast: 0, saturation: 0, hueRotate: 0, gammaR: 1.0, gammaG: 1.0, gammaB: 1.0 };
                Object.keys(this.colors).forEach((k) => {
                    const el = document.getElementById(`color-${k}`);
                    if (el) el.value = this.colors[k];
                });
                this.updateColorValueLabels();
                this.applyPreviewFilters();
            });
        }
    },

    updateColorValueLabels() {
        Object.entries(this.colors).forEach(([key, val]) => {
            const label = document.querySelector(`#color-${key}`)?.parentElement?.querySelector("label span");
            if (label) {
                if (key === "hueRotate") label.textContent = `${val}°`;
                else if (key.startsWith("gamma")) label.textContent = val.toFixed(2);
                else label.textContent = `${val > 0 ? "+" : ""}${val}`;
            }
        });
    },

    async uploadVideo(file) {
        const formData = new FormData();
        formData.append("video", file);

        this.toast("Uploading video...", "info");

        try {
            const res = await fetch("/upload/video", { method: "POST", body: formData });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error);

            this.videoFilename = data.filename;
            this.videoProbe = data.probe;
            this.videoEl.src = data.url;
            this.uploadScreen.style.display = "none";
            this.editorScreen.classList.add("active");
            this.exportBtn.disabled = false;
            this.toast("Video loaded successfully!", "success");
        } catch (err) {
            this.toast(`Upload failed: ${err.message}`, "error");
        }
    },

    onVideoLoaded() {
        this.timelineSlider.max = this.videoEl.duration;
        this.timelineSlider.value = 0;
        this.resizeCanvas();
        window.addEventListener("resize", () => this.resizeCanvas());
        this.drawOverlay();
    },

    resizeCanvas() {
        const rect = this.videoEl.getBoundingClientRect();
        this.overlayCanvas.width = rect.width;
        this.overlayCanvas.height = rect.height;
        this.drawOverlay();
    },

    onTimeUpdate() {
        this.timelineSlider.value = this.videoEl.currentTime;
        const cur = this.formatTime(this.videoEl.currentTime);
        const dur = this.formatTime(this.videoEl.duration);
        this.timeDisplay.textContent = `${cur} / ${dur}`;
        this.drawOverlay();
    },

    togglePlay() {
        if (this.videoEl.paused) this.videoEl.play();
        else this.videoEl.pause();
    },

    updatePlayBtn() {
        this.playBtn.innerHTML = this.isPlaying
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    },

    formatTime(sec) {
        if (isNaN(sec)) return "0:00";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    },

    applyPreviewFilters() {
        const { brightness, contrast, saturation, hueRotate } = this.colors;
        const filters = [
            `brightness(${1 + brightness / 100})`,
            `contrast(${1 + contrast / 100})`,
            `saturate(${1 + saturation / 100})`,
            `hue-rotate(${hueRotate}deg)`,
        ].join(" ");
        this.videoEl.style.filter = filters;
    },

    // Overlay drawing on canvas (text + images preview)
    drawOverlayLoop() {
        if (!this.isPlaying) return;
        this.drawOverlay();
        requestAnimationFrame(() => this.drawOverlayLoop());
    },

    drawOverlay() {
        const canvas = this.overlayCanvas;
        const ctx = this.ctx;
        if (!canvas.width || !canvas.height) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const vw = this.videoProbe?.width || this.videoEl.videoWidth || 1920;
        const vh = this.videoProbe?.height || this.videoEl.videoHeight || 1080;
        const scaleX = canvas.width / vw;
        const scaleY = canvas.height / vh;
        const t = this.videoEl.currentTime;

        this.images.forEach((img) => {
            if (t < img.startTime) return;
            if (img.endTime > 0 && t > img.endTime) return;
            if (!img._imgEl || !img._imgEl.complete) return;

            ctx.globalAlpha = img.opacity ?? 1;
            ctx.drawImage(img._imgEl, img.x * scaleX, img.y * scaleY, img.width * scaleX, img.height * scaleY);
            ctx.globalAlpha = 1;
        });

        this.texts.forEach((txt) => {
            if (t < txt.startTime) return;
            if (txt.endTime > 0 && t > txt.endTime) return;

            const fontSize = Math.round(txt.fontSize * scaleY);
            ctx.font = `${txt.fontWeight || "bold"} ${fontSize}px ${txt.fontFamily || "sans-serif"}`;
            ctx.fillStyle = txt.color || "white";
            ctx.shadowColor = txt.shadowColor || "rgba(0,0,0,0.7)";
            ctx.shadowOffsetX = (txt.shadowX || 2) * scaleX;
            ctx.shadowOffsetY = (txt.shadowY || 2) * scaleY;
            ctx.shadowBlur = 4 * scaleX;

            if (txt.borderW > 0) {
                ctx.strokeStyle = txt.borderColor || "black";
                ctx.lineWidth = txt.borderW * scaleX;
                ctx.strokeText(txt.text, txt.x * scaleX, (txt.y + txt.fontSize) * scaleY);
            }

            ctx.fillText(txt.text, txt.x * scaleX, (txt.y + txt.fontSize) * scaleY);
            ctx.shadowColor = "transparent";
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.shadowBlur = 0;
        });
    },

    switchTab(tabName) {
        document.querySelectorAll(".panel-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
        document.querySelectorAll(".panel-section").forEach((s) => s.classList.toggle("active", s.id === `section-${tabName}`));
    },

    // --- TEXT OVERLAY MANAGEMENT ---
    addText() {
        const vw = this.videoProbe?.width || 1920;
        const id = Date.now();
        this.texts.push({
            id,
            text: "Your Text",
            fontSize: 48,
            color: "#ffffff",
            fontFamily: "sans-serif",
            fontWeight: "bold",
            x: Math.round(vw * 0.05),
            y: 80,
            startTime: 0,
            endTime: -1,
            shadowColor: "#000000",
            shadowX: 2,
            shadowY: 2,
            borderW: 0,
            borderColor: "#000000",
        });
        this.renderTextList();
        this.drawOverlay();
    },

    removeText(id) {
        this.texts = this.texts.filter((t) => t.id !== id);
        this.renderTextList();
        this.drawOverlay();
    },

    updateText(id, key, value) {
        const txt = this.texts.find((t) => t.id === id);
        if (txt) {
            txt[key] = value;
            this.drawOverlay();
        }
    },

    renderTextList() {
        const container = document.getElementById("text-list");
        container.innerHTML = "";

        this.texts.forEach((txt, idx) => {
            const div = document.createElement("div");
            div.className = "overlay-item";
            div.innerHTML = `
                <div class="overlay-item-header">
                    <h4>Text #${idx + 1}</h4>
                    <button class="btn btn-danger btn-sm" onclick="App.removeText(${txt.id})">Remove</button>
                </div>
                <div class="control-group">
                    <label>Content</label>
                    <input type="text" class="text-input" value="${this.escapeHtml(txt.text)}"
                        oninput="App.updateText(${txt.id}, 'text', this.value)">
                </div>
                <div class="inline-fields">
                    <div class="control-group">
                        <label>Size <span>${txt.fontSize}px</span></label>
                        <input type="range" class="slider-input" min="12" max="200" value="${txt.fontSize}"
                            oninput="App.updateText(${txt.id}, 'fontSize', +this.value); this.parentElement.querySelector('label span').textContent=this.value+'px'">
                    </div>
                    <div class="control-group">
                        <label>Color</label>
                        <input type="color" value="${txt.color}"
                            oninput="App.updateText(${txt.id}, 'color', this.value)">
                    </div>
                </div>
                <div class="inline-fields">
                    <div class="control-group">
                        <label>X</label>
                        <input type="number" class="number-input" value="${txt.x}"
                            oninput="App.updateText(${txt.id}, 'x', +this.value)">
                    </div>
                    <div class="control-group">
                        <label>Y</label>
                        <input type="number" class="number-input" value="${txt.y}"
                            oninput="App.updateText(${txt.id}, 'y', +this.value)">
                    </div>
                </div>
                <div class="inline-fields">
                    <div class="control-group">
                        <label>Start (s)</label>
                        <input type="number" class="number-input" value="${txt.startTime}" min="0" step="0.1"
                            oninput="App.updateText(${txt.id}, 'startTime', +this.value)">
                    </div>
                    <div class="control-group">
                        <label>End (s) <span style="font-size:0.65rem;color:var(--text-muted)">-1=forever</span></label>
                        <input type="number" class="number-input" value="${txt.endTime}" min="-1" step="0.1"
                            oninput="App.updateText(${txt.id}, 'endTime', +this.value)">
                    </div>
                </div>
                <div class="inline-fields" style="margin-top:8px">
                    <div class="control-group">
                        <label>Shadow color</label>
                        <input type="color" value="${txt.shadowColor}"
                            oninput="App.updateText(${txt.id}, 'shadowColor', this.value)">
                    </div>
                    <div class="control-group">
                        <label>Outline width</label>
                        <input type="number" class="number-input" value="${txt.borderW}" min="0" max="10"
                            oninput="App.updateText(${txt.id}, 'borderW', +this.value)">
                    </div>
                </div>
                <div class="control-group" style="margin-top:8px">
                    <label>Font</label>
                    <select class="text-input" onchange="App.updateText(${txt.id}, 'fontFamily', this.value)">
                        <option value="sans-serif" ${txt.fontFamily === "sans-serif" ? "selected" : ""}>Sans-serif</option>
                        <option value="serif" ${txt.fontFamily === "serif" ? "selected" : ""}>Serif</option>
                        <option value="monospace" ${txt.fontFamily === "monospace" ? "selected" : ""}>Monospace</option>
                        <option value="cursive" ${txt.fontFamily === "cursive" ? "selected" : ""}>Cursive</option>
                    </select>
                </div>
            `;
            container.appendChild(div);
        });
    },

    // --- IMAGE OVERLAY MANAGEMENT ---
    async addImage() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
            if (!input.files.length) return;
            const file = input.files[0];
            const formData = new FormData();
            formData.append("image", file);

            try {
                const res = await fetch("/upload/image", { method: "POST", body: formData });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                const imgEl = new Image();
                imgEl.crossOrigin = "anonymous";
                imgEl.src = data.url;
                await new Promise((resolve) => { imgEl.onload = resolve; });

                const id = Date.now();
                this.images.push({
                    id,
                    filename: data.filename,
                    url: data.url,
                    x: 50,
                    y: 50,
                    width: Math.min(imgEl.naturalWidth, 300),
                    height: Math.min(imgEl.naturalHeight, 300),
                    opacity: 1.0,
                    startTime: 0,
                    endTime: -1,
                    _imgEl: imgEl,
                });
                this.renderImageList();
                this.drawOverlay();
                this.toast("Image added!", "success");
            } catch (err) {
                this.toast(`Image upload failed: ${err.message}`, "error");
            }
        };
        input.click();
    },

    removeImage(id) {
        this.images = this.images.filter((i) => i.id !== id);
        this.renderImageList();
        this.drawOverlay();
    },

    updateImage(id, key, value) {
        const img = this.images.find((i) => i.id === id);
        if (img) {
            img[key] = value;
            this.drawOverlay();
        }
    },

    renderImageList() {
        const container = document.getElementById("image-list");
        container.innerHTML = "";

        this.images.forEach((img, idx) => {
            const div = document.createElement("div");
            div.className = "overlay-item";
            div.innerHTML = `
                <div class="overlay-item-header">
                    <h4>Image #${idx + 1}</h4>
                    <button class="btn btn-danger btn-sm" onclick="App.removeImage(${img.id})">Remove</button>
                </div>
                <div style="margin-bottom:10px;text-align:center">
                    <img src="${img.url}" style="max-width:100%;max-height:80px;border-radius:6px;opacity:0.8">
                </div>
                <div class="inline-fields">
                    <div class="control-group">
                        <label>X</label>
                        <input type="number" class="number-input" value="${img.x}"
                            oninput="App.updateImage(${img.id}, 'x', +this.value)">
                    </div>
                    <div class="control-group">
                        <label>Y</label>
                        <input type="number" class="number-input" value="${img.y}"
                            oninput="App.updateImage(${img.id}, 'y', +this.value)">
                    </div>
                </div>
                <div class="inline-fields">
                    <div class="control-group">
                        <label>Width</label>
                        <input type="number" class="number-input" value="${img.width}"
                            oninput="App.updateImage(${img.id}, 'width', +this.value)">
                    </div>
                    <div class="control-group">
                        <label>Height</label>
                        <input type="number" class="number-input" value="${img.height}"
                            oninput="App.updateImage(${img.id}, 'height', +this.value)">
                    </div>
                </div>
                <div class="control-group">
                    <label>Opacity <span>${img.opacity.toFixed(2)}</span></label>
                    <input type="range" class="slider-input" min="0" max="1" step="0.05" value="${img.opacity}"
                        oninput="App.updateImage(${img.id}, 'opacity', +this.value); this.parentElement.querySelector('label span').textContent=(+this.value).toFixed(2)">
                </div>
                <div class="inline-fields">
                    <div class="control-group">
                        <label>Start (s)</label>
                        <input type="number" class="number-input" value="${img.startTime}" min="0" step="0.1"
                            oninput="App.updateImage(${img.id}, 'startTime', +this.value)">
                    </div>
                    <div class="control-group">
                        <label>End (s) <span style="font-size:0.65rem;color:var(--text-muted)">-1=forever</span></label>
                        <input type="number" class="number-input" value="${img.endTime}" min="-1" step="0.1"
                            oninput="App.updateImage(${img.id}, 'endTime', +this.value)">
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    },

    // --- EXPORT ---
    async exportVideo() {
        this.showModal("Exporting Video", "Rendering your video with all modifications. This may take a while...", true);

        const payload = {
            videoFilename: this.videoFilename,
            colors: { ...this.colors },
            texts: this.texts.map(({ _imgEl, id, ...rest }) => rest),
            images: this.images.map(({ _imgEl, id, url, ...rest }) => rest),
        };

        try {
            let progress = 0;
            const progressInterval = setInterval(() => {
                progress = Math.min(progress + Math.random() * 8, 90);
                this.modalProgress.style.width = `${progress}%`;
            }, 500);

            const res = await fetch("/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            clearInterval(progressInterval);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            this.modalProgress.style.width = "100%";
            this.showModal(
                "Export Complete!",
                "Your video has been rendered successfully.",
                false,
                `<a href="${data.url}" download class="btn btn-primary">Download Video</a>
                 <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>`
            );

            this.toast("Video exported!", "success");
        } catch (err) {
            this.showModal("Export Failed", err.message, false,
                `<button class="btn btn-secondary" onclick="App.closeModal()">Close</button>`
            );
            this.toast(`Export failed: ${err.message}`, "error");
        }
    },

    showModal(title, text, showProgress, actionsHtml) {
        this.modalBackdrop.classList.add("active");
        this.modalTitle.textContent = title;
        this.modalText.textContent = text;
        this.modalProgress.parentElement.style.display = showProgress ? "block" : "none";
        if (showProgress) this.modalProgress.style.width = "0%";
        this.modalActions.innerHTML = actionsHtml || "";
    },

    closeModal() {
        this.modalBackdrop.classList.remove("active");
    },

    toast(message, type = "info") {
        const container = document.querySelector(".toast-container");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    },

    escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML.replace(/"/g, "&quot;");
    },
};

document.addEventListener("DOMContentLoaded", () => App.init());

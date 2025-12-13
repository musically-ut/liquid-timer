// Water Simulation Engine (volume-conserving droplet accumulation + heightfield ripples)
class WaterSimulation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Droplets: exist only while falling. When they hit the surface, they merge and are removed.
        this.droplets = [];

        // Conserved volume (2D cross-section volume, assuming unit depth)
        this.waterVolume = 0;
        this.targetFillHeight = 0;
        this.targetVolume = 0;
        this.volumePerSecond = 0;

        // Surface heightfield (1D) for ripples, stored as pixel offsets around the base surface.
        this.surfaceN = 0;
        this.h = [];
        this.v = [];

        // Emission control
        // (We still simulate micro-droplets for volume conservation, but we render a continuous trickle.)
        this.dropsPerSecond = 260; // higher => smoother/continuous stream
        this.dropSpawnAccumulator = 0;
        this.maxDroplets = 1400;

        // Stream (visual) properties
        this.streamX = 0;
        this.streamWidth = 10; // px
        this.streamWobbleAmp = 18; // px
        this.streamWobbleSpeed = 0.65; // Hz-ish

        // Physics parameters (pixel units, dt in seconds)
        this.gravity = 5200; // px / s^2 (fast fall so arrival ~= emission)
        this.airDrag = 0.995;
        this.waveSpeed = 235; // px / s
        this.waveDamping = 1.35; // 1 / s (lower => more visible ripples)
        this.surfaceViscosity = 0.02;
        this.renderWaveScale = 2.2; // purely visual boost so ripples read better

        // Completion drain / whirlpool
        this.isDraining = false;
        this.whirlpoolActive = false;
        this.whirlpoolCenter = { x: 0, y: 0 };
        this.whirlpoolStrength = 0;
        this.drainRate = 0;

        this.resize();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.resize(), 100);
        });
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        // Preserve current heightfield to resample
        const oldH = this.h;
        const oldV = this.v;
        const oldN = this.surfaceN;
        const oldWidth = this.width || newWidth;

        this.canvas.width = newWidth * dpr;
        this.canvas.height = newHeight * dpr;
        this.canvas.style.width = `${newWidth}px`;
        this.canvas.style.height = `${newHeight}px`;

        // IMPORTANT: reset transform before scaling (avoids compounding scale on resize)
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);

        this.width = newWidth;
        this.height = newHeight;

        // Recompute target volume based on new cross-section area (unit depth)
        if (this.targetFillHeight > 0) {
            this.targetVolume = this.width * this.targetFillHeight;
        }

        // Resample heightfield to match new resolution
        this.initSurfaceField();
        if (oldN > 0 && oldH.length === oldN) {
            for (let i = 0; i < this.surfaceN; i++) {
                const x = (i / (this.surfaceN - 1)) * (oldN - 1);
                const i0 = Math.floor(x);
                const i1 = Math.min(oldN - 1, i0 + 1);
                const t = x - i0;
                this.h[i] = (oldH[i0] ?? 0) * (1 - t) + (oldH[i1] ?? 0) * t;
                this.v[i] = (oldV[i0] ?? 0) * (1 - t) + (oldV[i1] ?? 0) * t;
            }
        }

        // Keep droplets within bounds (don’t “stretch” them)
        const sx = this.width / Math.max(1, oldWidth);
        this.droplets.forEach(d => {
            d.x *= sx;
            d.x = Math.max(d.r, Math.min(this.width - d.r, d.x));
        });

        // Reset stream X to center-ish on resize/orientation changes
        this.streamX = this.width * 0.55;
    }

    initSurfaceField() {
        const n = Math.max(96, Math.floor(this.width / 3));
        this.surfaceN = n;
        this.h = new Array(n).fill(0);
        this.v = new Array(n).fill(0);
    }

    setTargetFillHeight(height) {
        this.targetFillHeight = height;
        this.targetVolume = this.width * height;
    }

    setEmission(volumePerSecond) {
        this.volumePerSecond = Math.max(0, volumePerSecond);
    }

    reset() {
        this.droplets = [];
        this.waterVolume = 0;
        this.dropSpawnAccumulator = 0;
        this.h.fill(0);
        this.v.fill(0);
        this.isDraining = false;
        this.whirlpoolActive = false;
        this.whirlpoolStrength = 0;
        this.drainRate = 0;
    }

    getWaterHeight() {
        // volume = width * height (unit depth)
        if (this.width <= 0) return 0;
        return Math.min(this.targetFillHeight || this.height, this.waterVolume / this.width);
    }

    getBaseSurfaceY() {
        return this.height - this.getWaterHeight();
    }

    xToIndex(x) {
        const t = this.width <= 1 ? 0 : x / this.width;
        return Math.max(0, Math.min(this.surfaceN - 1, Math.floor(t * (this.surfaceN - 1))));
    }

    sampleSurfaceOffset(x) {
        if (this.surfaceN <= 1) return 0;
        const fx = (x / this.width) * (this.surfaceN - 1);
        const i0 = Math.floor(fx);
        const i1 = Math.min(this.surfaceN - 1, i0 + 1);
        const t = fx - i0;
        return (this.h[i0] ?? 0) * (1 - t) + (this.h[i1] ?? 0) * t;
    }

    getSurfaceY(x) {
        return this.getBaseSurfaceY() + this.sampleSurfaceOffset(x);
    }

    addRippleImpulse(x, strength) {
        // strength affects velocity directly (px/s)
        const idx = this.xToIndex(x);
        const s = strength;
        if (this.v[idx] !== undefined) this.v[idx] += s;
        if (this.v[idx - 1] !== undefined) this.v[idx - 1] += s * 0.75;
        if (this.v[idx + 1] !== undefined) this.v[idx + 1] += s * 0.75;
        if (this.v[idx - 2] !== undefined) this.v[idx - 2] += s * 0.45;
        if (this.v[idx + 2] !== undefined) this.v[idx + 2] += s * 0.45;
        if (this.v[idx - 3] !== undefined) this.v[idx - 3] += s * 0.20;
        if (this.v[idx + 3] !== undefined) this.v[idx + 3] += s * 0.20;
    }

    spawnDroplet() {
        if (this.droplets.length >= this.maxDroplets) return;

        const meanDropVolume = this.volumePerSecond / Math.max(1, this.dropsPerSecond);
        // Variation around mean (keep positive)
        const vol = Math.max(0.0001, meanDropVolume * (0.65 + Math.random() * 0.7));

        // Convert "2D volume" into a visual radius. Clamp so drops are visible but not huge.
        // This is purely visual — conservation is handled via `vol`.
        const r = Math.max(1.5, Math.min(5.5, Math.sqrt(vol / Math.PI) * 9.5));

        // Spawn around the stream center so it reads as a trickle (not scattered drops).
        // Slight jitter prevents it looking like a rigid rod.
        const jitter = (Math.random() - 0.5) * this.streamWidth * 0.9;
        const x = Math.max(0, Math.min(this.width, this.streamX + jitter));
        const y = -12 - Math.random() * 40;
        const vx = (Math.random() - 0.5) * 20;
        const vy = 0;

        this.droplets.push({
            x,
            y,
            px: x,
            py: y,
            vx,
            vy,
            r,
            vol
        });
    }

    stepSurface(dt) {
        if (this.surfaceN <= 2) return;
        const dx = this.width / (this.surfaceN - 1);
        const c2 = this.waveSpeed * this.waveSpeed;

        // Wave equation: h'' = c^2 * laplacian(h)
        for (let i = 1; i < this.surfaceN - 1; i++) {
            const lap = (this.h[i - 1] + this.h[i + 1] - 2 * this.h[i]) / (dx * dx);
            this.v[i] += c2 * lap * dt;
        }

        // Damping + integrate
        const damp = Math.exp(-this.waveDamping * dt);
        for (let i = 0; i < this.surfaceN; i++) {
            this.v[i] *= damp;
            this.h[i] += this.v[i] * dt;
        }

        // Light viscosity / smoothing
        if (this.surfaceViscosity > 0) {
            const tmp = new Array(this.surfaceN);
            tmp[0] = this.h[0];
            tmp[this.surfaceN - 1] = this.h[this.surfaceN - 1];
            const a = this.surfaceViscosity;
            for (let i = 1; i < this.surfaceN - 1; i++) {
                tmp[i] = this.h[i] * (1 - a) + (this.h[i - 1] + this.h[i + 1]) * (a * 0.5);
            }
            this.h = tmp;
        }
    }

    update(deltaTime) {
        const dt = Math.max(0, Math.min(0.05, deltaTime)); // clamp large frame jumps

        // Update stream X with a gentle wobble (feels like a trickle)
        const t = performance.now() * 0.001;
        const base = this.width * 0.56;
        const wobble = Math.sin(t * (Math.PI * 2) * this.streamWobbleSpeed) * this.streamWobbleAmp;
        const wobble2 = Math.sin(t * (Math.PI * 2) * (this.streamWobbleSpeed * 1.9) + 1.3) * (this.streamWobbleAmp * 0.35);
        this.streamX = Math.max(this.streamWidth, Math.min(this.width - this.streamWidth, base + wobble + wobble2));

        // Emit droplets at a fixed *count* rate; each droplet carries a volume so that
        // total incoming volume per second is `volumePerSecond`.
        if (!this.isDraining && !this.whirlpoolActive && this.volumePerSecond > 0) {
            this.dropSpawnAccumulator += this.dropsPerSecond * dt;
            while (this.dropSpawnAccumulator >= 1) {
                this.spawnDroplet();
                this.dropSpawnAccumulator -= 1;
            }
        }

        // Drain volume during completion
        if (this.isDraining && this.drainRate > 0) {
            this.waterVolume = Math.max(0, this.waterVolume - this.drainRate * dt);
            this.whirlpoolStrength = Math.min(3.5, this.whirlpoolStrength + dt * 0.9);
        }

        const baseSurfaceY = this.getBaseSurfaceY();

        // Update droplets (free-fall) and merge on impact
        for (let i = this.droplets.length - 1; i >= 0; i--) {
            const d = this.droplets[i];
            d.px = d.x;
            d.py = d.y;

            d.vy += this.gravity * dt;
            d.vx *= this.airDrag;
            d.vy *= this.airDrag;

            d.x += d.vx * dt;
            d.y += d.vy * dt;

            // Side boundaries
            if (d.x < d.r) {
                d.x = d.r;
                d.vx *= -0.35;
            } else if (d.x > this.width - d.r) {
                d.x = this.width - d.r;
                d.vx *= -0.35;
            }

            // Impact with surface
            const surfaceY = this.getSurfaceY(d.x);
            if (d.y + d.r >= surfaceY) {
                // Volume conservation: only add to reservoir when the droplet hits the surface.
                this.waterVolume = Math.min(this.targetVolume || Infinity, this.waterVolume + d.vol);

                // Inject a ripple impulse proportional to impact speed and droplet volume.
                const impulse = Math.min(6500, (d.vy * 1.25 + d.vol * 220));
                this.addRippleImpulse(d.x, impulse);

                // Remove droplet (no lingering traces)
                this.droplets.splice(i, 1);
            } else if (d.y > this.height + 120) {
                // Safety: if it somehow falls through, drop it.
                this.droplets.splice(i, 1);
            }
        }

        // Apply whirlpool "sink" to the surface during drain (creates a visible draw-down)
        if (this.whirlpoolActive) {
            const cx = this.whirlpoolCenter.x;
            const idx = this.xToIndex(cx);
            const sigma = 9; // indices
            const sink = -1600 * this.whirlpoolStrength;
            for (let k = -28; k <= 28; k++) {
                const j = idx + k;
                if (j < 0 || j >= this.surfaceN) continue;
                const w = Math.exp(-(k * k) / (2 * sigma * sigma));
                this.v[j] += sink * w * dt;
            }
        }

        // Keep base surface stable (don’t let ripples float above top)
        if (baseSurfaceY < 0) {
            this.waterVolume = this.width * this.height;
        }

        // Step ripples
        this.stepSurface(dt);

        // Auto-stop drain once empty
        if (this.isDraining && this.waterVolume <= 0 && this.droplets.length === 0) {
            this.whirlpoolActive = false;
            this.isDraining = false;
            this.whirlpoolStrength = 0;
            this.drainRate = 0;
        }
    }

    render() {
        // Background
        const bg = this.ctx.createLinearGradient(0, 0, 0, this.height);
        bg.addColorStop(0, 'rgba(102, 126, 234, 0.10)');
        bg.addColorStop(1, 'rgba(118, 75, 162, 0.10)');
        this.ctx.fillStyle = bg;
        this.ctx.fillRect(0, 0, this.width, this.height);

        const waterHeight = this.getWaterHeight();
        const baseSurfaceY = this.getBaseSurfaceY();

        // Water body
        if (waterHeight > 0.5) {
            const waterGradient = this.ctx.createLinearGradient(0, baseSurfaceY, 0, this.height);
            waterGradient.addColorStop(0, 'rgba(120, 175, 255, 0.78)');
            waterGradient.addColorStop(0.35, 'rgba(85, 145, 245, 0.86)');
            waterGradient.addColorStop(1, 'rgba(45, 95, 210, 0.95)');

            // Build surface path once so we can reuse it for clip + strokes
            this.ctx.beginPath();
            this.ctx.moveTo(0, this.height);
            this.ctx.lineTo(0, baseSurfaceY + ((this.h[0] ?? 0) * this.renderWaveScale));
            for (let i = 1; i < this.surfaceN; i++) {
                const x = (i / (this.surfaceN - 1)) * this.width;
                this.ctx.lineTo(x, baseSurfaceY + (this.h[i] * this.renderWaveScale));
            }
            this.ctx.lineTo(this.width, this.height);
            this.ctx.closePath();
            this.ctx.fillStyle = waterGradient;
            this.ctx.fill();

            // Lighting (fake 3D): clip to water and overlay a diagonal "sun" gradient from top-right
            this.ctx.save();
            this.ctx.clip();
            this.ctx.globalCompositeOperation = 'lighter';
            const sun = this.ctx.createLinearGradient(this.width * 1.05, 0, 0, this.height * 0.9);
            sun.addColorStop(0, 'rgba(255,255,255,0.18)');
            sun.addColorStop(0.25, 'rgba(255,255,255,0.06)');
            sun.addColorStop(1, 'rgba(255,255,255,0.00)');
            this.ctx.fillStyle = sun;
            this.ctx.fillRect(0, 0, this.width, this.height);
            this.ctx.restore();

            // Surface specular that follows the wave crest (removes the "white band" artifact)
            const spec = this.ctx.createLinearGradient(0, baseSurfaceY - 40, 0, baseSurfaceY + 60);
            spec.addColorStop(0, 'rgba(255,255,255,0.00)');
            spec.addColorStop(0.45, 'rgba(255,255,255,0.22)');
            spec.addColorStop(1, 'rgba(255,255,255,0.00)');
            this.ctx.strokeStyle = spec;
            this.ctx.lineWidth = 2.2;
            this.ctx.beginPath();
            this.ctx.moveTo(0, baseSurfaceY + ((this.h[0] ?? 0) * this.renderWaveScale));
            for (let i = 1; i < this.surfaceN; i++) {
                const x = (i / (this.surfaceN - 1)) * this.width;
                this.ctx.lineTo(x, baseSurfaceY + (this.h[i] * this.renderWaveScale));
            }
            this.ctx.stroke();

            // Surface line (thin)
            this.ctx.strokeStyle = 'rgba(190, 230, 255, 0.65)';
            this.ctx.lineWidth = 1.6;
            this.ctx.beginPath();
            this.ctx.moveTo(0, baseSurfaceY + ((this.h[0] ?? 0) * this.renderWaveScale));
            for (let i = 1; i < this.surfaceN; i++) {
                const x = (i / (this.surfaceN - 1)) * this.width;
                this.ctx.lineTo(x, baseSurfaceY + (this.h[i] * this.renderWaveScale));
            }
            this.ctx.stroke();
        }

        // Falling water: render as a continuous trickle stream (no discrete droplet circles)
        this.renderStream();

        // Whirlpool visualization
        if (this.whirlpoolActive) {
            const cx = this.whirlpoolCenter.x;
            const cy = this.whirlpoolCenter.y;
            const t = Date.now() * 0.002;
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'lighter';

            // Funnel "hole" with radial gradient (fake depth)
            const holeR = 34 + this.whirlpoolStrength * 12;
            const hole = this.ctx.createRadialGradient(cx - 10, cy - 10, 2, cx, cy, holeR);
            hole.addColorStop(0, 'rgba(10, 35, 80, 0.85)');
            hole.addColorStop(0.35, 'rgba(40, 90, 170, 0.35)');
            hole.addColorStop(1, 'rgba(140, 210, 255, 0.00)');
            this.ctx.fillStyle = hole;
            this.ctx.beginPath();
            this.ctx.ellipse(cx, cy, holeR * 1.05, holeR * 0.72, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Spiral lines for motion
            this.ctx.strokeStyle = 'rgba(170, 230, 255, 0.55)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            for (let a = 0; a < Math.PI * 11; a += 0.07) {
                const r = 6 + a * 3.8;
                const x = cx + Math.cos(a + t) * r;
                const y = cy + Math.sin(a + t) * r * 0.62;
                if (a === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    renderStream() {
        if (this.volumePerSecond <= 0 && !this.isDraining) return;

        const x = this.streamX;
        const surfaceY = this.getSurfaceY(x);
        const waterHeight = this.getWaterHeight();

        if (!Number.isFinite(x) || !Number.isFinite(surfaceY)) return;

        // Compute a plausible end point (if there are droplets, use the lowest one)
        let endY = Math.min(surfaceY - 2, this.height);
        if (this.droplets.length > 0) {
            let maxY = -Infinity;
            for (const d of this.droplets) {
                if (d.y > maxY) maxY = d.y;
            }
            endY = Math.min(surfaceY - 2, Math.max(0, maxY));
        }

        // Guard against non-finite geometry
        if (!Number.isFinite(endY)) return;
        endY = Math.max(-50, Math.min(this.height, endY));

        const t = performance.now() * 0.001;
        const w = this.streamWidth * (0.85 + 0.25 * Math.sin(t * 2.1));
        const wob = Math.sin(t * 3.0) * (this.streamWidth * 0.35);

        if (!Number.isFinite(w) || w <= 0) return;

        // Main body (a ribbon with gradient)
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'lighter';
        const grad = this.ctx.createLinearGradient(x, 0, x, endY);
        grad.addColorStop(0, 'rgba(210, 245, 255, 0.06)');
        grad.addColorStop(0.20, 'rgba(160, 220, 255, 0.18)');
        grad.addColorStop(1, 'rgba(120, 190, 255, 0.10)');

        this.ctx.strokeStyle = grad;
        this.ctx.lineWidth = w;
        this.ctx.lineCap = 'round';

        this.ctx.beginPath();
        this.ctx.moveTo(x + wob * 0.10, -10);
        this.ctx.quadraticCurveTo(
            x + wob * 0.55,
            endY * 0.35,
            x - wob * 0.35,
            endY * 0.72
        );
        this.ctx.quadraticCurveTo(x + wob * 0.25, endY * 0.90, x, endY);
        this.ctx.stroke();

        // Specular thread inside the stream
        this.ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        this.ctx.lineWidth = Math.max(1.2, w * 0.22);
        this.ctx.beginPath();
        this.ctx.moveTo(x - w * 0.15, -10);
        this.ctx.quadraticCurveTo(x + wob * 0.35, endY * 0.45, x - w * 0.10, endY);
        this.ctx.stroke();

        // Small splash brightness at impact
        if (endY > 10 && waterHeight > 0.5) {
            const splash = this.ctx.createRadialGradient(x, surfaceY, 1, x, surfaceY, 28);
            splash.addColorStop(0, 'rgba(255,255,255,0.18)');
            splash.addColorStop(1, 'rgba(255,255,255,0.00)');
            this.ctx.fillStyle = splash;
            this.ctx.beginPath();
            this.ctx.ellipse(x, surfaceY, 26, 10, 0, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    startDraining() {
        this.isDraining = true;
        this.whirlpoolActive = true;
        this.whirlpoolCenter = { x: this.width / 2, y: this.height - 50 };
        this.whirlpoolStrength = 0.6;
        // Drain out over ~2.5 seconds (tuned)
        this.drainRate = this.waterVolume / 2.2;
    }
}

// Timer Controller
class TimerController {
    constructor() {
        this.totalSeconds = 0;
        this.remainingSeconds = 0;
        this.isRunning = false;
        this.isPaused = false;
        this.intervalId = null;
        this.lastTime = null;

        this.waterSim = new WaterSimulation(document.getElementById('water-canvas'));
        this.wakeLock = null;

        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.hoursInput = document.getElementById('hours');
        this.minutesInput = document.getElementById('minutes');
        this.secondsInput = document.getElementById('seconds');
        this.startBtn = document.getElementById('start-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.timerControls = document.getElementById('timer-controls');
        this.timerDisplay = document.getElementById('timer-display');
        this.timeText = document.getElementById('time-text');
        this.completionOverlay = document.getElementById('completion-overlay');
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());

        // Prevent negative values
        [this.hoursInput, this.minutesInput, this.secondsInput].forEach(input => {
            input.addEventListener('input', (e) => {
                if (e.target.value < 0) e.target.value = 0;
            });
        });
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => {
                    console.log('Wake lock released');
                });
            } catch (err) {
                console.log('Wake lock request failed:', err);
            }
        }
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    calculateTotalSeconds() {
        const hours = parseInt(this.hoursInput.value) || 0;
        const minutes = parseInt(this.minutesInput.value) || 0;
        const seconds = parseInt(this.secondsInput.value) || 0;
        return hours * 3600 + minutes * 60 + seconds;
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    async start() {
        this.totalSeconds = this.calculateTotalSeconds();
        if (this.totalSeconds <= 0) {
            alert('Please set a timer duration greater than 0');
            return;
        }

        this.remainingSeconds = this.totalSeconds;
        this.isRunning = true;
        this.isPaused = false;

        // Target: fill the full screen height by the end (volume-conserving)
        const targetHeight = window.innerHeight;
        this.waterSim.setTargetFillHeight(targetHeight);
        this.waterSim.reset();
        this.waterSim.setEmission(this.waterSim.targetVolume / this.totalSeconds);

        // Show/hide UI elements
        this.timerControls.style.display = 'none';
        this.timerDisplay.style.display = 'block';
        this.startBtn.style.display = 'none';
        this.pauseBtn.style.display = 'inline-block';
        this.resetBtn.style.display = 'inline-block';

        // Request wake lock
        await this.requestWakeLock();

        // Start animation loop
        this.lastTime = performance.now();
        this.animate();
    }

    pause() {
        this.isPaused = !this.isPaused;
        this.pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
    }

    reset() {
        this.isRunning = false;
        this.isPaused = false;
        this.remainingSeconds = 0;

        if (this.intervalId) {
            cancelAnimationFrame(this.intervalId);
            this.intervalId = null;
        }

        this.waterSim.reset();

        this.timerControls.style.display = 'flex';
        this.timerDisplay.style.display = 'none';
        this.completionOverlay.style.display = 'none';
        this.startBtn.style.display = 'inline-block';
        this.pauseBtn.style.display = 'none';
        this.pauseBtn.textContent = 'Pause';
        this.resetBtn.style.display = 'none';

        this.releaseWakeLock();
    }

    animate() {
        if (!this.isRunning) return;

        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;

        if (!this.isPaused) {
            // Update timer
            this.remainingSeconds -= deltaTime;

            if (this.remainingSeconds <= 0) {
                this.complete();
                return;
            }

            // Update water simulation (guard to avoid a render-time exception freezing the timer)
            try {
                this.waterSim.update(deltaTime);
            } catch (err) {
                console.error('Water simulation update failed:', err);
            }

            // Update display
            this.timeText.textContent = this.formatTime(Math.ceil(this.remainingSeconds));
        }

        // Render
        try {
            this.waterSim.render();
        } catch (err) {
            console.error('Water render failed:', err);
        }

        this.intervalId = requestAnimationFrame(() => this.animate());
    }

    playCompletionSound() {
        // Use Web Audio API to generate a pleasant jingle
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator1 = audioContext.createOscillator();
            const oscillator2 = audioContext.createOscillator();
            const oscillator3 = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            // Create a pleasant chord (C major: C, E, G)
            oscillator1.frequency.value = 523.25; // C5
            oscillator2.frequency.value = 659.25; // E5
            oscillator3.frequency.value = 783.99; // G5

            oscillator1.type = 'sine';
            oscillator2.type = 'sine';
            oscillator3.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);

            oscillator1.connect(gainNode);
            oscillator2.connect(gainNode);
            oscillator3.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator1.start();
            oscillator2.start();
            oscillator3.start();

            oscillator1.stop(audioContext.currentTime + 2);
            oscillator2.stop(audioContext.currentTime + 2);
            oscillator3.stop(audioContext.currentTime + 2);

            // Add water draining sound effect
            setTimeout(() => {
                const noise = audioContext.createBufferSource();
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 3, audioContext.sampleRate);
                const data = buffer.getChannelData(0);

                for (let i = 0; i < buffer.length; i++) {
                    data[i] = (Math.random() * 2 - 1) * 0.1;
                }

                const filter = audioContext.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 800;
                filter.Q.value = 1;

                const gain = audioContext.createGain();
                gain.gain.setValueAtTime(0.2, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 3);

                noise.buffer = buffer;
                noise.connect(filter);
                filter.connect(gain);
                gain.connect(audioContext.destination);
                noise.start();
                noise.stop(audioContext.currentTime + 3);
            }, 500);
        } catch (err) {
            console.log('Could not play sound:', err);
            // Fallback to HTML5 audio if available
            if (this.completionSound) {
                this.completionSound.play().catch(e => console.log('Audio fallback failed:', e));
            }
        }
    }

    complete() {
        this.isRunning = false;
        this.remainingSeconds = 0;
        this.timeText.textContent = '00:00:00';

        // Start draining animation
        this.waterSim.startDraining();

        // Show completion overlay
        this.completionOverlay.style.display = 'flex';

        // Play sound
        this.playCompletionSound();

        // Continue animation for draining
        let last = performance.now();
        const drainAnimation = () => {
            const now = performance.now();
            const dt = (now - last) / 1000;
            last = now;
            if (this.waterSim.isDraining || this.waterSim.whirlpoolActive) {
                this.waterSim.update(dt);
                this.waterSim.render();
                requestAnimationFrame(drainAnimation);
            } else {
                this.releaseWakeLock();
            }
        };

        drainAnimation();
    }
}

// Initialize when DOM is ready
let timerController;
document.addEventListener('DOMContentLoaded', () => {
    timerController = new TimerController();
    window.timerController = timerController;
});

// Handle visibility change to re-request wake lock
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && timerController?.isRunning) {
        await timerController.requestWakeLock();
    }
});


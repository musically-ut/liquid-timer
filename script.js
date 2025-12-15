import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water2.js';

class WaterScene {
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.scene = new THREE.Scene();
        // More top-down perspective so water fills the screen better
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 12, 6);
        this.camera.lookAt(0, 0, 0);

        // Lighting
        const hemi = new THREE.HemisphereLight(0xb1e1ff, 0x1b3550, 0.9);
        this.scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.9);
        dir.position.set(6, 10, 4);
        this.scene.add(dir);

        // Water plane (using Water2 for compatibility)
        const waterGeom = new THREE.PlaneGeometry(80, 80, 128, 128);
        const textureLoader = new THREE.TextureLoader();
        const normalMap0 = textureLoader.load('https://threejs.org/examples/textures/water/Water_1_M_Normal.jpg');
        const normalMap1 = textureLoader.load('https://threejs.org/examples/textures/water/Water_2_M_Normal.jpg');
        normalMap0.wrapS = normalMap0.wrapT = THREE.RepeatWrapping;
        normalMap1.wrapS = normalMap1.wrapT = THREE.RepeatWrapping;

        this.water = new Water(waterGeom, {
            color: 0x1e90ff,  // Deeper, more vibrant blue (DodgerBlue)
            scale: 4.0,      // Larger scale for more visible ripples
            flowDirection: new THREE.Vector2(1, 0.7),
            textureWidth: 1024,
            textureHeight: 1024,
            reflectivity: 0.6,  // Higher reflectivity for better reflection
            flowSpeed: 0.08,    // Slightly faster flow for more dynamic water
            normalMap0: normalMap0,
            normalMap1: normalMap1
        });
        this.water.rotation.x = -Math.PI / 2;
        this.scene.add(this.water);

        // Sky/environment for reflections
        const skyColor = new THREE.Color(0x87ceeb);  // Sky blue
        const groundColor = new THREE.Color(0x4169e1);  // Royal blue
        this.scene.background = new THREE.Color(0x1a1a2e);  // Dark background (won't show due to CSS)

        // Add a gradient sky dome for reflections
        const skyGeom = new THREE.SphereGeometry(50, 32, 32);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x87ceeb) },
                bottomColor: { value: new THREE.Color(0x667eea) },
                offset: { value: 10 },
                exponent: { value: 0.6 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.sky = new THREE.Mesh(skyGeom, skyMat);
        this.scene.add(this.sky);

        // Subtle fog for depth
        this.scene.fog = new THREE.Fog(0x667eea, 25, 80);

        // Stream ribbon
        const streamMat = new THREE.MeshPhysicalMaterial({
            color: 0xaed6ff,
            transparent: true,
            opacity: 0.30,
            roughness: 0.25,
            metalness: 0.0,
            clearcoat: 0.35,
            clearcoatRoughness: 0.45,
            transmission: 0.38,
            ior: 1.33,
            thickness: 0.35
        });
        this.streamGeom = new THREE.CylinderGeometry(0.12, 0.17, 8, 12, 1, true);
        this.stream = new THREE.Mesh(this.streamGeom, streamMat);
        this.stream.position.set(0.25, 4.5, 0);
        this.scene.add(this.stream);

        // Multiple splash rings for more visible ripple effect
        this.splashRings = [];
        for (let i = 0; i < 3; i++) {
            const splashGeom = new THREE.RingGeometry(0.2, 0.4, 64);
            const splashMat = new THREE.MeshBasicMaterial({
                color: 0xadd8ff,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide
            });
            const splash = new THREE.Mesh(splashGeom, splashMat);
            splash.rotation.x = -Math.PI / 2;
            splash.visible = false;
            splash.userData.delay = i * 0.15;  // Staggered rings
            this.scene.add(splash);
            this.splashRings.push(splash);
        }
        this.splash = this.splashRings[0];  // Keep reference for compatibility

        this.targetFillFraction = 0;
        this.currentFillFraction = 0;
        this.clock = new THREE.Clock();

        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 100));
        this.resize();
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    setFillFraction(f) {
        this.targetFillFraction = Math.max(0, Math.min(1, f));
    }

    triggerSplash() {
        // Trigger all splash rings with staggered timing
        this.splashRings.forEach((splash, i) => {
            splash.visible = true;
            splash.material.opacity = 0.5 - i * 0.1;  // Outer rings slightly fainter
            splash.scale.set(0.5 + i * 0.3, 0.5 + i * 0.3, 0.5 + i * 0.3);
            splash.position.y = 0.02;  // Just above water surface
        });
    }

    update(dt) {
        const time = this.clock.getElapsedTime();

        // Smooth fill fraction and clip canvas to represent level
        this.currentFillFraction += (this.targetFillFraction - this.currentFillFraction) * Math.min(1, dt * 6);
        const clipTop = (1 - this.currentFillFraction) * 100;
        this.renderer.domElement.style.clipPath = `inset(${clipTop}% 0 0 0)`;

        // Animate water shader time
        if (this.water.material.uniforms['time']) {
            this.water.material.uniforms['time'].value = time;
        }

        // Stream wobble / subtle noise
        const wob = Math.sin(time * 1.2) * 0.12 + Math.sin(time * 2.4 + 1.1) * 0.08;
        this.stream.position.x = 0.25 + wob * 0.2;
        const baseR = 0.13 + Math.sin(time * 3.1) * 0.02;
        this.stream.geometry.dispose();
        this.stream.geometry = new THREE.CylinderGeometry(baseR * 0.8, baseR, 8, 10, 1, true);
        this.stream.position.y = 4.5;

        // Splash rings expand/fade with staggered animation
        this.splashRings.forEach((splash, i) => {
            if (splash.visible) {
                const expandRate = 2.5 + i * 0.5;  // Outer rings expand faster
                splash.scale.multiplyScalar(1 + dt * expandRate);
                splash.material.opacity *= Math.exp(-dt * 3.0);
                if (splash.material.opacity < 0.02) splash.visible = false;
            }
        });

        this.renderer.render(this.scene, this.camera);
    }
}

class TimerController {
    constructor() {
        this.totalSeconds = 0;
        this.remainingSeconds = 0;
        this.isRunning = false;
        this.isPaused = false;
        this.intervalId = null;
        this.lastTime = null;

        this.waterScene = new WaterScene(document.getElementById('water-canvas'));
        this.wakeLock = null;

        this.initElements();
        this.setupEvents();
    }

    initElements() {
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

    setupEvents() {
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());
        [this.hoursInput, this.minutesInput, this.secondsInput].forEach(input => {
            input.addEventListener('input', (e) => { if (e.target.value < 0) e.target.value = 0; });
        });
    }

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => console.log('Wake lock released'));
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
        const h = parseInt(this.hoursInput.value) || 0;
        const m = parseInt(this.minutesInput.value) || 0;
        const s = parseInt(this.secondsInput.value) || 0;
        return h * 3600 + m * 60 + s;
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.max(0, Math.floor(seconds % 60));
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

        this.timerControls.style.display = 'none';
        this.timerDisplay.style.display = 'flex';

        await this.requestWakeLock();
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
        this.timerControls.style.display = 'flex';
        this.timerDisplay.style.display = 'none';
        this.completionOverlay.style.display = 'none';
        this.pauseBtn.textContent = 'Pause';
        this.waterScene.setFillFraction(0);
        this.releaseWakeLock();
    }

    animate() {
        if (!this.isRunning) return;
        const now = performance.now();
        const dt = (now - this.lastTime) / 1000;
        this.lastTime = now;

        if (!this.isPaused) {
            this.remainingSeconds -= dt;
            if (this.remainingSeconds <= 0) {
                this.remainingSeconds = 0;
                this.complete();
            }
            const filled = 1 - Math.max(0, this.remainingSeconds) / this.totalSeconds;
            this.waterScene.setFillFraction(filled);
            if (Math.random() < 0.08) this.waterScene.triggerSplash();
            this.timeText.textContent = this.formatTime(this.remainingSeconds);
        }

        this.waterScene.update(dt);
        this.intervalId = requestAnimationFrame(() => this.animate());
    }

    playCompletionSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const osc = [523.25, 659.25, 783.99].map(f => {
                const o = audioContext.createOscillator();
                o.frequency.value = f;
                o.type = 'sine';
                return o;
            });
            const gain = audioContext.createGain();
            gain.gain.setValueAtTime(0.3, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);
            osc.forEach(o => o.connect(gain));
            gain.connect(audioContext.destination);
            const end = audioContext.currentTime + 2;
            osc.forEach(o => { o.start(); o.stop(end); });
        } catch (err) {
            console.log('Could not play sound:', err);
        }
    }

    complete() {
        this.isRunning = false;
        this.remainingSeconds = 0;
        this.timeText.textContent = '00:00:00';
        this.completionOverlay.style.display = 'flex';
        this.playCompletionSound();
        this.releaseWakeLock();
    }
}

let timerController;
document.addEventListener('DOMContentLoaded', () => {
    timerController = new TimerController();
    window.timerController = timerController;
});

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && timerController?.isRunning) {
        await timerController.requestWakeLock();
    }
});


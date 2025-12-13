// Water Simulation Engine
class WaterSimulation {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.targetFillHeight = 0;
        this.currentFillHeight = 0;
        this.isDraining = false;
        this.whirlpoolActive = false;
        this.whirlpoolCenter = { x: 0, y: 0 };
        this.whirlpoolStrength = 0;

        this.resize();
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.resize(), 100);
        });
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.scale(dpr, dpr);

        this.width = window.innerWidth;
        this.height = window.innerHeight;

        // Adjust existing particles to new dimensions
        this.particles.forEach(p => {
            p.x = Math.min(p.x, this.width);
            p.y = Math.min(p.y, this.height);
        });
    }

    addParticle(x, y) {
        const particle = {
            x: x || Math.random() * this.width,
            y: y || -10,
            vx: (Math.random() - 0.5) * 2,
            vy: Math.random() * 3 + 2,
            radius: Math.random() * 3 + 2,
            mass: 1,
            density: 0.02,
            color: {
                r: 100 + Math.random() * 50,
                g: 150 + Math.random() * 50,
                b: 255,
                a: 0.6 + Math.random() * 0.3
            }
        };
        this.particles.push(particle);
    }

    update(deltaTime, fillRate) {
        // Add new particles based on fill rate
        if (!this.isDraining && !this.whirlpoolActive) {
            const particlesPerFrame = Math.max(1, fillRate * 0.3);
            const particlesToAdd = Math.floor(particlesPerFrame) + (Math.random() < (particlesPerFrame % 1) ? 1 : 0);
            for (let i = 0; i < particlesToAdd; i++) {
                this.addParticle();
            }
        }

        // Update particles
        this.particles.forEach((particle, i) => {
            // Apply gravity
            particle.vy += 0.3 * deltaTime;

            // Apply viscosity/damping
            particle.vx *= 0.98;
            particle.vy *= 0.98;

            // Whirlpool effect
            if (this.whirlpoolActive) {
                const dx = particle.x - this.whirlpoolCenter.x;
                const dy = particle.y - this.whirlpoolCenter.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);
                const force = this.whirlpoolStrength / (dist + 10);

                particle.vx += Math.cos(angle + Math.PI / 2) * force * deltaTime * 50;
                particle.vy += Math.sin(angle + Math.PI / 2) * force * deltaTime * 50;

                // Pull towards center
                particle.vx -= dx * force * deltaTime * 20;
                particle.vy -= dy * force * deltaTime * 20;

                // Increase downward velocity near center
                if (dist < 50) {
                    particle.vy += 5 * deltaTime;
                }
            }

            // Update position with more realistic physics
            const dt = deltaTime * 60;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;

            // Boundary collisions
            if (particle.x < particle.radius) {
                particle.x = particle.radius;
                particle.vx *= -0.5;
            }
            if (particle.x > this.width - particle.radius) {
                particle.x = this.width - particle.radius;
                particle.vx *= -0.5;
            }

            // Bottom boundary (water level)
            const waterLevel = this.height - this.currentFillHeight;
            if (particle.y > waterLevel - particle.radius) {
                particle.y = waterLevel - particle.radius;
                particle.vy *= -0.3;
                particle.vx += (Math.random() - 0.5) * 0.5;
            }

            // Top boundary
            if (particle.y < particle.radius) {
                particle.y = particle.radius;
                particle.vy *= -0.3;
            }

            // Particle interactions (realistic fluid dynamics)
            const nearbyParticles = this.particles.slice(i + 1).filter(other => {
                const dx = other.x - particle.x;
                const dy = other.y - particle.y;
                return (dx * dx + dy * dy) < 400; // Only check nearby particles
            });

            nearbyParticles.forEach(other => {
                const dx = other.x - particle.x;
                const dy = other.y - particle.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = particle.radius + other.radius;

                if (dist < minDist && dist > 0) {
                    const angle = Math.atan2(dy, dx);
                    const overlap = minDist - dist;

                    // Separate particles with realistic pressure
                    const moveX = Math.cos(angle) * overlap * 0.5;
                    const moveY = Math.sin(angle) * overlap * 0.5;
                    particle.x -= moveX;
                    particle.y -= moveY;
                    other.x += moveX;
                    other.y += moveY;

                    // Realistic momentum transfer (conservation of momentum)
                    const vx1 = particle.vx;
                    const vy1 = particle.vy;
                    const vx2 = other.vx;
                    const vy2 = other.vy;

                    // Elastic collision with damping
                    const relativeVx = vx2 - vx1;
                    const relativeVy = vy2 - vy1;
                    const dotProduct = relativeVx * Math.cos(angle) + relativeVy * Math.sin(angle);

                    if (dotProduct < 0) {
                        const impulse = dotProduct * 0.4; // Damping factor
                        particle.vx += impulse * Math.cos(angle);
                        particle.vy += impulse * Math.sin(angle);
                        other.vx -= impulse * Math.cos(angle);
                        other.vy -= impulse * Math.sin(angle);
                    }
                } else if (dist < minDist * 3 && dist > 0) {
                    // Surface tension effect for nearby particles
                    const tension = 0.01;
                    const force = tension / (dist * dist);
                    particle.vx += (dx / dist) * force;
                    particle.vy += (dy / dist) * force;
                }
            });
        });

        // Remove particles that are off-screen or drained
        this.particles = this.particles.filter(p => {
            if (this.whirlpoolActive && p.y > this.height + 50) {
                return false;
            }
            return p.y < this.height + 100 && p.x > -100 && p.x < this.width + 100;
        });

        // Update fill height based on time and particle accumulation
        if (!this.isDraining && !this.whirlpoolActive && fillRate > 0) {
            // Use time-based fill for smooth progression
            this.currentFillHeight = Math.min(this.currentFillHeight + fillRate * deltaTime * 60, this.targetFillHeight);

            // Also consider particle accumulation for visual feedback
            const waterLevel = this.height - this.currentFillHeight;
            const particlesBelowWater = this.particles.filter(p => p.y >= waterLevel).length;
            // Ensure we have enough particles to represent the water level
            if (particlesBelowWater < 100 && this.currentFillHeight < this.targetFillHeight) {
                // Add extra particles if needed
                for (let i = 0; i < 5; i++) {
                    this.addParticle(Math.random() * this.width, waterLevel - Math.random() * 20);
                }
            }
        }
    }

    render() {
        // Clear with gradient background
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
        gradient.addColorStop(0, 'rgba(102, 126, 234, 0.1)');
        gradient.addColorStop(1, 'rgba(118, 75, 162, 0.1)');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Calculate water level
        const waterLevel = this.height - this.currentFillHeight;

        // Draw water surface with realistic rendering
        if (this.currentFillHeight > 0) {
            // Draw water body with depth-based opacity
            const waterGradient = this.ctx.createLinearGradient(0, waterLevel, 0, this.height);
            waterGradient.addColorStop(0, 'rgba(100, 150, 255, 0.85)');
            waterGradient.addColorStop(0.3, 'rgba(80, 130, 240, 0.9)');
            waterGradient.addColorStop(0.7, 'rgba(60, 110, 220, 0.92)');
            waterGradient.addColorStop(1, 'rgba(40, 90, 200, 0.95)');

            this.ctx.fillStyle = waterGradient;
            this.ctx.fillRect(0, waterLevel, this.width, this.currentFillHeight);

            // Draw surface line with animated waves and reflections
            this.ctx.strokeStyle = 'rgba(150, 200, 255, 0.7)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(0, waterLevel);

            const time = Date.now() * 0.001;
            // Create more complex wavy surface
            for (let x = 0; x < this.width; x += 3) {
                const wave1 = Math.sin(x * 0.015 + time) * 1.5;
                const wave2 = Math.sin(x * 0.03 + time * 1.3) * 0.8;
                const wave3 = Math.sin(x * 0.05 + time * 0.7) * 0.5;
                const wave = wave1 + wave2 + wave3;
                this.ctx.lineTo(x, waterLevel + wave);
            }
            this.ctx.stroke();

            // Add surface highlights
            this.ctx.fillStyle = 'rgba(200, 230, 255, 0.3)';
            this.ctx.beginPath();
            for (let x = 0; x < this.width; x += 20) {
                const wave = Math.sin(x * 0.02 + time) * 2;
                this.ctx.fillRect(x, waterLevel + wave - 1, 15, 2);
            }
        }

        // Draw particles with realistic rendering
        this.particles.forEach(particle => {
            // Create gradient for particle
            const particleGradient = this.ctx.createRadialGradient(
                particle.x, particle.y, 0,
                particle.x, particle.y, particle.radius
            );
            particleGradient.addColorStop(0, `rgba(${particle.color.r}, ${particle.color.g}, ${particle.color.b}, ${particle.color.a})`);
            particleGradient.addColorStop(0.7, `rgba(${particle.color.r - 20}, ${particle.color.g - 20}, ${particle.color.b}, ${particle.color.a * 0.8})`);
            particleGradient.addColorStop(1, `rgba(${particle.color.r - 40}, ${particle.color.g - 40}, ${particle.color.b - 20}, ${particle.color.a * 0.4})`);

            this.ctx.fillStyle = particleGradient;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Add highlight
            this.ctx.fillStyle = `rgba(255, 255, 255, ${particle.color.a * 0.3})`;
            this.ctx.beginPath();
            this.ctx.arc(particle.x - particle.radius * 0.3, particle.y - particle.radius * 0.3, particle.radius * 0.4, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Draw whirlpool visualization
        if (this.whirlpoolActive) {
            const centerX = this.whirlpoolCenter.x;
            const centerY = this.whirlpoolCenter.y;

            // Draw spiral
            this.ctx.strokeStyle = 'rgba(100, 150, 255, 0.6)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            for (let angle = 0; angle < Math.PI * 8; angle += 0.1) {
                const radius = angle * 2;
                const x = centerX + Math.cos(angle + Date.now() * 0.005) * radius;
                const y = centerY + Math.sin(angle + Date.now() * 0.005) * radius;
                if (angle === 0) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
            this.ctx.stroke();
        }
    }

    startDraining() {
        this.isDraining = true;
        this.whirlpoolActive = true;
        this.whirlpoolCenter = {
            x: this.width / 2,
            y: this.height - 50
        };
        this.whirlpoolStrength = 0.5;
    }

    setTargetFillHeight(height) {
        this.targetFillHeight = height;
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

        // Calculate target fill height (full screen height)
        const targetHeight = window.innerHeight;
        this.waterSim.setTargetFillHeight(targetHeight);
        this.waterSim.currentFillHeight = 0;
        this.waterSim.particles = [];

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

        this.waterSim.particles = [];
        this.waterSim.currentFillHeight = 0;
        this.waterSim.isDraining = false;
        this.waterSim.whirlpoolActive = false;
        this.waterSim.whirlpoolStrength = 0;

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

            // Calculate fill rate (pixels per second)
            const fillRate = (this.waterSim.targetFillHeight / this.totalSeconds) * (deltaTime / deltaTime);
            const actualFillRate = this.waterSim.targetFillHeight / this.totalSeconds;

            // Update water simulation
            this.waterSim.update(deltaTime, actualFillRate);

            // Update display
            this.timeText.textContent = this.formatTime(Math.ceil(this.remainingSeconds));
        }

        // Render
        this.waterSim.render();

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
        const drainAnimation = () => {
            if (this.waterSim.currentFillHeight > 0 || this.waterSim.particles.length > 0) {
                this.waterSim.currentFillHeight = Math.max(0, this.waterSim.currentFillHeight - 8);
                this.waterSim.whirlpoolStrength = Math.min(this.waterSim.whirlpoolStrength + 0.02, 3);
                this.waterSim.update(0.016, 0);
                this.waterSim.render();
                requestAnimationFrame(drainAnimation);
            } else {
                this.waterSim.whirlpoolActive = false;
                this.waterSim.isDraining = false;
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


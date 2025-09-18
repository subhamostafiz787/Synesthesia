let sound, amp, fft;
let mic, recorder, soundFile;
let isPlaying = false;

// Camera input
let video;
let cameraEnabled = false;
let motionDetector = {
  previous: null,
  threshold: 30,
  sensitivity: 0.5
};
let brightnessDetector = {
  current: 0,
  previous: 0,
  change: 0
};

// Input mode: 'file' or 'mic'
let audioMode = 'file';
let recordState = 0;

// Visual state
let particles = [];
let bassShapes = [];
let midShapes = [];
let highShapes = [];
let beatLevel = 0;
let lastBeatMs = 0;
let spectralCentroid = 0;
let colorShift = 0;

// Camera influence on visuals - INCREASED SENSITIVITY
let cameraInfluence = {
  motion: 0,      // 0-1, affects wave complexity
  brightness: 0,  // 0-1, affects color intensity
  stability: 0    // 0-1, affects particle behavior
};

// Frequency bands
const bands = {
  subBass: { from: 20, to: 60 },
  bass: { from: 60, to: 250 },
  lowMid: { from: 250, to: 500 },
  mid: { from: 500, to: 2000 },
  highMid: { from: 2000, to: 4000 },
  high: { from: 4000, to: 8000 },
  air: { from: 8000, to: 20000 }
};

// ---------- Neutral color helpers (HSB) ----------
function neutral(hueBase, intensity, a = 160) {
  const h = ((hueBase % 360) + 360) % 360;
  const s = 6 + 10 * constrain(intensity, 0, 1);
  const b = 35 + 55 * constrain(intensity, 0, 1);
  return color(h, s, b, a);
}
function neutralStroke(hueBase, intensity, a = 160) {
  stroke(neutral(hueBase, intensity, a));
}
function neutralFill(hueBase, intensity, a = 160) {
  fill(neutral(hueBase, intensity, a));
}

function setup() {
  createCanvas(window.innerWidth, window.innerHeight);
  colorMode(HSB, 360, 100, 100, 255);
  noStroke();

  userStartAudio();
  amp = new p5.Amplitude();
  fft = new p5.FFT(0.8, 1024);

  mic = new p5.AudioIn();
  mic.start();
  recorder = new p5.SoundRecorder();
  recorder.setInput(mic);
  soundFile = new p5.SoundFile();

  // Initialize camera
  video = createCapture(VIDEO);
  video.size(160, 120); // Small size for performance
  video.hide(); // Hide the video element

  // visuals
  for (let i = 0; i < 200; i++) particles.push(new Particle());
  for (let i = 0; i < 48; i++) {
    bassShapes.push(new BassShape());
    midShapes.push(new MidShape());
    highShapes.push(new HighShape());
  }

  const fileEl = document.getElementById('file');
  const playEl = document.getElementById('play');
  const micEl = document.getElementById('mic');
  const cameraEl = document.getElementById('camera');
  
  if (fileEl) fileEl.addEventListener('change', onFileSelected);
  if (playEl) playEl.addEventListener('click', togglePlay);
  if (micEl) micEl.addEventListener('click', toggleMicMode);
  if (cameraEl) cameraEl.addEventListener('click', toggleCamera);

  updateStatus('No audio');
}

function draw() {
  // Camera analysis
  if (cameraEnabled) {
    analyzeCamera();
  }

  // Audio analysis
  let level = 0, spectrum = fft.analyze();
  let e = emptyEnergies();
  if (audioMode === 'mic') {
    level = mic.getLevel();
    if (spectrum && spectrum.length) e = analyzeFrequencies(spectrum);
  } else if (sound && sound.isPlaying()) {
    level = amp.getLevel();
    if (spectrum && spectrum.length) e = analyzeFrequencies(spectrum);
  }

  // Combine audio and camera influences
  e = combineInfluences(e);

  colorShift += e.mid * 0.03;
  spectralCentroid = calcCentroid(spectrum);
  detectBeat(level);

  // Background (camera-influenced) - MORE DRAMATIC
  const bgHue = map(spectralCentroid, 0, 512, 210, 260) + cameraInfluence.brightness * 60;
  background(neutral(bgHue, e.mid + cameraInfluence.brightness * 0.8, 28));

  drawEnergyWaves(e);
  drawSubBass(e.subBass);
  drawBass(e.bass);
  drawMid(e.mid);
  drawHigh(e.high);
  drawAir(e.air);

  for (const p of particles) { 
    p.update(e, cameraInfluence); 
    p.display(e); 
  }

  if (beatLevel > 0.5) drawBeatBurst(e);

  if (audioMode === 'mic') drawRecordIndicator();

  // Show camera preview (small) with motion indicator
  if (cameraEnabled) {
    push();
    translate(width - 120, height - 90);
    scale(0.5);
    image(video, 0, 0);
    
    // Motion indicator
    if (cameraInfluence.motion > 0.1) {
      fill(255, 0, 0, 200);
      circle(10, 10, 20);
    }
    pop();
    
    // Show camera values on screen
    push();
    fill(255, 255, 255, 200);
    textSize(12);
    text(`Motion: ${cameraInfluence.motion.toFixed(2)}`, 10, height - 60);
    text(`Brightness: ${cameraInfluence.brightness.toFixed(2)}`, 10, height - 40);
    text(`Stability: ${cameraInfluence.stability.toFixed(2)}`, 10, height - 20);
    pop();
  }
}

// ---------- Camera Analysis - INCREASED SENSITIVITY ----------
function analyzeCamera() {
  if (!video || !video.loadedmetadata) return;

  video.loadPixels();
  if (!video.pixels) return;

  // Motion detection (frame difference) - MORE SENSITIVE
  let motion = 0;
  if (motionDetector.previous) {
    for (let i = 0; i < video.pixels.length; i += 4) {
      const r = video.pixels[i];
      const g = video.pixels[i + 1];
      const b = video.pixels[i + 2];
      const brightness = (r + g + b) / 3;
      
      const diff = abs(brightness - motionDetector.previous[i / 4]);
      motion += diff;
    }
    motion /= (video.pixels.length / 4);
  }

  // Store current frame for next comparison
  motionDetector.previous = [];
  let totalBrightness = 0;
  for (let i = 0; i < video.pixels.length; i += 4) {
    const r = video.pixels[i];
    const g = video.pixels[i + 1];
    const b = video.pixels[i + 2];
    const brightness = (r + g + b) / 3;
    
    motionDetector.previous.push(brightness);
    totalBrightness += brightness;
  }

  // Update camera influence - MUCH MORE SENSITIVE
  cameraInfluence.motion = constrain(motion / 20, 0, 1); // Reduced divisor for more sensitivity
  brightnessDetector.current = totalBrightness / (video.pixels.length / 4);
  brightnessDetector.change = abs(brightnessDetector.current - brightnessDetector.previous) / 255;
  brightnessDetector.previous = brightnessDetector.current;
  
  cameraInfluence.brightness = map(brightnessDetector.current, 0, 255, 0, 1);
  cameraInfluence.stability = 1 - cameraInfluence.motion;
}

function combineInfluences(e) {
  // Apply camera influence to audio energies - MUCH MORE DRAMATIC
  const combined = { ...e };
  
  // Motion affects wave complexity and particle movement - INCREASED MULTIPLIERS
  combined.mid *= (1 + cameraInfluence.motion * 2.0);    // Was 0.5, now 2.0
  combined.high *= (1 + cameraInfluence.motion * 1.5);   // Was 0.3, now 1.5
  
  // Brightness affects color intensity - INCREASED MULTIPLIERS
  combined.bass *= (1 + cameraInfluence.brightness * 1.2); // Was 0.4, now 1.2
  
  // Stability affects particle behavior - INCREASED MULTIPLIERS
  combined.subBass *= (1 + cameraInfluence.stability * 0.8); // Was 0.3, now 0.8
  
  return combined;
}

// ---------- Analysis ----------
function emptyEnergies() {
  return { subBass:0, bass:0, lowMid:0, mid:0, highMid:0, high:0, air:0, centroid:0 };
}
function analyzeFrequencies(spectrum) {
  if (!spectrum || !spectrum.length) return emptyEnergies();
  return {
    subBass: fft.getEnergy(bands.subBass.from, bands.subBass.to) / 255,
    bass:    fft.getEnergy(bands.bass.from, bands.bass.to)       / 255,
    lowMid:  fft.getEnergy(bands.lowMid.from, bands.lowMid.to)   / 255,
    mid:     fft.getEnergy(bands.mid.from, bands.mid.to)         / 255,
    highMid: fft.getEnergy(bands.highMid.from, bands.highMid.to) / 255,
    high:    fft.getEnergy(bands.high.from, bands.high.to)       / 255,
    air:     fft.getEnergy(bands.air.from, bands.air.to)         / 255,
    centroid: calcCentroid(spectrum)
  };
}
function calcCentroid(spectrum) {
  if (!spectrum || !spectrum.length) return 0;
  let ws = 0, ms = 0;
  for (let i = 0; i < spectrum.length; i++) { ws += i * spectrum[i]; ms += spectrum[i]; }
  return ms > 0 ? ws / ms : 0;
}
function detectBeat(level) {
  const now = millis();
  if (level > 0.3 && now - lastBeatMs > 200) { beatLevel = 1; lastBeatMs = now; }
  else beatLevel = lerp(beatLevel, 0, 0.1);
}

// ---------- Visuals (camera-influenced) - MUCH MORE DRAMATIC ----------
function drawEnergyWaves(e) {
  const baseHue = map(spectralCentroid, 0, 512, 210, 260) + cameraInfluence.brightness * 40;
  noStroke();
  for (let i = 0; i < 3; i++) {
    const y0 = map(i, 0, 2, 0, height);
    // MUCH MORE DRAMATIC WAVE CHANGES
    const h = 18 + e.mid * 90 + cameraInfluence.motion * 150; // Was 40, now 150
    const sp = 0.01 + e.high * 0.02 + cameraInfluence.motion * 0.05; // Was 0.01, now 0.05
    neutralFill(baseHue + i * 8 + cameraInfluence.brightness * 30, e.mid + cameraInfluence.brightness * 0.5, 34);
    beginShape();
    vertex(0, y0);
    for (let x = 0; x <= width; x += 18) {
      // ADD CAMERA MOTION TO WAVE SHAPE
      const y = y0 + 
        sin(x * sp + frameCount * 0.02) * h +
        sin(x * 0.03 + cameraInfluence.motion * 0.1) * cameraInfluence.motion * 100 + // NEW: Camera motion wave
        cos(x * 0.02 + cameraInfluence.brightness * 0.1) * cameraInfluence.brightness * 80; // NEW: Brightness wave
      vertex(x, y);
    }
    vertex(width, y0);
    endShape();
  }
}

function drawSubBass(energy) {
  push();
  translate(width/2, height/2);
  // MUCH MORE DRAMATIC SIZE CHANGES
  const s = energy * 380 + cameraInfluence.brightness * 300; // Was 100, now 300
  for (let i = 0; i < 3; i++) {
    neutralFill(colorShift * 10 + i * 12 + cameraInfluence.brightness * 50, energy, map(energy,0,1,30,110));
    circle(0, 0, s + i * 46);
  }
  pop();
}

function drawBass(energy) {
  for (const b of bassShapes) { b.update(energy, cameraInfluence); b.display(energy); }
}
function drawMid(energy) {
  push();
  noFill();
  neutralStroke(220 + cameraInfluence.brightness * 60, energy, 160); // Was 30, now 60
  strokeWeight(1.5 + energy * 3.5 + cameraInfluence.motion * 6); // Was 2, now 6
  for (let i = 0; i < 4; i++) {
    beginShape();
    for (let x = 0; x <= width; x += 22) {
      const y = height/2 +
        sin(x * 0.01 + frameCount * 0.02 + i) * energy * 170 +
        cos(x * 0.005 + frameCount * 0.01) * energy * 90 +
        sin(x * 0.02 + cameraInfluence.motion * 0.01) * cameraInfluence.motion * 150 + // Was 50, now 150
        sin(x * 0.05 + cameraInfluence.brightness * 0.02) * cameraInfluence.brightness * 100; // NEW: Brightness wave
      vertex(x, y);
    }
    endShape();
  }
  pop();
}
function drawHigh(energy) {
  noStroke();
  // MUCH MORE DRAMATIC PARTICLE COUNT
  const count = energy * 90 + cameraInfluence.motion * 150; // Was 30, now 150
  for (let i = 0; i < count; i++) {
    const x = random(width), y = random(height), sz = random(2, 7);
    neutralFill(colorShift * 18 + i * 7 + cameraInfluence.brightness * 40, energy, energy * 170); // Was 15, now 40
    circle(x, y, sz);
  }
}
function drawAir(energy) {
  if (energy <= 0.1) return;
  strokeWeight(1);
  // MUCH MORE DRAMATIC SPARKLE COUNT
  const count = energy * 40 + cameraInfluence.motion * 100; // Was 20, now 100
  for (let i = 0; i < count; i++) {
    const x = random(width), y = random(height), sz = random(1, 3);
    push();
    translate(x, y); rotate(random(TWO_PI));
    neutralStroke(0, energy, energy * 160);
    line(-sz, 0, sz, 0); line(0, -sz, 0, sz);
    pop();
  }
}
function drawBeatBurst(e) {
  push();
  translate(width/2, height/2);
  // MUCH MORE DRAMATIC BURST SIZE
  const R = beatLevel * 260 + cameraInfluence.motion * 200; // Was 100, now 200
  neutralStroke(10, max(e.bass, e.mid), 180);
  strokeWeight(2.5 + cameraInfluence.motion * 4); // Was 1.5, now 4
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TWO_PI;
    line(0, 0, cos(a) * R, sin(a) * R);
  }
  pop();
}

// ---------- Shape classes (camera-influenced) - MORE DRAMATIC ----------
class BassShape {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.size = random(18, 54);
    this.rot = 0;
  }
  update(e, camera) { 
    this.rot += e * 0.09 + camera.motion * 0.2; // Was 0.05, now 0.2
    this.size = 18 + e * 76 + camera.brightness * 60; // Was 20, now 60
  }
  display(e) {
    push();
    translate(this.pos.x, this.pos.y); rotate(this.rot);
    neutralFill(colorShift * 12, e, e * 190);
    rectMode(CENTER); rect(0, 0, this.size, this.size, 4);
    pop();
  }
}
class MidShape {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(0, 0);
    this.size = random(10, 26);
  }
  update(e, camera) {
    const motionForce = camera.motion * 0.8; // Was 0.3, now 0.8
    this.vel.add(p5.Vector.random2D().mult(e * 0.45 + motionForce));
    this.vel.mult(0.95); this.pos.add(this.vel);
    if (this.pos.x < 0 || this.pos.x > width) this.vel.x *= -1;
    if (this.pos.y < 0 || this.pos.y > height) this.vel.y *= -1;
  }
  display(e) {
    neutralFill(colorShift * 20 + this.pos.x * 0.08, e, e * 160);
    triangle(
      this.pos.x, this.pos.y - this.size,
      this.pos.x - this.size, this.pos.y + this.size,
      this.pos.x + this.size, this.pos.y + this.size
    );
  }
}
class HighShape {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(0, 0);
    this.size = random(5, 12);
  }
  update(e, camera) {
    const motionForce = camera.motion * 0.6; // Was 0.2, now 0.6
    this.vel.add(p5.Vector.random2D().mult(e * 0.28 + motionForce));
    this.vel.mult(0.98); this.pos.add(this.vel);
    if (this.pos.x < 0 || this.pos.x > width) this.vel.x *= -1;
    if (this.pos.y < 0 || this.pos.y > height) this.vel.y *= -1;
  }
  display(e) {
    push();
    translate(this.pos.x, this.pos.y); rotate(frameCount * 0.02);
    neutralFill(colorShift * 24 + this.pos.y * 0.08, e, e * 150);
    beginShape();
    const pts = 5;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TWO_PI;
      vertex(cos(a) * this.size, sin(a) * this.size);
    }
    endShape(CLOSE);
    pop();
  }
}
class Particle {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.life = 255; this.maxLife = 255;
    this.size = random(2, 6);
    this.kind = random(['circle', 'square', 'triangle']);
  }
  update(e, camera) {
    const bassF = createVector(sin(this.pos.x * 0.005)*e.bass*3,  cos(this.pos.y * 0.005)*e.bass*3);
    const midF  = createVector(sin(this.pos.x * 0.01 + frameCount*0.01)*e.mid*2,
                               cos(this.pos.y * 0.01 + frameCount*0.01)*e.mid*2);
    const highF = createVector(sin(this.pos.x * 0.02 + frameCount*0.02)*e.high*1,
                               cos(this.pos.y * 0.02 + frameCount*0.02)*e.high*1);
    
    // Add camera motion force - MUCH STRONGER
    const cameraF = createVector(
      sin(this.pos.x * 0.01 + camera.motion * 0.1) * camera.motion * 8, // Was 2, now 8
      cos(this.pos.y * 0.01 + camera.motion * 0.1) * camera.motion * 8  // Was 2, now 8
    );
    
    this.acc.add(bassF).add(midF).add(highF).add(cameraF);
    this.vel.add(this.acc).mult(0.95); this.pos.add(this.vel); this.acc.mult(0);
    if (this.pos.x < 0) this.pos.x = width; if (this.pos.x > width) this.pos.x = 0;
    if (this.pos.y < 0) this.pos.y = height; if (this.pos.y > height) this.pos.y = 0;
    if (--this.life <= 0) { this.pos.set(random(width), random(height)); this.vel.mult(0); this.life = this.maxLife; }
  }
  display(e) {
    const a = map(this.life, 0, this.maxLife, 0, 180);
    neutralFill(colorShift * 50 + this.pos.x * 0.4, max(e.mid, e.high), a);
    if (this.kind === 'circle') circle(this.pos.x, this.pos.y, this.size);
    else if (this.kind === 'square') rect(this.pos.x - this.size/2, this.pos.y - this.size/2, this.size, this.size, 2);
    else triangle(
      this.pos.x, this.pos.y - this.size,
      this.pos.x - this.size, this.pos.y + this.size,
      this.pos.x + this.size, this.pos.y + this.size
    );
  }
}

// ---------- Audio controls ----------
async function onFileSelected(e) {
  const file = e.target.files[0]; if (!file) return;
  audioMode = 'file';
  if (sound) { sound.disconnect(); sound.stop(); }
  sound = loadSound(URL.createObjectURL(file), () => {
    amp.setInput(sound); fft.setInput(sound);
    updateStatus(`Loaded: ${file.name}`);
  }, () => updateStatus('Load error'));
}
function togglePlay() {
  if (audioMode === 'mic') { updateStatus('Switch to file mode first'); return; }
  if (!sound) { updateStatus('No audio loaded'); return; }
  if (isPlaying) { sound.pause(); isPlaying = false; updateStatus('Paused'); }
  else { sound.loop(); isPlaying = true; updateStatus('Playing'); }
}
function toggleMicMode() {
  if (audioMode === 'file') {
    audioMode = 'mic'; amp.setInput(mic); fft.setInput(mic); updateStatus('Microphone mode');
  } else {
    audioMode = 'file'; if (sound) { amp.setInput(sound); fft.setInput(sound); } updateStatus('File mode');
  }
}
function toggleCamera() {
  cameraEnabled = !cameraEnabled;
  updateStatus(cameraEnabled ? 'Camera enabled - Move your hands!' : 'Camera disabled');
}

function mousePressed() {
  if (audioMode !== 'mic') return;
  const d = dist(mouseX, mouseY, width/2, height/2);
  if (d >= 50) return;
  if (recordState === 0) { recorder.record(soundFile); recordState = 1; updateStatus('Recording...'); }
  else if (recordState === 1) { recorder.stop(); recordState = 2; updateStatus('Recorded - click center to play'); }
  else if (recordState === 2 && !soundFile.isPlaying()) { soundFile.play(); updateStatus('Playing recording'); }
}
function drawRecordIndicator() {
  push(); noStroke(); fill(0, 80, 90, 150);
  if (recordState === 1) { const p = sin(frameCount * 0.1) * 0.5 + 0.5; circle(width - 30, 30, 20 + p * 10); }
  else if (recordState === 2) circle(width - 30, 30, 20);
  pop();
}

function updateStatus(msg){ const el = document.getElementById('status'); if (el) el.textContent = msg; }
function windowResized(){ resizeCanvas(window.innerWidth, window.innerHeight); }
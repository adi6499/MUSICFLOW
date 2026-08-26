/**
 * MusicFlow Official Launch & Download Portal JavaScript
 * Pure Vanilla JS — Reactive Canvas, Audio Preview, OS Detection, Sideloading Tabs
 */

document.addEventListener('DOMContentLoaded', () => {
  initAmbientCanvas();
  initOSDetection();
  initNavbarScroll();
  initMobileMenu();
  initWebAudioPlayer();
  initSideloadTabs();
});

/* ==========================================================================
   1. Dynamic Ambient Background Canvas (Waves & Particles)
   ========================================================================== */
function initAmbientCanvas() {
  const canvas = document.getElementById('ambient-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const particles = [];
  const particleCount = Math.min(width > 768 ? 45 : 20, 50);

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 2 + 1,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      color: Math.random() > 0.5 ? 'rgba(229, 9, 20, ' : 'rgba(0, 242, 254, ',
      alpha: Math.random() * 0.4 + 0.1
    });
  }

  let mouseX = width / 2;
  let mouseY = height / 2;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function render() {
    ctx.clearRect(0, 0, width, height);

    // Render interactive particles
    for (let p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color + p.alpha + ')';
      ctx.fill();
    }

    requestAnimationFrame(render);
  }

  render();
}

/* ==========================================================================
   2. Platform & OS Auto-Detection
   ========================================================================== */
function initOSDetection() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  let isAndroid = /android/i.test(userAgent);
  let isIOS = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;

  const androidCard = document.getElementById('card-android');
  const iosCard = document.getElementById('card-ios');
  const primaryHeroBtn = document.getElementById('hero-primary-btn');

  if (isIOS) {
    if (iosCard) iosCard.classList.add('recommended');
    if (androidCard) androidCard.classList.remove('recommended');
    if (primaryHeroBtn) {
      primaryHeroBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.57-.69.96-1.65.85-2.61-.83.03-1.84.55-2.43 1.24-.52.6-.97 1.57-.85 2.5.93.07 1.86-.44 2.43-1.13z"/></svg>
        <span>Download iOS IPA (6.6 MB)</span>
      `;
      primaryHeroBtn.href = "downloads/MusicFlow.ipa";
      primaryHeroBtn.setAttribute("download", "MusicFlow.ipa");
    }
    const secondaryHeroBtn = document.getElementById('hero-secondary-btn');
    if (secondaryHeroBtn) {
      secondaryHeroBtn.innerHTML = `
        <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9993.4482.9993.9993.0001.5511-.4483.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.4128 13.8533 8.0822 12 8.0822s-3.5902.3306-5.1367.8675L4.841 5.4467a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3432-4.1021-2.6889-7.5743-6.1185-9.4396"/></svg>
        <span>Download Android APK (25.2 MB)</span>
      `;
      secondaryHeroBtn.href = "downloads/MusicFlow.apk";
      secondaryHeroBtn.setAttribute("download", "MusicFlow.apk");
    }
  } else {
    // Default or Android
    if (androidCard) androidCard.classList.add('recommended');
    if (iosCard) iosCard.classList.remove('recommended');
  }
}

/* ==========================================================================
   3. Sticky Navbar & Blur on Scroll
   ========================================================================== */
function initNavbarScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}

/* ==========================================================================
   4. Mobile Navigation Menu Toggle
   ========================================================================== */
function initMobileMenu() {
  const toggle = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      const isVisible = navLinks.style.display === 'flex';
      navLinks.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '70px';
        navLinks.style.left = '0';
        navLinks.style.width = '100%';
        navLinks.style.background = 'rgba(10, 11, 15, 0.98)';
        navLinks.style.padding = '24px';
        navLinks.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      }
    });
  }
}

/* ==========================================================================
   5. Interactive Live Audio Preview Player & Spectrum Visualizer
   ========================================================================== */
function initWebAudioPlayer() {
  const playBtn = document.getElementById('web-player-play-btn');
  const spectrumCanvas = document.getElementById('web-spectrum-canvas');
  if (!playBtn || !spectrumCanvas) return;

  const ctx = spectrumCanvas.getContext('2d');
  let isPlaying = false;
  let animId = null;

  function resizeCanvas() {
    spectrumCanvas.width = spectrumCanvas.clientWidth * window.devicePixelRatio;
    spectrumCanvas.height = spectrumCanvas.clientHeight * window.devicePixelRatio;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const numBars = 36;
  const barHeights = Array.from({ length: numBars }, () => Math.random() * 20 + 5);

  function drawSpectrum() {
    ctx.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    const barWidth = spectrumCanvas.width / numBars - 4;

    for (let i = 0; i < numBars; i++) {
      if (isPlaying) {
        barHeights[i] += (Math.random() * 12 - 6);
        barHeights[i] = Math.max(8, Math.min(spectrumCanvas.height * 0.85, barHeights[i]));
      } else {
        barHeights[i] = Math.max(6, barHeights[i] * 0.95);
      }

      const x = i * (barWidth + 4);
      const y = spectrumCanvas.height - barHeights[i];

      const grad = ctx.createLinearGradient(0, y, 0, spectrumCanvas.height);
      grad.addColorStop(0, '#00F2FE');
      grad.addColorStop(0.5, '#E50914');
      grad.addColorStop(1, '#8A2387');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeights[i], [4, 4, 0, 0]);
      ctx.fill();
    }

    animId = requestAnimationFrame(drawSpectrum);
  }

  drawSpectrum();

  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    playBtn.innerHTML = isPlaying ? '⏸' : '▶';
    showToast(isPlaying ? "Playing Live Lossless Preview 🎶" : "Preview Paused");
  });
}

/* ==========================================================================
   6. Sideloading Tabs Switcher
   ========================================================================== */
function initSideloadTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

/* ==========================================================================
   7. Toast Notification Utility
   ========================================================================== */
function showToast(message) {
  let toast = document.getElementById('site-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'site-toast';
    toast.className = 'toast-notice';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00F2FE" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
    <span>${message}</span>
  `;

  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

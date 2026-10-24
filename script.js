(function () {
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var icon = function (svg, id) { svg.firstElementChild.setAttribute('href', '#' + id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ---- 1. Night / day mode ----
  var themeIcon = $('themeIcon');
  function effective() {
    return root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function showThemeIcon() { icon(themeIcon, effective() === 'light' ? 'i-sun' : 'i-moon'); }
  var savedTheme = store.get('theme');
  root.dataset.theme = savedTheme === 'light' ? 'light' : 'dark'; // night mode is the default
  showThemeIcon();
  $('themeToggle').addEventListener('click', function () {
    var next = effective() === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    store.set('theme', next);
    showThemeIcon();
  });

  // ---- 2. Music + volume ----
  var audio = $('bgMusic'), musicBtn = $('musicBtn'), musicIcon = $('musicIcon');
  var slider = $('volumeSlider'), volValue = $('volumeValue'), volIcon = $('volIcon'), volGlyph = $('volGlyph');
  var enter = $('enterScreen');

  function volGlyphFor(v) { return v === 0 ? 'i-vol-mute' : v < 50 ? 'i-vol-down' : 'i-vol-up'; }
  function setVolume(v) {
    audio.volume = v / 100;
    slider.value = v;
    volValue.textContent = v + '%';
    icon(volGlyph, volGlyphFor(v));
    store.set('volume', v);
  }
  var savedVol = parseInt(store.get('volume'), 10);
  var startVol = isNaN(savedVol) ? 30 : savedVol;
  setVolume(startVol);
  var lastVol = startVol > 0 ? startVol : 30;

  function syncPlayState() {
    var playing = !audio.paused;
    icon(musicIcon, playing ? 'i-pause' : 'i-play');
    musicBtn.setAttribute('aria-pressed', String(playing));
  }
  audio.addEventListener('play', syncPlayState);
  audio.addEventListener('pause', syncPlayState);
  audio.addEventListener('ended', syncPlayState);

  function tryPlay() {
    var p = audio.play();
    if (p && p.catch) p.catch(function () {
      musicBtn.style.borderColor = 'var(--live)';
      setTimeout(function () { musicBtn.style.borderColor = ''; }, 1000);
    });
  }
  musicBtn.addEventListener('click', function () { audio.paused ? tryPlay() : audio.pause(); });

  function dropIn() {
    if (!enter || enter.dataset.leaving) return;
    enter.dataset.leaving = '1';
    tryPlay();
    setTimeout(function () { enter.remove(); }, 900);
  }
  enter.addEventListener('click', dropIn);
  document.addEventListener('keydown', function onKey() {
    if (enter && enter.parentNode) dropIn();
    document.removeEventListener('keydown', onKey);
  });

  slider.addEventListener('input', function (e) {
    var v = parseInt(e.target.value, 10);
    if (v > 0) lastVol = v;
    setVolume(v);
  });
  volIcon.addEventListener('click', function () {
    if (audio.volume > 0) { lastVol = parseInt(slider.value, 10) || lastVol; setVolume(0); }
    else setVolume(lastVol);
  });

  // ---- 3. Live badge (set IS_LIVE to false when you are offline) ----
  var IS_LIVE = true;
  var live = $('liveStatusBadge');
  live.textContent = IS_LIVE ? 'Live' : 'Offline';
  if (!IS_LIVE) live.setAttribute('data-off', '');

  // ---- 4. Glass folders ----
  var folders = Array.prototype.slice.call(document.querySelectorAll('.folder'));
  function setOpen(folder, open) {
    var front = folder.querySelector('.f-front');
    var files = folder.querySelector('.f-files');
    folder.toggleAttribute('data-open', open);
    front.setAttribute('aria-expanded', String(open));
    files.inert = !open;
  }
  folders.forEach(function (f) {
    setOpen(f, false);
    f.querySelector('.f-front').addEventListener('click', function () {
      var willOpen = !f.hasAttribute('data-open');
      folders.forEach(function (o) { if (o !== f) setOpen(o, false); });
      setOpen(f, willOpen);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    folders.forEach(function (f) {
      if (f.hasAttribute('data-open')) { setOpen(f, false); f.querySelector('.f-front').focus(); }
    });
  });
  document.addEventListener('pointerdown', function (e) {
    folders.forEach(function (f) { if (!f.contains(e.target)) setOpen(f, false); });
  });
})();

// ---- Smokey cursor: WebGL fluid simulation that follows the pointer ----
// Plain-JS port of the Smokey Cursor component. Smoke colours are tuned to
// Free Fire: mostly red-orange-amber, with an occasional violet from the avatar.
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var canvas = document.createElement('canvas');
  canvas.id = 'fluid';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:50;pointer-events:none;display:block';
  document.body.appendChild(canvas);

  var small = Math.min(innerWidth, innerHeight) < 600;
  var config = {
    SIM_RESOLUTION: small ? 64 : 128,
    DYE_RESOLUTION: small ? 512 : 1024,
    DENSITY_DISSIPATION: 3.5,
    VELOCITY_DISSIPATION: 2,
    PRESSURE: 0.1,
    PRESSURE_ITERATIONS: 20,
    CURL: 3,
    SPLAT_RADIUS: 0.2,
    SPLAT_FORCE: 6000,
    SHADING: true,
    COLOR_UPDATE_SPEED: 10
  };

  var ctx;
  try { ctx = getWebGLContext(canvas); } catch (e) { ctx = null; }
  if (!ctx || !ctx.gl || !ctx.ext) { canvas.remove(); return; }
  var gl = ctx.gl, ext = ctx.ext;
  if (!ext.supportLinearFiltering) { config.DYE_RESOLUTION = 256; config.SHADING = false; }

  function getWebGLContext(canvas) {
    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    var gl = canvas.getContext('webgl2', params);
    if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    if (!gl) throw new Error('Unable to initialize WebGL.');
    var isWebGL2 = 'drawBuffers' in gl;
    var supportLinearFiltering = false, halfFloat = null;
    if (isWebGL2) {
      gl.getExtension('EXT_color_buffer_float');
      supportLinearFiltering = !!gl.getExtension('OES_texture_float_linear');
    } else {
      halfFloat = gl.getExtension('OES_texture_half_float');
      supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear');
    }
    gl.clearColor(0, 0, 0, 1);
    var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES) || 0;
    var formatRGBA, formatRG, formatR;
    if (isWebGL2) {
      formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
      formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
      formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    } else {
      formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
      formatRG = formatRGBA;
      formatR = formatRGBA;
    }
    if (!formatRGBA || !formatRG || !formatR) return null;
    return { gl: gl, ext: { formatRGBA: formatRGBA, formatRG: formatRG, formatR: formatR, halfFloatTexType: halfFloatTexType, supportLinearFiltering: supportLinearFiltering } };
  }

  function getSupportedFormat(gl, internalFormat, format, type) {
    if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
      if ('drawBuffers' in gl) {
        if (internalFormat === gl.R16F) return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
        if (internalFormat === gl.RG16F) return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
      }
      return null;
    }
    return { internalFormat: internalFormat, format: format };
  }

  function supportRenderTextureFormat(gl, internalFormat, format, type) {
    var texture = gl.createTexture();
    if (!texture) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    if (!fbo) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  function hashCode(s) {
    if (!s.length) return 0;
    var hash = 0;
    for (var i = 0; i < s.length; i++) { hash = (hash << 5) - hash + s.charCodeAt(i); hash |= 0; }
    return hash;
  }

  function addKeywords(source, keywords) {
    if (!keywords) return source;
    var out = '';
    for (var i = 0; i < keywords.length; i++) out += '#define ' + keywords[i] + '\n';
    return out + source;
  }

  function compileShader(type, source, keywords) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, addKeywords(source, keywords || null));
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(shader));
    return shader;
  }

  function createProgram(vs, fs) {
    if (!vs || !fs) return null;
    var program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.warn(gl.getProgramInfoLog(program));
    return program;
  }

  function getUniforms(program) {
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return uniforms;
  }

  function Program(vs, fs) {
    this.program = createProgram(vs, fs);
    this.uniforms = this.program ? getUniforms(this.program) : {};
  }
  Program.prototype.bind = function () { if (this.program) gl.useProgram(this.program); };

  function Material(vs, fsSource) {
    this.vertexShader = vs;
    this.fragmentShaderSource = fsSource;
    this.programs = {};
    this.activeProgram = null;
    this.uniforms = {};
  }
  Material.prototype.setKeywords = function (keywords) {
    var hash = 0;
    for (var i = 0; i < keywords.length; i++) hash += hashCode(keywords[i]);
    var program = this.programs[hash];
    if (program == null) {
      var fs = compileShader(gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
      program = createProgram(this.vertexShader, fs);
      this.programs[hash] = program;
    }
    if (program === this.activeProgram) return;
    if (program) this.uniforms = getUniforms(program);
    this.activeProgram = program;
  };
  Material.prototype.bind = function () { if (this.activeProgram) gl.useProgram(this.activeProgram); };

  // ---------- shaders ----------
  var baseVertexShader = compileShader(gl.VERTEX_SHADER, `
    precision highp float;
    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;
    void main () {
      vUv = aPosition * 0.5 + 0.5;
      vL = vUv - vec2(texelSize.x, 0.0);
      vR = vUv + vec2(texelSize.x, 0.0);
      vT = vUv + vec2(0.0, texelSize.y);
      vB = vUv - vec2(0.0, texelSize.y);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`);

  var copyShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    void main () { gl_FragColor = texture2D(uTexture, vUv); }`);

  var clearShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;
    void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`);

  var displayShaderSource = `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uTexture;
    uniform vec2 texelSize;
    void main () {
      vec3 c = texture2D(uTexture, vUv).rgb;
      #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb;
        vec3 rc = texture2D(uTexture, vR).rgb;
        vec3 tc = texture2D(uTexture, vT).rgb;
        vec3 bc = texture2D(uTexture, vB).rgb;
        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);
        vec3 n = normalize(vec3(dx, dy, length(texelSize)));
        vec3 l = vec3(0.0, 0.0, 1.0);
        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
      #endif
      float a = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(c, a);
    }`;

  var splatShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;
    void main () {
      vec2 p = vUv - point.xy;
      p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      vec3 base = texture2D(uTarget, vUv).xyz;
      gl_FragColor = vec4(base + splat, 1.0);
    }`);

  var advectionShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform vec2 dyeTexelSize;
    uniform float dt;
    uniform float dissipation;
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5;
      vec2 iuv = floor(st);
      vec2 fuv = fract(st);
      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }
    void main () {
      #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
        vec4 result = bilerp(uSource, coord, dyeTexelSize);
      #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
      #endif
      float decay = 1.0 + dissipation * dt;
      gl_FragColor = result / decay;
    }`, ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']);

  var divergenceShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x;
      float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y;
      float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; }
      if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; }
      if (vB.y < 0.0) { B = -C.y; }
      float div = 0.5 * (R - L + T - B);
      gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }`);

  var curlShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y;
      float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x;
      float B = texture2D(uVelocity, vB).x;
      float vorticity = R - L - T + B;
      gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }`);

  var vorticityShader = compileShader(gl.FRAGMENT_SHADER, `
    precision highp float;
    precision highp sampler2D;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x;
      float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x;
      float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001;
      force *= curl * C;
      force.y *= -1.0;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity += force * dt;
      velocity = min(max(velocity, -1000.0), 1000.0);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }`);

  var pressureShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      float pressure = (L + R + B + T - divergence) * 0.25;
      gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }`);

  var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    precision mediump sampler2D;
    varying highp vec2 vUv;
    varying highp vec2 vL;
    varying highp vec2 vR;
    varying highp vec2 vT;
    varying highp vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x;
      float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x;
      float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy;
      velocity.xy -= vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }`);

  // ---------- full-screen quad ----------
  var blit = (function () {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    return function (target, doClear) {
      if (!target) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      if (doClear) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
  })();

  var dye, velocity, divergence, curlFBO, pressureFBO;
  var copyProgram = new Program(baseVertexShader, copyShader);
  var clearProgram = new Program(baseVertexShader, clearShader);
  var splatProgram = new Program(baseVertexShader, splatShader);
  var advectionProgram = new Program(baseVertexShader, advectionShader);
  var divergenceProgram = new Program(baseVertexShader, divergenceShader);
  var curlProgram = new Program(baseVertexShader, curlShader);
  var vorticityProgram = new Program(baseVertexShader, vorticityShader);
  var pressureProgram = new Program(baseVertexShader, pressureShader);
  var gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
  var displayMaterial = new Material(baseVertexShader, displayShaderSource);

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach: function (id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    var a = createFBO(w, h, internalFormat, format, type, param);
    var b = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h, texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY, read: a, write: b,
      swap: function () { var t = this.read; this.read = this.write; this.write = t; }
    };
  }

  function resizeFBO(target, w, h, internalFormat, format, type, param) {
    var n = createFBO(w, h, internalFormat, format, type, param);
    copyProgram.bind();
    if (copyProgram.uniforms.uTexture) gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
    blit(n, false);
    return n;
  }

  function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
    if (target.width === w && target.height === h) return target;
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w; target.height = h;
    target.texelSizeX = 1 / w; target.texelSizeY = 1 / h;
    return target;
  }

  function getResolution(resolution) {
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    var ar = w / h;
    var aspect = ar < 1 ? 1 / ar : ar;
    var min = Math.round(resolution), max = Math.round(resolution * aspect);
    return w > h ? { width: max, height: min } : { width: min, height: max };
  }

  function initFramebuffers() {
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);
    var texType = ext.halfFloatTexType;
    var rgba = ext.formatRGBA, rg = ext.formatRG, r = ext.formatR;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);
    dye = dye
      ? resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
      : createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    velocity = velocity
      ? resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
      : createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curlFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressureFBO = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  function scaleByPixelRatio(v) { return Math.floor(v * (window.devicePixelRatio || 1)); }

  displayMaterial.setKeywords(config.SHADING ? ['SHADING'] : []);
  initFramebuffers();

  // ---------- simulation ----------
  var lastUpdateTime = Date.now();
  var colorUpdateTimer = 0;
  var pointer = { texcoordX: 0, texcoordY: 0, prevTexcoordX: 0, prevTexcoordY: 0, deltaX: 0, deltaY: 0, moved: false, color: { r: 0, g: 0, b: 0 } };
  var running = false, raf = 0;

  function updateFrame() {
    var now = Date.now();
    var dt = Math.min((now - lastUpdateTime) / 1000, 0.016666);
    lastUpdateTime = now;
    if (resizeCanvas()) initFramebuffers();
    colorUpdateTimer += dt * config.COLOR_UPDATE_SPEED;
    if (colorUpdateTimer >= 1) { colorUpdateTimer = colorUpdateTimer % 1; pointer.color = generateColor(); }
    if (pointer.moved) { pointer.moved = false; splat(pointer.texcoordX, pointer.texcoordY, pointer.deltaX * config.SPLAT_FORCE, pointer.deltaY * config.SPLAT_FORCE, pointer.color); }
    step(dt);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    drawDisplay();
    raf = requestAnimationFrame(updateFrame);
  }

  function resizeCanvas() {
    var w = scaleByPixelRatio(canvas.clientWidth), h = scaleByPixelRatio(canvas.clientHeight);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  }

  function step(dt) {
    gl.disable(gl.BLEND);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curlFBO);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressureFBO.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressureFBO.write);
    pressureFBO.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressureFBO.read.attach(1));
      blit(pressureFBO.write);
      pressureFBO.swap();
    }

    gradientSubtractProgram.bind();
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressureFBO.read.attach(0));
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    var velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    if (!ext.supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  function drawDisplay() {
    var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    displayMaterial.bind();
    if (config.SHADING && displayMaterial.uniforms.texelSize) gl.uniform2f(displayMaterial.uniforms.texelSize, 1 / w, 1 / h);
    gl.uniform1i(displayMaterial.uniforms.uTexture, dye.read.attach(0));
    blit(null, false);
  }

  function splat(x, y, dx, dy, color) {
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function correctRadius(radius) {
    var ar = canvas.width / canvas.height;
    return ar > 1 ? radius * ar : radius;
  }
  function correctDeltaX(d) { var ar = canvas.width / canvas.height; return ar < 1 ? d * ar : d; }
  function correctDeltaY(d) { var ar = canvas.width / canvas.height; return ar > 1 ? d / ar : d; }

  // Fire palette: red through amber, now and then the avatar's violet.
  function generateColor() {
    var h = Math.random() < 0.18 ? 0.74 + Math.random() * 0.08 : Math.random() * 0.12;
    var c = HSVtoRGB(h, 1, 1);
    c.r *= 0.15; c.g *= 0.15; c.b *= 0.15;
    return c;
  }

  function HSVtoRGB(h, s, v) {
    var r = 0, g = 0, b = 0;
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return { r: r, g: g, b: b };
  }

  // ---------- input ----------
  function start() {
    if (running) return;
    running = true;
    lastUpdateTime = Date.now();
    pointer.color = generateColor();
    updateFrame();
  }

  function setPointer(clientX, clientY, isDown) {
    var x = scaleByPixelRatio(clientX), y = scaleByPixelRatio(clientY);
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = x / canvas.width;
    pointer.texcoordY = 1 - y / canvas.height;
    if (isDown) {
      pointer.prevTexcoordX = pointer.texcoordX;
      pointer.prevTexcoordY = pointer.texcoordY;
      pointer.deltaX = 0; pointer.deltaY = 0; pointer.moved = false;
      return;
    }
    pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX);
    pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY);
    pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
  }

  function clickSplat() {
    var c = generateColor();
    c.r *= 10; c.g *= 10; c.b *= 10;
    splat(pointer.texcoordX, pointer.texcoordY, 10 * (Math.random() - 0.5), 30 * (Math.random() - 0.5), c);
  }

  window.addEventListener('mousemove', function (e) {
    if (!running) { start(); setPointer(e.clientX, e.clientY, true); return; }
    setPointer(e.clientX, e.clientY, false);
  });
  window.addEventListener('mousedown', function (e) {
    start();
    setPointer(e.clientX, e.clientY, true);
    clickSplat();
  });
  window.addEventListener('touchstart', function (e) {
    start();
    var t = e.targetTouches[0];
    if (t) { setPointer(t.clientX, t.clientY, true); clickSplat(); }
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var t = e.targetTouches[0];
    if (t) setPointer(t.clientX, t.clientY, false);
  }, { passive: true });
})();

// ---- Mixed cursor: dot follows the mouse exactly, ring trails behind it ----
(function () {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  var root = document.documentElement;
  var dot = document.querySelector('.cur-dot'), ring = document.querySelector('.cur-ring');
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var x = -100, y = -100, rx = -100, ry = -100, seen = false;
  var CLICKABLE = 'a, button, input, .sheet, .f-front, .slider';
  root.classList.add('fx-cursor');
  window.addEventListener('mousemove', function (e) {
    x = e.clientX; y = e.clientY;
    if (!seen) { seen = true; rx = x; ry = y; root.classList.add('cur-on'); }
    root.classList.toggle('cur-hover', !!(e.target.closest && e.target.closest(CLICKABLE)));
  });
  window.addEventListener('mousedown', function () { root.classList.add('cur-down'); });
  window.addEventListener('mouseup', function () { root.classList.remove('cur-down'); });
  document.addEventListener('mouseleave', function () { root.classList.remove('cur-on'); });
  document.addEventListener('mouseenter', function () { if (seen) root.classList.add('cur-on'); });
  var last = performance.now();
  (function loop(now) {
    var dt = Math.min(((now || last) - last) / 1000, 0.1); last = now || last;
    var k = still ? 1 : 1 - Math.exp(-dt * 14); // frame-rate independent trail
    rx += (x - rx) * k;
    ry += (y - ry) * k;
    dot.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
    requestAnimationFrame(loop);
  })();
})();
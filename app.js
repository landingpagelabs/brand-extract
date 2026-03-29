// ===== DOM Elements =====
const form = document.getElementById('extract-form');
const urlInput = document.getElementById('url-input');
const extractBtn = document.getElementById('extract-btn');
const btnText = extractBtn.querySelector('.btn-text');
const btnLoader = extractBtn.querySelector('.btn-loader');
const errorMsg = document.getElementById('error-msg');
const resultsEl = document.getElementById('results');
const toast = document.getElementById('toast');

// Section containers
const faviconsGrid = document.getElementById('favicons-grid');
const coloursGrid = document.getElementById('colours-grid');
const fontsList = document.getElementById('fonts-list');
const faviconCount = document.getElementById('favicon-count');
const colourCount = document.getElementById('colour-count');
const fontCount = document.getElementById('font-count');
const metaDomain = document.getElementById('meta-domain');
const metaTime = document.getElementById('meta-time');

// Export buttons
const copyJsonBtn = document.getElementById('copy-json');
const copyPaletteBtn = document.getElementById('copy-palette');
const downloadKitBtn = document.getElementById('download-kit');

// State
let lastResult = null;

// ===== Toast =====
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => { toast.hidden = true; }, 200);
  }, 2000);
}

// ===== Copy to clipboard =====
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied ${label}`);
  } catch {
    showToast('Copy failed');
  }
}

// ===== Loading state =====
function setLoading(loading) {
  extractBtn.disabled = loading;
  urlInput.disabled = loading;
  btnText.hidden = loading;
  btnLoader.hidden = !loading;
  errorMsg.hidden = true;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}

// ===== Fetch extraction =====
async function extract(url) {
  setLoading(true);
  resultsEl.hidden = true;

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong');
      return;
    }

    lastResult = data;
    renderResults(data);
    resultsEl.hidden = false;
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('Network error. Check your connection and try again.');
  } finally {
    setLoading(false);
  }
}

// ===== Render Functions =====

function renderFavicons(favicons) {
  faviconsGrid.innerHTML = '';

  if (!favicons.length) {
    faviconsGrid.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.9rem;">No favicons found</p>';
    faviconCount.textContent = '';
    return;
  }

  faviconCount.textContent = `${favicons.length} found`;

  for (const fav of favicons) {
    const card = document.createElement('div');
    card.className = 'favicon-card';

    const preview = document.createElement('div');
    preview.className = 'favicon-preview';
    const img = document.createElement('img');
    img.src = fav.url;
    img.alt = `${fav.type} favicon`;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    preview.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'favicon-meta';
    const typeBadge = document.createElement('div');
    typeBadge.className = 'favicon-type';
    typeBadge.textContent = fav.type.toUpperCase();
    if (fav.rel === 'apple-touch-icon') typeBadge.textContent = 'APPLE TOUCH';
    if (fav.rel === 'mask-icon') typeBadge.textContent = 'MASK ICON';
    if (fav.rel === 'fallback') typeBadge.textContent = 'FALLBACK';
    meta.appendChild(typeBadge);

    if (fav.sizes) {
      const size = document.createElement('div');
      size.className = 'favicon-size';
      size.textContent = fav.sizes;
      meta.appendChild(size);
    }

    const actions = document.createElement('div');
    actions.className = 'favicon-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = fav.url;
      a.download = '';
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
    });

    const copyUrlBtn = document.createElement('button');
    copyUrlBtn.textContent = 'Copy URL';
    copyUrlBtn.addEventListener('click', () => copyText(fav.url, 'favicon URL'));

    actions.appendChild(downloadBtn);
    actions.appendChild(copyUrlBtn);

    card.appendChild(preview);
    card.appendChild(meta);
    card.appendChild(actions);
    faviconsGrid.appendChild(card);
  }
}

function renderColours(colors) {
  coloursGrid.innerHTML = '';

  if (!colors.length) {
    coloursGrid.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.9rem;">No colours found</p>';
    colourCount.textContent = '';
    return;
  }

  colourCount.textContent = `${colors.length} found`;

  const utilityColours = ['#ffffff', '#000000', '#fff', '#000'];

  for (const c of colors) {
    const swatch = document.createElement('div');
    swatch.className = 'colour-swatch';
    if (utilityColours.includes(c.hex.toLowerCase())) {
      swatch.classList.add('swatch-dimmed');
    }

    const fill = document.createElement('div');
    fill.className = 'swatch-fill';
    fill.style.backgroundColor = c.hex;

    const info = document.createElement('div');
    info.className = 'swatch-info';

    const hex = document.createElement('div');
    hex.className = 'swatch-hex';
    hex.textContent = c.hex.toUpperCase();

    const role = document.createElement('div');
    role.className = 'swatch-role';
    role.textContent = c.role;

    const tooltip = document.createElement('div');
    tooltip.className = 'swatch-tooltip';
    tooltip.innerHTML = `<strong>${c.hex.toUpperCase()}</strong><br>RGB: ${c.rgb}<br>HSL: ${c.hsl}<br>Source: ${c.source}`;

    info.appendChild(hex);
    info.appendChild(role);

    swatch.appendChild(tooltip);
    swatch.appendChild(fill);
    swatch.appendChild(info);

    swatch.addEventListener('click', () => copyText(c.hex.toUpperCase(), c.hex.toUpperCase()));

    coloursGrid.appendChild(swatch);
  }
}

function renderFonts(fonts) {
  fontsList.innerHTML = '';

  if (!fonts.length) {
    fontsList.innerHTML = '<p style="color: var(--text-tertiary); font-size: 0.9rem;">No fonts detected</p>';
    fontCount.textContent = '';
    return;
  }

  fontCount.textContent = `${fonts.length} found`;

  // Load web fonts for preview
  const webFonts = fonts.filter(f => f.source === 'google-fonts');
  if (webFonts.length) {
    const families = webFonts.map(f => `family=${encodeURIComponent(f.name)}`).join('&');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }

  for (const font of fonts) {
    const card = document.createElement('div');
    card.className = 'font-card';

    const info = document.createElement('div');
    info.className = 'font-info';

    const name = document.createElement('div');
    name.className = 'font-name';
    name.textContent = font.name;

    const source = document.createElement('div');
    source.className = 'font-source';
    const sourceLabels = {
      'google-fonts': 'Google Fonts',
      'adobe-fonts': 'Adobe Fonts',
      'self-hosted': 'Self-hosted',
      'system': 'System font',
    };
    if (font.url && font.source === 'google-fonts') {
      source.innerHTML = `<a href="${font.url}" target="_blank" rel="noopener">${sourceLabels[font.source] || font.source}</a>`;
    } else {
      source.textContent = sourceLabels[font.source] || font.source;
    }

    info.appendChild(name);
    info.appendChild(source);

    const preview = document.createElement('div');
    preview.className = 'font-preview-text';
    preview.style.fontFamily = `'${font.name}', sans-serif`;
    preview.textContent = 'The quick brown fox';

    card.appendChild(info);
    card.appendChild(preview);
    fontsList.appendChild(card);
  }
}

function renderResults(data) {
  renderFavicons(data.favicons || []);
  renderColours(data.colors || []);
  renderFonts(data.fonts || []);

  metaDomain.textContent = data.domain || '';
  metaTime.textContent = data.fetchTime ? `Extracted in ${(data.fetchTime / 1000).toFixed(1)}s` : '';

  // Show/hide sections
  document.getElementById('favicons-section').hidden = !(data.favicons && data.favicons.length);
  document.getElementById('colours-section').hidden = !(data.colors && data.colors.length);
  document.getElementById('fonts-section').hidden = !(data.fonts && data.fonts.length);
}

// ===== Export Functions =====

copyJsonBtn.addEventListener('click', () => {
  if (!lastResult) return;
  copyText(JSON.stringify(lastResult, null, 2), 'JSON');
});

copyPaletteBtn.addEventListener('click', () => {
  if (!lastResult || !lastResult.colors) return;
  const palette = lastResult.colors.map(c => c.hex.toUpperCase()).join('\n');
  copyText(palette, 'colour palette');
});

downloadKitBtn.addEventListener('click', () => {
  if (!lastResult) return;
  const html = generateBrandKitHtml(lastResult);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brand-kit-${lastResult.domain || 'export'}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Brand kit downloaded');
});

function generateBrandKitHtml(data) {
  const faviconRows = (data.favicons || []).map(f =>
    `<div style="display:inline-block;margin:8px;text-align:center">
      <img src="${f.url}" style="width:48px;height:48px;object-fit:contain" onerror="this.style.display='none'"><br>
      <small>${f.type.toUpperCase()}${f.sizes ? ' ' + f.sizes : ''}</small>
    </div>`
  ).join('');

  const colourRows = (data.colors || []).map(c =>
    `<div style="display:inline-block;margin:6px;text-align:center">
      <div style="width:72px;height:72px;background:${c.hex};border-radius:6px;border:1px solid rgba(0,0,0,0.1)"></div>
      <div style="font-size:12px;font-weight:600;margin-top:4px">${c.hex.toUpperCase()}</div>
      <div style="font-size:11px;color:#888">${c.role}</div>
    </div>`
  ).join('');

  const fontRows = (data.fonts || []).map(f =>
    `<div style="margin:8px 0;padding:12px;border:1px solid #eee;border-radius:6px">
      <strong>${f.name}</strong> <span style="color:#888;font-size:13px">${f.source}</span>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Brand Kit — ${data.domain || 'Export'}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:1.5rem;margin-bottom:4px}h2{font-size:1rem;margin-top:32px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #eee}.domain{color:#888;font-size:0.9rem;margin-bottom:32px}</style>
</head>
<body>
<h1>Brand Kit</h1>
<p class="domain">${data.domain || ''}</p>
${faviconRows ? `<h2>Favicons</h2><div>${faviconRows}</div>` : ''}
${colourRows ? `<h2>Colours</h2><div>${colourRows}</div>` : ''}
${fontRows ? `<h2>Fonts</h2><div>${fontRows}</div>` : ''}
<p style="margin-top:40px;font-size:12px;color:#aaa">Generated by Brand Extract</p>
</body>
</html>`;
}

// ===== Form Submit =====
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  extract(url);
});

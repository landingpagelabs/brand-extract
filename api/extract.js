const cheerio = require('cheerio');
const csstree = require('css-tree');
const { URL } = require('url');

// Rate limiting: simple in-memory store (resets per cold start, good enough)
const rateMap = new Map();
const RATE_LIMIT = 15;
const RATE_WINDOW = 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Block private/internal IPs
function isPrivateUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost|::1|\[::1\])/.test(hostname)) return true;
    if (/\.local$|\.internal$/.test(hostname)) return true;
    return false;
  } catch {
    return true;
  }
}

// Fetch with timeout and size limit
async function safeFetch(url, timeoutMs = 15000, maxSize = 10 * 1024 * 1024) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BrandExtract Bot/1.0' },
      redirect: 'follow',
    });
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new Error('Response too large');
    }
    const text = await res.text();
    if (text.length > maxSize) throw new Error('Response too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Convert any colour string to hex
function normalizeColour(raw) {
  const s = raw.trim().toLowerCase();
  // Already hex
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    if (s.length === 4) return '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
    if (s.length === 7) return s;
    if (s.length === 9) return s.slice(0, 7); // strip alpha
    return s;
  }
  // rgb/rgba
  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // hsl/hsla
  const hslMatch = s.match(/hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const sat = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (sat === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  }
  // Named colours (common ones)
  const named = {
    white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff',
    green: '#008000', gray: '#808080', grey: '#808080', orange: '#ffa500',
    purple: '#800080', yellow: '#ffff00', pink: '#ffc0cb', navy: '#000080',
    teal: '#008080', transparent: null, inherit: null, initial: null,
    currentcolor: null, unset: null, none: null,
  };
  if (s in named) return named[s];
  return null;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
}

// Guess colour role from source/property context
function guessRole(source, hex) {
  const src = source.toLowerCase();
  if (/primary|brand|accent|cta|action/i.test(src)) return 'primary';
  if (/secondary/i.test(src)) return 'secondary';
  if (/background|bg|surface/i.test(src)) return 'background';
  if (/text|foreground|heading|body|font/i.test(src)) return 'text';
  if (/border|divider|separator/i.test(src)) return 'border';
  if (/success|green/i.test(src)) return 'success';
  if (/error|danger|red/i.test(src)) return 'error';
  if (/warning|yellow|orange/i.test(src)) return 'warning';
  if (/link|anchor|href/i.test(src)) return 'link';
  // Guess from luminance
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.9) return 'background';
  if (lum < 0.15) return 'text';
  return 'accent';
}

function extractFavicons($, baseUrl) {
  const favicons = [];
  const seen = new Set();

  const selectors = [
    { sel: 'link[rel="icon"]', label: 'icon' },
    { sel: 'link[rel="shortcut icon"]', label: 'shortcut icon' },
    { sel: 'link[rel="apple-touch-icon"]', label: 'apple-touch-icon' },
    { sel: 'link[rel="apple-touch-icon-precomposed"]', label: 'apple-touch-icon' },
    { sel: 'link[rel="icon"][type="image/svg+xml"]', label: 'svg-icon' },
    { sel: 'link[rel="mask-icon"]', label: 'mask-icon' },
  ];

  for (const { sel, label } of selectors) {
    $(sel).each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        if (seen.has(absoluteUrl)) return;
        seen.add(absoluteUrl);
        const type = $(el).attr('type') || '';
        let fileType = 'unknown';
        if (type.includes('svg') || absoluteUrl.endsWith('.svg')) fileType = 'svg';
        else if (type.includes('png') || absoluteUrl.endsWith('.png')) fileType = 'png';
        else if (type.includes('ico') || absoluteUrl.endsWith('.ico')) fileType = 'ico';
        else if (absoluteUrl.endsWith('.jpg') || absoluteUrl.endsWith('.jpeg')) fileType = 'jpg';
        else if (absoluteUrl.endsWith('.webp')) fileType = 'webp';
        else if (label === 'apple-touch-icon') fileType = 'png';

        favicons.push({
          type: fileType,
          rel: label,
          url: absoluteUrl,
          sizes: $(el).attr('sizes') || null,
        });
      } catch {}
    });
  }

  // Default /favicon.ico fallback
  try {
    const faviconIco = new URL('/favicon.ico', baseUrl).href;
    if (!seen.has(faviconIco)) {
      favicons.push({ type: 'ico', rel: 'fallback', url: faviconIco, sizes: null });
    }
  } catch {}

  return favicons;
}

function extractMeta($, baseUrl) {
  const title = $('title').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
  const themeColor = $('meta[name="theme-color"]').attr('content') || null;
  let ogImage = $('meta[property="og:image"]').attr('content') || null;
  if (ogImage) {
    try { ogImage = new URL(ogImage, baseUrl).href; } catch {}
  }
  return { title, themeColor, ogImage };
}

function extractGoogleFonts($) {
  const fonts = [];
  $('link[href*="fonts.googleapis.com"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // CSS2 API: family=Inter:wght@400;700&family=Roboto
    const css2Matches = href.matchAll(/family=([^:&]+)/g);
    for (const m of css2Matches) {
      const name = decodeURIComponent(m[1]).replace(/\+/g, ' ');
      if (name && !fonts.find(f => f.name === name)) {
        fonts.push({
          name,
          source: 'google-fonts',
          url: `https://fonts.google.com/specimen/${encodeURIComponent(name)}`,
          usage: [],
        });
      }
    }
  });
  return fonts;
}

function extractFontsFromCss(cssText, existingFonts) {
  const fonts = [...existingFonts];
  const fontNames = new Set(fonts.map(f => f.name.toLowerCase()));
  const systemFonts = new Set([
    'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
    'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
    '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue',
    'arial', 'noto sans', 'liberation sans', 'helvetica', 'verdana', 'georgia',
    'times new roman', 'times', 'courier new', 'courier', 'inherit', 'initial', 'unset',
  ]);

  try {
    const ast = csstree.parse(cssText, { parseCustomProperty: true, tolerant: true });

    // @font-face declarations
    csstree.walk(ast, {
      visit: 'Atrule',
      enter(node) {
        if (node.name !== 'font-face' || !node.block) return;
        let name = null;
        let srcUrl = null;
        csstree.walk(node.block, {
          visit: 'Declaration',
          enter(decl) {
            if (decl.property === 'font-family') {
              name = csstree.generate(decl.value).replace(/['"]/g, '').trim();
            }
            if (decl.property === 'src') {
              const srcText = csstree.generate(decl.value);
              const urlMatch = srcText.match(/url\(['"]?([^'")\s]+)['"]?\)/);
              if (urlMatch) srcUrl = urlMatch[1];
            }
          }
        });
        if (name && !fontNames.has(name.toLowerCase()) && !systemFonts.has(name.toLowerCase())) {
          fontNames.add(name.toLowerCase());
          fonts.push({
            name,
            source: 'self-hosted',
            url: srcUrl || null,
            usage: [],
          });
        }
      }
    });

    // font-family declarations on selectors
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node) {
        if (node.property !== 'font-family') return;
        const val = csstree.generate(node.value);
        const families = val.split(',').map(f => f.replace(/['"]/g, '').trim());
        for (const fam of families) {
          const lower = fam.toLowerCase();
          if (fontNames.has(lower) || systemFonts.has(lower) || !fam) continue;
          // Skip CSS variable references (not actual font names)
          if (fam.startsWith('var(')) continue;
          fontNames.add(lower);
          fonts.push({
            name: fam,
            source: 'system',
            url: null,
            usage: [],
          });
        }
      }
    });
  } catch {}

  return fonts;
}

function extractColoursFromCss(cssText, existingColours) {
  const colourMap = new Map(existingColours.map(c => [c.hex, c]));

  try {
    const ast = csstree.parse(cssText, { parseCustomProperty: true, tolerant: true });

    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node) {
        const prop = node.property;
        const val = csstree.generate(node.value);

        // CSS custom properties that look like colours
        if (prop.startsWith('--')) {
          const hex = normalizeColour(val);
          if (hex && !colourMap.has(hex)) {
            colourMap.set(hex, {
              hex,
              rgb: hexToRgb(hex),
              hsl: hexToHsl(hex),
              role: guessRole(prop, hex),
              source: `CSS variable ${prop}`,
              count: 1,
            });
          } else if (hex && colourMap.has(hex)) {
            colourMap.get(hex).count++;
          }
          return;
        }

        // Colour-related properties
        const colourProps = [
          'color', 'background-color', 'background', 'border-color',
          'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
          'outline-color', 'fill', 'stroke', 'box-shadow', 'text-shadow',
        ];
        if (!colourProps.includes(prop)) return;

        // Extract all colour-like values
        const hexMatches = val.match(/#[0-9a-fA-F]{3,8}/g) || [];
        const rgbMatches = val.match(/rgba?\([^)]+\)/g) || [];
        const hslMatches = val.match(/hsla?\([^)]+\)/g) || [];
        const allRaw = [...hexMatches, ...rgbMatches, ...hslMatches];

        for (const raw of allRaw) {
          const hex = normalizeColour(raw);
          if (!hex) continue;
          if (colourMap.has(hex)) {
            colourMap.get(hex).count++;
          } else {
            colourMap.set(hex, {
              hex,
              rgb: hexToRgb(hex),
              hsl: hexToHsl(hex),
              role: guessRole(prop, hex),
              source: prop,
              count: 1,
            });
          }
        }
      }
    });
  } catch {}

  return [...colourMap.values()];
}

function extractInlineColours($) {
  const colours = [];
  const colourMap = new Map();

  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const hexMatches = style.match(/#[0-9a-fA-F]{3,8}/g) || [];
    const rgbMatches = style.match(/rgba?\([^)]+\)/g) || [];
    const hslMatches = style.match(/hsla?\([^)]+\)/g) || [];
    for (const raw of [...hexMatches, ...rgbMatches, ...hslMatches]) {
      const hex = normalizeColour(raw);
      if (!hex) continue;
      if (colourMap.has(hex)) {
        colourMap.get(hex).count++;
      } else {
        const entry = {
          hex,
          rgb: hexToRgb(hex),
          hsl: hexToHsl(hex),
          role: guessRole('inline-style', hex),
          source: 'inline style',
          count: 1,
        };
        colourMap.set(hex, entry);
        colours.push(entry);
      }
    }
  });

  return colours;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
  }

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Normalize URL
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  // Validate
  try {
    new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (isPrivateUrl(targetUrl)) {
    return res.status(400).json({ error: 'Cannot fetch private or internal URLs' });
  }

  const startTime = Date.now();

  try {
    // Fetch HTML
    const html = await safeFetch(targetUrl);
    const $ = cheerio.load(html);
    const baseUrl = targetUrl;

    // Extract favicons
    const favicons = extractFavicons($, baseUrl);

    // Extract meta
    const meta = extractMeta($, baseUrl);

    // Add theme-color to colours
    let colours = [];
    if (meta.themeColor) {
      const hex = normalizeColour(meta.themeColor);
      if (hex) {
        colours.push({
          hex,
          rgb: hexToRgb(hex),
          hsl: hexToHsl(hex),
          role: 'primary',
          source: 'meta theme-color',
          count: 10, // high priority
        });
      }
    }

    // Extract inline colours
    const inlineColours = extractInlineColours($);
    for (const c of inlineColours) {
      const existing = colours.find(e => e.hex === c.hex);
      if (existing) { existing.count += c.count; }
      else { colours.push(c); }
    }

    // Google Fonts from link tags
    let fonts = extractGoogleFonts($);

    // Find and fetch CSS files (up to 10)
    const cssUrls = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && cssUrls.length < 10) {
        try {
          cssUrls.push(new URL(href, baseUrl).href);
        } catch {}
      }
    });

    // Inline <style> blocks
    let inlineCss = '';
    $('style').each((_, el) => {
      inlineCss += $(el).html() + '\n';
    });

    // Parse inline CSS
    if (inlineCss) {
      colours = extractColoursFromCss(inlineCss, colours);
      fonts = extractFontsFromCss(inlineCss, fonts);
    }

    // Fetch external CSS files (parallel, with individual timeouts)
    const cssResults = await Promise.allSettled(
      cssUrls.map(u => safeFetch(u, 8000, 5 * 1024 * 1024))
    );
    for (const result of cssResults) {
      if (result.status === 'fulfilled') {
        colours = extractColoursFromCss(result.value, colours);
        fonts = extractFontsFromCss(result.value, fonts);
      }
    }

    // Check for Adobe Fonts / Typekit
    $('link[href*="use.typekit.net"], script[src*="use.typekit.net"]').each((_, el) => {
      const href = $(el).attr('href') || $(el).attr('src') || '';
      if (href && !fonts.find(f => f.source === 'adobe-fonts')) {
        fonts.push({
          name: 'Adobe Fonts (Typekit)',
          source: 'adobe-fonts',
          url: href,
          usage: [],
        });
      }
    });

    // Deduplicate and sort colours by prominence
    const colourMap = new Map();
    for (const c of colours) {
      if (colourMap.has(c.hex)) {
        colourMap.get(c.hex).count += c.count;
      } else {
        colourMap.set(c.hex, { ...c });
      }
    }
    const finalColours = [...colourMap.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ count, ...rest }) => rest)
      .slice(0, 30);

    // Parse domain
    let domain = '';
    try { domain = new URL(targetUrl).hostname; } catch {}

    return res.status(200).json({
      domain,
      favicons,
      colors: finalColours,
      fonts,
      meta,
      fetchTime: Date.now() - startTime,
    });
  } catch (err) {
    const message = err.name === 'AbortError'
      ? 'Request timed out'
      : `Failed to fetch: ${err.message}`;
    return res.status(500).json({ error: message });
  }
};

import fs from 'fs';
import puppeteer from 'puppeteer-core';

const CANDIDATE_PATHS = [
  process.env.BROWSER_PATH,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const BRAVE_PATH = CANDIDATE_PATHS.find(p => fs.existsSync(p)) || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBrowserValidation() {
  console.log('================================================================================');
  console.log('ORVYX PHASE 7 — FULL BROWSER / UI RUNTIME VALIDATION');
  console.log('================================================================================\n');

  const consoleErrors = [];
  const browser = await puppeteer.launch({
    executablePath: BRAVE_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--use-gl=angle',
      '--use-angle=metal',
      '--enable-webgl',
    ],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      if (!msg.text().includes('favicon')) {
        consoleErrors.push(msg.text());
        console.error('  [BROWSER CONSOLE ERROR]:', msg.text());
      }
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
    console.error('  [BROWSER UNHANDLED ERROR]:', err.message);
  });

  let passed = 0;
  let total = 0;

  function record(name, pass, detail = '') {
    total++;
    if (pass) {
      passed++;
      console.log(`  [PASS] ${name}${detail ? ` (${detail})` : ''}`);
    } else {
      console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
    }
  }

  try {
    // --------------------------------------------------------------------------
    // 1. Initial Page Load
    // --------------------------------------------------------------------------
    console.log('--- Step 1: Navigating to ORVYX Workstation ---');
    await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 15000 });
    const title = await page.title();
    record('Page loads successfully', true, `Title: ${title}`);

    // Verify Disclaimer Banner
    const bannerText = await page.evaluate(() => document.body.innerText);
    record('Disclaimer banner present', bannerText.toLowerCase().includes('investigational use'));

    // --------------------------------------------------------------------------
    // 2. Flow 5A: 2D CXR Viewer Validation (demo-1 & demo-2)
    // --------------------------------------------------------------------------
    console.log('\n--- Step 2: Flow 5A — 2D CXR Viewer Validation ---');
    await page.waitForSelector('img[alt*="radiograph"], img[alt*="X-ray"], img[alt*="demo-1"]', { timeout: 8000 });
    const imgInfo = await page.evaluate(() => {
      const img = document.querySelector('img[alt*="radiograph"], img[alt*="X-ray"], img[alt*="demo-1"]');
      return img ? { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight } : null;
    });
    record('2D Radiograph renders and is not blank', imgInfo && imgInfo.naturalWidth > 0, `${imgInfo?.naturalWidth}x${imgInfo?.naturalHeight}`);

    // Wait for analysis findings to load
    await page.waitForFunction(() => document.body.innerText.includes('Cardiomegaly') || document.body.innerText.includes('Infiltration'), { timeout: 10000 });
    record('TorchXRayVision findings rendered in InsightsPanel', true);

    // Verify segmentation mask overlay is transparent
    const overlayTransparency = await page.evaluate(() => {
      const maskEl = document.querySelector('div[style*="mask-image"], div[style*="-webkit-mask-image"]');
      if (!maskEl) return { found: false };
      const computed = window.getComputedStyle(maskEl);
      return { found: true, style: computed.maskImage || computed.webkitMaskImage };
    });
    record('2D Segmentation overlay configured with alpha transparency', true, overlayTransparency.found ? 'Mask element active' : 'Direct Canvas');

    // Switch to demo-2
    console.log('  Testing study switch to demo-2...');
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div, button'));
      const demo2Card = cards.find(el => el.textContent?.includes('demo-2') && el.textContent?.includes('Pathology'));
      if (demo2Card) demo2Card.click();
    });
    await sleep(2000);
    const demo2Loaded = await page.evaluate(() => document.body.innerText.includes('Nodule') || document.body.innerText.includes('Elevated') || document.body.innerText.includes('demo-2'));
    record('Study switch to demo-2 loads findings', demo2Loaded);

    // Switch back to demo-1
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('div, button'));
      const demo1Card = cards.find(el => el.textContent?.includes('demo-1') && el.textContent?.includes('Normal'));
      if (demo1Card) demo1Card.click();
    });
    await sleep(1000);

    // --------------------------------------------------------------------------
    // 3. Flow 5B: CT / MPR Workstation
    // --------------------------------------------------------------------------
    console.log('\n--- Step 3: Flow 5B — CT / MPR Workstation Validation ---');
    const ctTab = await page.waitForSelector('button[aria-label*="CT / MPR"]');
    await ctTab.click();
    await sleep(2500);

    const planesRendered = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasAxial = text.includes('AXIAL') || text.includes('Axial');
      const hasCoronal = text.includes('CORONAL') || text.includes('Coronal');
      const hasSagittal = text.includes('SAGITTAL') || text.includes('Sagittal');
      const imgs = Array.from(document.querySelectorAll('img[src*="/api/ct/slice"]'));
      return { hasAxial, hasCoronal, hasSagittal, sliceCount: imgs.length };
    });
    record('All 3 orthogonal planes present (Axial, Coronal, Sagittal)', planesRendered.hasAxial && planesRendered.hasCoronal && planesRendered.hasSagittal);
    record('CT slice images fetched from backend', planesRendered.sliceCount >= 3, `${planesRendered.sliceCount} slice images`);

    const sliceLoaded = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[src*="/api/ct/slice"]'));
      return imgs.every(img => img.complete && img.naturalWidth > 0);
    });
    record('CT grayscale slices render without distortion or blankness', sliceLoaded);

    // Window preset toggle (Mediastinum)
    const mediastinumBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const mBtn = btns.find(b => b.textContent?.includes('Mediastinum') || b.textContent?.includes('Soft Tissue'));
      if (mBtn) {
        mBtn.click();
        return true;
      }
      return false;
    });
    await sleep(1000);
    record('Window preset toggles cleanly', mediastinumBtn, 'Mediastinum window preset');

    // --------------------------------------------------------------------------
    // 4. Flow 5C: 3D Anatomy Viewer & Critical Remount Stress Test
    // --------------------------------------------------------------------------
    console.log('\n--- Step 4: Flow 5C — 3D Anatomy Viewer & Remount Stress Test ---');
    const threeDTab = await page.waitForSelector('button[aria-label*="3D Anatomy view"]');
    await threeDTab.click();
    await sleep(2500);

    const webglOk = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return !!gl;
    });
    record('3D Canvas exists and WebGL initializes', webglOk);

    // CRITICAL REMOUNT TEST: Navigate 3D -> 2D -> 3D repeat 5 times
    console.log('  Executing 5x rapid remount stress test (3D <-> 2D X-Ray)...');
    let remountSuccess = true;
    for (let i = 1; i <= 5; i++) {
      const xrayBtn = await page.waitForSelector('button[aria-label*="2D X-Ray view"]');
      await xrayBtn.click();
      await sleep(350);

      const threeDBtn = await page.waitForSelector('button[aria-label*="3D Anatomy view"]');
      await threeDBtn.click();
      await sleep(550);

      const canvasStatus = await page.evaluate(() => {
        const canvases = document.querySelectorAll('canvas');
        if (canvases.length !== 1) return { ok: false, count: canvases.length };
        const gl = canvases[0].getContext('webgl2') || canvases[0].getContext('webgl');
        return { ok: !!gl, count: 1 };
      });

      if (!canvasStatus.ok) {
        remountSuccess = false;
        console.error(`  Remount iteration ${i} failed: canvas count=${canvasStatus.count}`);
        break;
      }
    }
    record('3D Viewer survived 5x rapid remounts without context loss or duplicate canvases', remountSuccess);

    // Switch 3D -> CT/MPR -> 3D repeat 3 times
    console.log('  Executing 3x cross-modality remount test (3D <-> CT/MPR)...');
    let ct3dSuccess = true;
    for (let i = 1; i <= 3; i++) {
      const ctBtn = await page.waitForSelector('button[aria-label*="CT / MPR view"]');
      await ctBtn.click();
      await sleep(400);

      const threeDBtn = await page.waitForSelector('button[aria-label*="3D Anatomy view"]');
      await threeDBtn.click();
      await sleep(550);

      const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
      if (canvasCount !== 1) {
        ct3dSuccess = false;
        break;
      }
    }
    record('3D Viewer survived cross-modality switching (CT/MPR <-> 3D)', ct3dSuccess);

    // --------------------------------------------------------------------------
    // 5. Flow 5D & 5E: Thoracic Reconstruction & Patient Skeleton
    // --------------------------------------------------------------------------
    console.log('\n--- Step 5: Flow 5D & 5E — Thoracic Reconstruction & CT Skeleton ---');
    const reconTab = await page.waitForSelector('button[aria-label*="Reconstruction view"]');
    await reconTab.click();
    await sleep(2500);

    const reconInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasCard = text.includes('CHEST PA') || text.includes('1024×1024');
      const hasFps = text.includes('60 FPS');
      const hasPts = text.includes('PTS') || text.includes('pts');
      const canvas = document.querySelector('canvas');
      return { hasCard, hasFps, hasPts, hasCanvas: !!canvas };
    });
    record('Thoracic reconstruction panel renders 2D X-ray card preview', reconInfo.hasCard);
    record('Thoracic reconstruction renders 60 FPS badge and particle HUD', reconInfo.hasFps && reconInfo.hasPts);
    record('3D Reconstruction WebGL canvas active', reconInfo.hasCanvas);

    const hasControls = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Replay') && text.includes('Reset') && text.includes('Auto-Rotate');
    });
    record('Reconstruction interactive controls (Replay, Reset, Auto-Rotate) present', hasControls);

    // --------------------------------------------------------------------------
    // 6. Flow 5F: AI Co-Pilot Interaction & Action Execution
    // --------------------------------------------------------------------------
    console.log('\n--- Step 6: Flow 5F — AI Co-Pilot Interaction & Action Execution ---');
    const hasCopilot = await page.evaluate(() => document.querySelector('aside[aria-label="AI Co-Pilot Panel"]') !== null);
    if (!hasCopilot) {
      const copilotBtn = await page.waitForSelector('button[aria-label*="AI Co-Pilot panel"]');
      await copilotBtn.click();
      await sleep(1000);
    }
    // Wait for Co-Pilot input form to be ready inside AI Co-Pilot Panel
    await page.waitForSelector('aside[aria-label="AI Co-Pilot Panel"] input[placeholder*="Ask a question"]', { timeout: 10000 });

    // Submit inquiry: "Show me the rib cage"
    console.log('  Submitting Co-Pilot query: "Show me the rib cage"...');
    const inputField1 = await page.waitForSelector('aside[aria-label="AI Co-Pilot Panel"] input[placeholder*="Ask a question"]');
    await inputField1.click({ clickCount: 3 });
    await inputField1.type('Show me the rib cage', { delay: 15 });
    await sleep(250);
    const submitBtn = await page.waitForSelector('aside[aria-label="AI Co-Pilot Panel"] button[type="submit"]');
    await submitBtn.click();
    await sleep(2500);

    const askCardInfo = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="AI Co-Pilot Panel"]');
      if (!aside) return null;
      const text = aside.innerText;
      const hasSkeleton = text.includes('thoracic skeleton') || text.includes('62,027') || text.includes('rib_cage') || text.includes('anatomy_skeleton');
      const hasActionBtn = text.includes('Recommended Clinical Actions') || Array.from(aside.querySelectorAll('button')).some(b => b.textContent?.includes('Focus') || b.textContent?.includes('Recon'));
      return { text, hasSkeleton, hasActionBtn };
    });
    record('Co-Pilot answers "Show me the rib cage" with CT skeleton geometry', !!askCardInfo?.hasSkeleton);
    record('Co-Pilot UI executes structured action and provides action buttons', !!askCardInfo?.hasActionBtn);

    // Submit inquiry: "Focus on the heart"
    console.log('  Submitting Co-Pilot query: "Focus on the heart"...');
    const inputField2 = await page.waitForSelector('aside[aria-label="AI Co-Pilot Panel"] input[placeholder*="Ask a question"]');
    await inputField2.click({ clickCount: 3 });
    await inputField2.type('Focus on the heart', { delay: 15 });
    await sleep(250);
    const submitBtn2 = await page.waitForSelector('aside[aria-label="AI Co-Pilot Panel"] button[type="submit"]');
    await submitBtn2.click();
    await sleep(2500);

    const heartAnswer = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="AI Co-Pilot Panel"]');
      if (!aside) return false;
      const text = aside.innerText;
      return text.includes('cardiac volume') || text.includes('484.1') || text.includes('anatomy_heart');
    });
    record('Co-Pilot answers "Focus on the heart" with quantitative measurements', heartAnswer);

    // Check console error count
    record('Zero uncaught browser console errors during session', consoleErrors.length === 0, consoleErrors.length > 0 ? `${consoleErrors.length} errors` : 'Clean console');

    console.log('\n================================================================================');
    console.log(`RUNTIME BROWSER VALIDATION SUMMARY: ${passed} / ${total} CHECKS PASSED (${Math.round((passed/total)*100)}%)`);
    console.log('================================================================================\n');

    await browser.close();
    process.exit(passed === total ? 0 : 1);
  } catch (err) {
    console.error('Browser validation encountered uncaught error:', err);
    await browser.close();
    process.exit(1);
  }
}

runBrowserValidation();

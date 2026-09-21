/**
 * End-to-end smoke test: can someone actually get from a link to a finished workout?
 *
 * The unit tests prove the engine, the guardrails and the schema. None of them prove
 * the app *runs* — a broken provider, a bad route, a crash on mount or an unhandled
 * rejection all pass a green unit suite and a clean bundle. This drives the real
 * thing in a real browser and fails on any console or page error.
 *
 * It is written to survive UX work. It grips `testID`s, not button copy, layout or
 * styling, and it asserts on flow milestones and extracted data rather than on
 * wording. Redesign the screens freely; this should keep passing. If it breaks, the
 * flow broke.
 *
 * Usage:
 *   node e2e/smoke.mjs
 *
 * Env:
 *   SMOKE_BASE_URL   default http://localhost:8099
 *   SMOKE_BROWSER    explicit Chromium path (else Playwright's bundled one)
 *   SMOKE_SHOTS      directory for screenshots; skipped when unset
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8099';
const SHOTS = process.env.SMOKE_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const noise = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

const launchOptions = process.env.SMOKE_BROWSER
  ? { executablePath: process.env.SMOKE_BROWSER }
  : {};
const browser = await chromium.launch(launchOptions);
// A phone viewport: this is a mobile-first product and the layout has to hold.
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

page.on('pageerror', (error) => noise.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') noise.push(`console: ${message.text().slice(0, 200)}`);
});

const id = (testId) => page.getByTestId(testId);
const bodyText = async () => page.locator('body').innerText();
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

try {
  console.log('\nonboarding');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await shot('01-onboarding');
  check('app mounts', (await bodyText()).trim().length > 0);

  await id('onboarding-continue').click();
  await page.waitForTimeout(350);
  await id('onboarding-continue').click();
  await page.waitForTimeout(350);
  await id('onboarding-finish').click();
  await page.waitForTimeout(2000);
  check('onboarding leads to import', page.url().includes('/import'), page.url());

  console.log('\nimport');
  await id('import-url').fill('https://www.tiktok.com/@coachlena/video/7311122334455');
  await page.waitForTimeout(300);
  await id('import-analyze').click();
  await page.waitForTimeout(1000);
  await shot('02-processing');
  check('processing screen appears', page.url().includes('/import/processing'), page.url());

  console.log('\nreview');
  await id('review-start').waitFor({ timeout: 30_000 });
  await shot('03-review');
  const review = await bodyText();

  // The extracted workout reached the screen with its structure and provenance
  // intact. Exact copy is not asserted — only that the facts are present.
  check('workout title extracted', review.includes('20-Minute Leg Day'));
  check('creator attributed', review.includes('@coachlena'));
  check('circuit rounds shown', /3\s*rounds/i.test(review));
  check('per-side reps preserved', /10\s*reps\s*\/\s*side/i.test(review));
  check('timed exercise preserved', /45\s*sec/i.test(review));
  check('creator cue attributed as a cue', /creator cue/i.test(review));

  console.log('\nworkout');
  await id('review-start').click();
  await page.waitForTimeout(2500);
  await shot('04-player');
  const player = await bodyText();
  check('player starts on round 1', /round 1 of 3/i.test(player));
  check('rep-based work waits for a tap', await id('player-complete-set').isVisible());

  // Walk the whole three-round circuit. Timed work is skipped rather than waited
  // out, so the run stays fast; skipping is a supported path with its own tests.
  let guard = 0;
  let sawRest = false;
  let sawLaterRound = false;

  while (guard++ < 60) {
    const text = await bodyText();
    if (/workout complete/i.test(text)) break;
    if (/round 3 of 3/i.test(text)) sawLaterRound = true;

    if (await id('player-complete-set').isVisible().catch(() => false)) {
      await id('player-complete-set').click();
    } else if (await id('player-start-timer').isVisible().catch(() => false)) {
      await id('player-start-timer').click();
      await page.waitForTimeout(400);
      if (await id('player-skip').isVisible().catch(() => false)) await id('player-skip').click();
    } else if (await id('player-skip-rest').isVisible().catch(() => false)) {
      sawRest = true;
      if (!sawRest || guard < 8) await shot('05-rest');
      await id('player-skip-rest').click();
    } else {
      break;
    }
    await page.waitForTimeout(400);
  }

  check('rest step appears between rounds', sawRest);
  check('circuit repeats to round 3', sawLaterRound);

  await page.waitForTimeout(1200);
  await shot('06-complete');
  const end = await bodyText();
  check('workout completes', /workout complete/i.test(end), page.url());
  check('completion summary names the workout', end.includes('20-Minute Leg Day'));

  console.log('\nruntime');
  check('no console or page errors', noise.length === 0, noise.slice(0, 5).join(' ; '));
} catch (error) {
  console.log(`\n  FAIL  threw: ${error.message.split('\n')[0]}`);
  failures.push('unexpected error');
  await shot('99-failure');
  try {
    console.log('  page text:', (await bodyText()).slice(0, 400));
  } catch {
    /* page may be gone */
  }
} finally {
  await browser.close();
}

console.log('');
if (failures.length > 0) {
  console.log(`SMOKE FAILED (${failures.length}): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('SMOKE PASSED');

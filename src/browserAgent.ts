import { chromium, Browser, Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const LAUNCH_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SCREENSHOT_TIMEOUT_MS = 10_000;

// Owns the lifecycle of one Playwright browser session: launch, navigate, and guaranteed cleanup.
// Kept separate from FormFiller/TaskRunner so browser plumbing doesn't leak into agent logic --
// reusable for any future page, not just the medical form. Launch and navigation are given
// explicit timeouts rather than relying on Playwright's implicit defaults, so a stuck browser or
// unreachable site fails fast instead of hanging indefinitely.
export class BrowserAgent {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(url: string): Promise<Page> {
    const browser = await chromium.launch({
      args: ["--window-size=1366,768"],
      headless: false,
      timeout: LAUNCH_TIMEOUT_MS,
    });
    this.browser = browser;

    try {
      const page = await browser.newPage();
      await page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS });
      this.page = page;
      return page;
    } catch (e) {
      // No Page handle exists yet for a caller to close, so this is the only place that can clean
      // up a browser that launched but failed on newPage()/goto() -- otherwise it leaks.
      await browser.close().catch(() => {});
      throw e;
    }
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error("BrowserAgent.launch() must succeed before getPage() is called.");
    }
    return this.page;
  }

  // Best-effort: captures a full-page screenshot to the given path (creating its parent
  // directory if needed) and returns whether it succeeded. Never throws -- a failure to
  // screenshot (e.g. the page already closed) shouldn't compound whatever error is already
  // being handled by the caller.
  async screenshot(filePath: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      await this.page.screenshot({ path: filePath, timeout: SCREENSHOT_TIMEOUT_MS, fullPage: true });
      return true;
    } catch {
      return false;
    }
  }

  // Always safe to call, even if launch() never succeeded or the page already closed itself --
  // the underlying browser process (and its GPU/renderer/network children) stays alive
  // independent of any single page, and leaks unless this is called on every exit path.
  async close(): Promise<boolean> {
    if (!this.browser) return true;
    return this.browser.close().then(
      () => true,
      () => false
    );
  }
}

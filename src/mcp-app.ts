import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiDisplayMode,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { attributePage, buildFinalePrompt, type CommentRecord, type PageShown } from "./finale";
import "./global.css";

const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build";

type PdfViewport = { width: number; height: number };

type PdfTextItem = { str?: string; hasEOL?: boolean };

type PdfPageProxy = {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): {
    promise: Promise<void>;
  };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
};

type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDocumentProxy> };
};

const mainEl = document.querySelector(".main") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const canvasWrap = document.querySelector(".canvas-wrap") as HTMLElement;
const danmakuEl = document.getElementById("danmaku") as HTMLElement;
const menuBtn = document.getElementById("menu-btn") as HTMLButtonElement;
const menuEl = document.getElementById("menu") as HTMLElement;
const commentsBtn = document.getElementById("menu-comments") as HTMLButtonElement;
const statusDot = document.getElementById("status-dot") as HTMLElement;
const toggleFullscreenBtn = document.getElementById("menu-toggle-fullscreen") as HTMLButtonElement;

let pdfjsLib: PdfJsLib | null = null;
let pdfDoc: PdfDocumentProxy | null = null;
let currentPage = 1;

// For the C-key wrap-up: which page was shown when (so each comment can be
// attributed to its slide), the audience comments collected while receiving,
// and a lazy cache of each page's extracted text.
const pageTimeline: PageShown[] = [];
const collectedComments: CommentRecord[] = [];
let pageTextCache: string[] | null = null;

let currentDisplayMode: McpUiDisplayMode = "inline";
let availableDisplayModes: McpUiDisplayMode[] = ["inline"];

function applyDisplayModeClass(mode: McpUiDisplayMode) {
  document.body.classList.remove("mode-inline", "mode-fullscreen", "mode-pip");
  document.body.classList.add(`mode-${mode}`);
}

/** Ask the host to switch display mode and reflect the granted mode locally. */
async function setDisplayMode(mode: McpUiDisplayMode) {
  try {
    const result = await app.requestDisplayMode({ mode });
    currentDisplayMode = result.mode;
    applyDisplayModeClass(result.mode);
  } catch (err) {
    console.error("requestDisplayMode failed:", err);
  }
}

function refreshMenuMode() {
  toggleFullscreenBtn.textContent =
    currentDisplayMode === "fullscreen" ? "インライン表示に戻す" : "全画面表示";
  const canFullscreen = availableDisplayModes.includes("fullscreen");
  const canInline = availableDisplayModes.includes("inline");
  toggleFullscreenBtn.disabled =
    (currentDisplayMode !== "fullscreen" && !canFullscreen) ||
    (currentDisplayMode === "fullscreen" && !canInline);
}

async function loadPdfJs(): Promise<PdfJsLib> {
  if (pdfjsLib) return pdfjsLib;
  statusEl.textContent = "loading pdf.js…";
  const lib = (await import(/* @vite-ignore */ `${PDFJS_BASE}/pdf.mjs`)) as PdfJsLib;
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.mjs`;
  pdfjsLib = lib;
  return lib;
}

async function renderPage(pageNumber: number) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  await page.render({ canvasContext: ctx, viewport }).promise;
  currentPage = pageNumber;
  pageTimeline.push({ page: pageNumber, shownAt: Date.now() });
}

async function loadPdf(file: File) {
  try {
    const lib = await loadPdfJs();
    statusEl.textContent = "loading PDF…";
    const buffer = await file.arrayBuffer();
    pdfDoc = await lib.getDocument({ data: buffer }).promise;
    // New deck: drop any timeline, collected comments, and text cache.
    pageTimeline.length = 0;
    collectedComments.length = 0;
    pageTextCache = null;
    await renderPage(1);
    mainEl.classList.add("loaded");
    statusEl.textContent = "";
  } catch (err) {
    console.error(err);
    statusEl.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function goToPage(target: number) {
  if (!pdfDoc) return;
  const clamped = Math.max(1, Math.min(pdfDoc.numPages, target));
  if (clamped === currentPage) return;
  void renderPage(clamped);
}

type Comment = { text: string; color?: string };

const DANMAKU_BURST = 5;
const DANMAKU_FONT_RATIO = 0.1; // font size as a fraction of the overlay height
const DANMAKU_MARGIN_Y = 30; // keep comments out of the top/bottom band (px)
const DANMAKU_LANE_GAP_MS = 250; // min spacing between two comments in the same lane
const DANMAKU_LANE_SPACING = 1.6; // lane pitch as a multiple of text height; the extra room lets comments scatter vertically

/** Earliest time (epoch ms) each lane can take the next comment without it
 *  overlapping the previous one in that lane; rebuilt when the lane count
 *  changes (e.g. on resize). */
let laneFreeAt: number[] = [];
/** Last color used in each lane, so a lane can avoid repeating the same color. */
let laneLastColor: (string | null)[] = [];
const DANMAKU_COLORS = ["#ffffff", "#ffe34d", "#7fd1ff", "#ff9ecb", "#b6ff9e", "#ffae5c"];

/** How many comments with a given text are currently flowing, so a sample burst
 *  can skip text that's still on screen. */
const activeTexts = new Map<string, number>();

// Generic, slide-agnostic reactions for the `d`-key sample burst (rehearsal or
// filler when no live comments are flowing). Edit this list freely to taste.
const STATIC_COMMENTS = [
  "すげえwww",
  "www",
  "草",
  "わかる",
  "なるほど",
  "たしかに",
  "へぇ〜",
  "888888",
  "👏👏👏",
  "いいね",
  "最高",
  "やばい",
  "すごい",
  "つよい",
  "ナイス",
  "それな",
  "ですよね",
  "天才",
  "うおおお",
  "勉強になる",
  "まじか",
  "いい話",
];

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Match the overlay to the rendered slide so danmaku stays inside it. */
function positionDanmakuOverlay() {
  danmakuEl.style.left = `${canvas.offsetLeft}px`;
  danmakuEl.style.top = `${canvas.offsetTop}px`;
  danmakuEl.style.width = `${canvas.offsetWidth}px`;
  danmakuEl.style.height = `${canvas.offsetHeight}px`;
}

// Keep the overlay matched to the slide as the view resizes (inline ⇄ fullscreen,
// window resize). Otherwise a stale, oversized overlay lingers and makes the
// wrapper scroll until the next danmaku re-syncs it.
const danmakuResizeObserver = new ResizeObserver(() => positionDanmakuOverlay());
danmakuResizeObserver.observe(canvas);
danmakuResizeObserver.observe(canvasWrap);

type LaneGeometry = { fontSize: number; itemHeight: number; laneCount: number; laneHeight: number };

/** Split the usable height (minus the top/bottom margins) into as many rows as
 *  fit without vertical overlap. */
function laneGeometry(areaH: number): LaneGeometry {
  const fontSize = areaH * DANMAKU_FONT_RATIO;
  const itemHeight = fontSize * 1.2;
  const usable = areaH - DANMAKU_MARGIN_Y * 2;
  // Space lanes taller than the text so comments have room to sit at a random
  // height within their lane instead of snapping to a tidy grid.
  const laneCount = Math.max(1, Math.floor(usable / (itemHeight * DANMAKU_LANE_SPACING)));
  const laneHeight = usable / laneCount;
  return { fontSize, itemHeight, laneCount, laneHeight };
}

/** Choose a lane for a new comment of `color`: among free lanes, prefer those
 *  whose last comment was a different color (so the same color doesn't keep
 *  running down one lane), then pick at random. If every lane is busy,
 *  overlapping is fine — use the one that frees soonest. */
function chooseLane(now: number, laneCount: number, color: string): number {
  if (laneFreeAt.length !== laneCount) {
    laneFreeAt = new Array<number>(laneCount).fill(0);
    laneLastColor = new Array<string | null>(laneCount).fill(null);
  }
  const free: number[] = [];
  for (let i = 0; i < laneCount; i++) {
    if (now >= laneFreeAt[i]) free.push(i);
  }
  if (free.length > 0) {
    const differentColor = free.filter((i) => laneLastColor[i] !== color);
    const pool = differentColor.length > 0 ? differentColor : free;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let soonest = 0;
  for (let i = 1; i < laneCount; i++) {
    if (laneFreeAt[i] < laneFreeAt[soonest]) soonest = i;
  }
  return soonest;
}

/** Fire one comment in a lane. Lanes keep comments readable, but a full screen
 *  never throttles: overflow overlaps instead of queuing, so bursts don't lag. */
function runComment(comment: Comment) {
  positionDanmakuOverlay();
  const areaW = danmakuEl.clientWidth;
  const areaH = danmakuEl.clientHeight;
  const { fontSize, itemHeight, laneCount, laneHeight } = laneGeometry(areaH);
  const now = Date.now();
  const color = comment.color ?? DANMAKU_COLORS[Math.floor(Math.random() * DANMAKU_COLORS.length)];
  const lane = chooseLane(now, laneCount, color);

  const el = document.createElement("span");
  el.className = "danmaku-item";
  el.textContent = comment.text;
  el.style.color = color;
  el.style.fontSize = `${fontSize}px`;
  // Random height within the (taller-than-text) lane so rows don't line up into a
  // grid; it stays inside the lane, so neighboring lanes don't overlap.
  const top = DANMAKU_MARGIN_Y + lane * laneHeight + Math.random() * (laneHeight - itemHeight);
  el.style.top = `${top}px`;
  danmakuEl.appendChild(el);
  activeTexts.set(comment.text, (activeTexts.get(comment.text) ?? 0) + 1);

  const elWidth = el.offsetWidth;
  const duration = 3000 + Math.random() * 2000;
  // The lane is reusable once this comment's tail has fully entered the screen,
  // so the next one launched at the right edge won't overlap it; plus a gap.
  const enterTime = (elWidth / (areaW + elWidth)) * duration;
  laneFreeAt[lane] = now + enterTime + DANMAKU_LANE_GAP_MS;
  laneLastColor[lane] = color;

  const anim = el.animate(
    [{ transform: `translateX(${areaW}px)` }, { transform: `translateX(${-elWidth}px)` }],
    { duration, easing: "linear" },
  );
  anim.onfinish = () => {
    el.remove();
    const remaining = (activeTexts.get(comment.text) ?? 1) - 1;
    if (remaining > 0) activeTexts.set(comment.text, remaining);
    else activeTexts.delete(comment.text);
  };
}

/** Fire a batch immediately, lowest latency. They may bunch up when a poll
 *  returns several at once, but random vertical bands and varied speeds keep
 *  them readable. No-op until a slide is shown. */
function showComments(comments: Comment[]) {
  if (!mainEl.classList.contains("loaded")) return;
  positionDanmakuOverlay();
  if (danmakuEl.clientWidth === 0 || danmakuEl.clientHeight === 0) return;
  comments.forEach((comment) => {
    runComment(comment);
  });
}

function burstDanmaku() {
  // Skip samples still on screen so the same text never flows twice at once.
  const available = STATIC_COMMENTS.filter((text) => !activeTexts.has(text));
  showComments(
    shuffle(available)
      .slice(0, DANMAKU_BURST)
      .map((text) => ({ text })),
  );
}

/** Extract each page's text once and cache it; pages with no text layer (e.g.
 *  image-only slides) yield an empty string. */
async function extractPageTexts(): Promise<string[]> {
  if (pageTextCache) return pageTextCache;
  if (!pdfDoc) return [];
  const texts: string[] = [];
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n);
    const content = await page.getTextContent();
    // pdf.js marks the last chunk of a visual line with `hasEOL`; turn those into
    // newlines so the slide keeps its line structure (one line per row).
    const text = content.items
      .map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : " "))
      .join("")
      .replace(/[ \t]+\n/g, "\n");
    texts.push(text);
  }
  pageTextCache = texts;
  return texts;
}

/** C key: hand the collected comments and slide text to the model for a closing
 *  wrap-up. No-op until at least one comment has been received. */
async function sendFinale() {
  // C ends the talk: stop receiving before handing the wrap-up to the model.
  setCommentPolling(false);
  if (collectedComments.length === 0) return;
  // Switch to inline so the host conversation (where the wrap-up appears) is visible.
  await setDisplayMode("inline");
  try {
    const prompt = buildFinalePrompt(collectedComments, await extractPageTexts());
    await app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
  } catch (err) {
    console.error("sendMessage (finale) failed:", err);
  }
}

function openMenu() {
  refreshMenuMode();
  menuEl.hidden = false;
}

function closeMenu() {
  menuEl.hidden = true;
}

function toggleMenu() {
  if (menuEl.hidden) openMenu();
  else closeMenu();
}

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});

document.addEventListener("click", (e) => {
  if (menuEl.hidden) return;
  const target = e.target as Node;
  if (!menuEl.contains(target) && !menuBtn.contains(target)) closeMenu();
});

(document.getElementById("menu-open-pdf") as HTMLElement).addEventListener("click", () => {
  fileInput.click();
  closeMenu();
});

toggleFullscreenBtn.addEventListener("click", async () => {
  const target: McpUiDisplayMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  await setDisplayMode(target);
  closeMenu();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void loadPdf(file);
});

type FeedComment = { id: number; text: string; color: string | null };
type FeedResult = { comments: FeedComment[]; lastId: number };

// The in-flight guard caps in-flight requests at one, so this interval only
// bounds how long we wait after a response before the next poll. The GAS
// round-trip dominates perceived latency, so a shorter interval doesn't feel
// faster — keep it relaxed to avoid churning requests for no benefit.
const COMMENT_POLL_MS = 3000;
const COMMENT_IDLE_LIMIT_MS = 20 * 60 * 1000; // auto-stop after this long with no new comments
let commentPolling = false;
let commentPollTimer: ReturnType<typeof setInterval> | null = null;
let commentFetchInFlight = false;
let lastSeenCommentId = 0;
let commentCursorPrimed = false;
let lastCommentAt = 0;

async function pollComments() {
  // Skip this tick if the previous request hasn't returned yet, so requests
  // never overlap (no backlog flood, no priming race) while the interval keeps a
  // steady cadence regardless of how slow GAS is.
  if (commentFetchInFlight) return;
  // Safety valve: stop polling if no new comment has arrived for a while, so a
  // forgotten "コメント受信" doesn't keep calling the tool indefinitely.
  if (Date.now() - lastCommentAt > COMMENT_IDLE_LIMIT_MS) {
    setCommentPolling(false);
    return;
  }
  commentFetchInFlight = true;
  try {
    const result = await app.callServerTool({
      name: "fetch_comments",
      arguments: { since: lastSeenCommentId },
    });
    const data = result.structuredContent as FeedResult | undefined;
    if (data) {
      if (typeof data.lastId === "number") lastSeenCommentId = data.lastId;
      if (!commentCursorPrimed) {
        // The first poll only advances the cursor, so we start from "now" rather
        // than flooding the slide with the whole backlog.
        commentCursorPrimed = true;
      } else if (data.comments?.length) {
        lastCommentAt = Date.now();
        // Collect for the wrap-up, tagging each comment with the slide that was
        // on screen when it was posted (`id` is the post time in epoch ms).
        for (const c of data.comments) {
          collectedComments.push({ text: c.text, page: attributePage(pageTimeline, c.id) });
        }
        showComments(data.comments.map((c) => ({ text: c.text, color: c.color ?? undefined })));
      }
    }
  } catch (err) {
    console.error("fetch_comments failed:", err);
  } finally {
    commentFetchInFlight = false;
  }
}

function setCommentPolling(on: boolean) {
  if (on === commentPolling) return;
  commentPolling = on;
  if (on) {
    commentCursorPrimed = false;
    commentFetchInFlight = false;
    lastCommentAt = Date.now();
    void pollComments(); // immediate priming poll, then a steady interval
    commentPollTimer = setInterval(() => void pollComments(), COMMENT_POLL_MS);
  } else if (commentPollTimer !== null) {
    clearInterval(commentPollTimer);
    commentPollTimer = null;
  }
  commentsBtn.textContent = commentPolling ? "コメント受信を停止" : "コメント受信を開始";
  statusDot.hidden = !commentPolling;
}

commentsBtn.addEventListener("click", () => {
  setCommentPolling(!commentPolling);
  closeMenu();
});

document.addEventListener("keydown", (e) => {
  if (!menuEl.hidden && e.key === "Escape") {
    closeMenu();
    return;
  }
  if (e.key === "ArrowLeft") goToPage(currentPage - 1);
  else if (e.key === "ArrowRight") goToPage(currentPage + 1);
  else if (e.key.toLowerCase() === "d") burstDanmaku();
  else if (e.key.toLowerCase() === "c") void sendFinale();
});

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.displayMode) {
    currentDisplayMode = ctx.displayMode;
    applyDisplayModeClass(ctx.displayMode);
  }
  if (ctx.availableDisplayModes) {
    availableDisplayModes = ctx.availableDisplayModes;
  }
  if (!menuEl.hidden) refreshMenuMode();
}

const app = new App({ name: "Danmaku Slides App", version: "0.1.0" });

app.onteardown = async () => {
  setCommentPolling(false);
  return {};
};
app.onerror = console.error;
app.addEventListener("hostcontextchanged", handleHostContextChanged);

app.connect().then(async () => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
  await setDisplayMode("fullscreen");
});

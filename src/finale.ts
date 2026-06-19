/**
 * Pure logic for the closing "wrap-up" segment (C key): attribute each audience
 * comment to the slide that was on screen when it was posted, then build the
 * prompt sent to the model. No I/O — the view wires these to pdf.js and the host.
 */

/** A page shown on screen, with the wall-clock time it appeared (epoch ms). */
export type PageShown = { page: number; shownAt: number };

/** A collected audience comment tagged with the page that was on screen when it
 *  was posted. The view stores these in posting order. */
export type CommentRecord = { text: string; page: number };

/** Which page was on screen at `postedAt` (epoch ms). The timeline is in render
 *  order and its `shownAt` values only move forward, so the answer is the last
 *  page shown at or before the post time. A comment posted before the first
 *  recorded page (clock skew, or posted between load and first render) is
 *  attributed to the earliest page; an empty timeline falls back to page 1. */
export function attributePage(timeline: PageShown[], postedAt: number): number {
  if (timeline.length === 0) return 1;
  let page = timeline[0].page;
  for (const entry of timeline) {
    if (entry.shownAt > postedAt) break;
    page = entry.page;
  }
  return page;
}

/** Build the wrap-up prompt: instructions, the comments in posting order (each
 *  tagged with the page it was posted on), and the full slide text by page so
 *  the model can ground questions in the actual content. */
export function buildFinalePrompt(comments: CommentRecord[], pageTexts: string[]): string {
  const commentLines = comments.map((c) => `[p${c.page}] ${c.text}`).join("\n");
  const slideSections = pageTexts
    .map((text, i) => `## p${i + 1}\n${text.trim() || "（テキストなし）"}`)
    .join("\n\n");
  return [
    "発表が終わりました。参加者から届いたコメントをもとに、発表者にとって有益なフィードバックをまとめてください。",
    "",
    "# 指示",
    "- コメントから、発表者の役に立つこと（質問・疑問、反応の傾向、印象に残った点、改善のヒントなど）を読み取ってまとめてください。何が有益かはあなたの判断で構いません。",
    "- 質問・疑問があれば、発表者がそのまま答えられる明確な文に書き直してください。言葉足らずなコメントでも、表示中だったスライドの内容を踏まえて文脈を補ってください。",
    "- 回答する人が読むものです。ページ番号や「p3への質問」のような内部的な参照は出力に含めないでください。",
    "- 「test」「hoge」など意味の取れないコメントは無視してください。",
    "",
    "# コメント（投稿順 / 各行の先頭は表示中だったページ番号。文脈把握のためのもので、出力には含めない）",
    commentLines,
    "",
    "# スライド本文（ページ別）",
    slideSections,
  ].join("\n");
}

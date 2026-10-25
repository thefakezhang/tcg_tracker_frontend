// The original caption of an arrival post, as the Arrivals tab shows it.
//
// The backend returns the shop's own text with each post (`tweet_text`,
// migration 000605; absent on older backends and null on posts captured before
// the caption was kept), and the card shows it in full as plain text: the
// operator reads the shop's wording, never a rendering of it. X escapes the
// HTML entities in a post's text, so those are decoded back to characters
// here, and nothing else is interpreted. The only markup the card adds is a
// link for each `https://t.co/...` short URL X puts in the text, because that
// is where the shop's online listing usually lives.

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&apos;": "'",
};

/** The text with X's entity escapes turned back into characters; anything else is left as written. */
export function decodeTweetText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

export type TweetTextSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string };

const SHORT_LINK = /https:\/\/t\.co\/[A-Za-z0-9]+/g;

/** The caption split into plain text and the `https://t.co/...` links X put in it, in order. */
export function tweetTextSegments(text: string): TweetTextSegment[] {
  const segments: TweetTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(SHORT_LINK)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", value: text.slice(last, start) });
    segments.push({ kind: "link", value: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", value: text.slice(last) });
  return segments;
}

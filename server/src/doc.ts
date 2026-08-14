import * as Y from "yjs";
export function applyUpdates(state: Uint8Array | null, updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  if (state) {
    Y.applyUpdate(doc, state);
  }
  updates.forEach((update) => Y.applyUpdate(doc, update));
  return doc;
}

export function textOf(doc: Y.Doc): string {
  const xml = doc.getXmlFragment("prosemirror");
  return xml
    .toString()
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function metadata(doc: Y.Doc): { title: string; excerpt: string } {
  const text = textOf(doc);
  const line =
    text
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean) ?? "";
  return {
    title: line.slice(0, 120),
    excerpt: text.slice(0, 240),
  };
}

/**
 * Hand a blob to the browser as a file the reader keeps.
 *
 * Two callers now — the notes of one book, and the whole backup — so it lives here rather than
 * beside either of them.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

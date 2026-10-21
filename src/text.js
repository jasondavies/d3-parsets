// Given a text function and width function, truncates the text if necessary to
// fit within the given width.
function truncateText(text, width) {
  return function(d, i) {
    const t = (this.textContent = String(text.call(this, d, i) ?? ""));
    const w = width.call(this, d, i);
    if (this.getComputedTextLength() < w) return t;
    this.textContent = `…${t}`;
    let lo = 0;
    let hi = t.length + 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.getSubStringLength(0, mid) < w) lo = mid + 1;
      else hi = mid;
    }
    // Keep characters outside the BMP, such as emoji, whole.
    let end = lo - 2;
    if (end > 0 && /[\uD800-\uDBFF]/.test(t[end - 1])) end--;
    return lo > 1 ? `${t.slice(0, end)}…` : "";
  };
}

export { truncateText };

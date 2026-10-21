// A ribbon's path as displayed, partway through any animation. This runs for
// every moving ribbon on every animation frame.
function ribbonPath(d, tension) {
  const s = d.source;
  const t = d.target;
  return ribbonPathString(
    (s.node.x0 ?? s.node.x) + (s.x0 ?? s.x),
    (s.dimension.y0 ?? s.dimension.y) + (s.dy || 0),
    s.dx,
    (t.node.x0 ?? t.node.x) + (t.x0 ?? t.x),
    (t.dimension.y0 ?? t.dimension.y) + (t.dy || 0),
    t.dx,
    tension
  );
}

// A ribbon's path at rest.
function ribbonPathStatic(d, tension) {
  const s = d.source;
  const t = d.target;
  return ribbonPathString(
    s.node.x + s.x,
    s.dimension.y + (s.dy || 0),
    s.dx,
    t.node.x + t.x,
    t.dimension.y + (t.dy || 0),
    t.dx,
    tension
  );
}

function ribbonPathString(sx, sy, sdx, tx, ty, tdx, tension) {
  let m0;
  let m1;
  if (tension === 1) {
    return `M${sx},${sy}L${tx},${ty}h${tdx}L${sx + sdx},${sy}Z`;
  }
  m0 = tension * sy + (1 - tension) * ty;
  m1 = tension * ty + (1 - tension) * sy;
  return `M${sx},${sy}C${sx},${m0} ${tx},${m1} ${tx},${ty}h${tdx}C${tx + tdx},${m1} ${sx + sdx},${m0} ${sx + sdx},${sy}Z`;
}

export { ribbonPath, ribbonPathStatic, ribbonPathString };

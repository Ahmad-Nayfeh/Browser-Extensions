// Chrome writes WebM recordings without their length, so many players can't
// seek in them. This adds the "Duration" field to the file header (EBML).
async function fixWebmDuration(blob, durationMs) {
  const HEAD = 65536;
  const buf = new Uint8Array(await blob.slice(0, HEAD).arrayBuffer());
  const vint = (pos, keepMarker) => {
    const first = buf[pos];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    let val = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++) val = val * 256 + buf[pos + i];
    // "unknown size" = every value bit set (checked on bytes: big numbers lose precision in JS)
    let unknown = !keepMarker && (first & (0xff >> len)) === (0xff >> len);
    for (let i = 1; unknown && i < len; i++) unknown = buf[pos + i] === 0xff;
    return { len, val, unknown };
  };
  const ID_SEGMENT = 0x18538067, ID_INFO = 0x1549a966, ID_DURATION = 0x4489, ID_SEEKHEAD = 0x114d9b74;
  let pos = 0;
  const elem = (p) => { const id = vint(p, true); const size = vint(p + id.len, false); return { id: id.val, head: id.len + size.len, size }; };

  const ebml = elem(0);
  pos = ebml.head + ebml.size.val;
  const seg = elem(pos);
  if (seg.id !== ID_SEGMENT || !seg.size.unknown) return blob; // not the layout Chrome writes
  pos += seg.head;
  while (pos < buf.length - 12) {
    const e = elem(pos);
    if (e.id === ID_SEEKHEAD) return blob; // offsets would break – leave the file alone
    if (e.id === ID_INFO) {
      const start = pos + e.head, end = start + e.size.val;
      if (end > buf.length) return blob;
      // copy Info's children, dropping an existing Duration
      const kids = [];
      for (let p = start; p < end;) {
        const k = elem(p);
        const total = k.head + k.size.val;
        if (k.id !== ID_DURATION) kids.push(buf.slice(p, p + total));
        p += total;
      }
      const dur = new Uint8Array(11);
      dur.set([0x44, 0x89, 0x88]); // Duration, 8-byte float, in milliseconds (default TimecodeScale)
      new DataView(dur.buffer).setFloat64(3, durationMs);
      kids.push(dur);
      const bodyLen = kids.reduce((n, k) => n + k.length, 0);
      const info = new Uint8Array(4 + 8 + bodyLen);
      info.set([0x15, 0x49, 0xa9, 0x66, 0x01]); // Info id + 8-byte size
      let v = bodyLen;
      for (let i = 11; i >= 5; i--) { info[i] = v & 0xff; v = Math.floor(v / 256); }
      let o = 12;
      for (const k of kids) { info.set(k, o); o += k.length; }
      return new Blob([buf.slice(0, pos), info, blob.slice(end)], { type: blob.type });
    }
    pos += e.head + e.size.val;
  }
  return blob;
}

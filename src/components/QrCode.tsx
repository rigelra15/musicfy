import qrcode from 'qrcode-generator';

/** A QR code drawn as one SVG path (no innerHTML), black on white with the quiet zone a scanner needs. */
export function QrCode({ value, label, size = 320 }: { value: string; label: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 4;
  let path = '';
  for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
  const side = count + quiet * 2;
  return (
    <svg class="qr-code" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${side} ${side}`} shape-rendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

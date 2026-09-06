import { useMemo } from "react";
import { parseAsy, type AsyPin } from "../../lib/spice/asy";

function pinLabel(pin: AsyPin) {
  const dx = pin.side === "LEFT" ? -10 : pin.side === "RIGHT" ? 10 : 0;
  const dy = pin.side === "TOP" ? -10 : pin.side === "BOTTOM" ? 14 : 4;
  const anchor = pin.side === "LEFT" ? "end" : pin.side === "RIGHT" ? "start" : "middle";
  return { x: pin.x + dx, y: pin.y + dy, anchor } as const;
}

export default function SpiceSymbolPreview({ source, partNumber }: { source: string; partNumber: string }) {
  const drawing = useMemo(() => parseAsy(source), [source]);
  const box = drawing.viewBox;

  return (
    <figure className="spice-symbol" data-testid="spice-symbol-preview">
      <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} role="img" aria-labelledby="spice-symbol-title">
        <title id="spice-symbol-title">LTspice symbol and terminal order for {partNumber}</title>
        {drawing.lines.map((line, index) => (
          <line key={`line-${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
        ))}
        {drawing.rectangles.map((rect, index) => (
          <rect key={`rect-${index}`} x={Math.min(rect.x1, rect.x2)} y={Math.min(rect.y1, rect.y2)} width={Math.abs(rect.x2 - rect.x1)} height={Math.abs(rect.y2 - rect.y1)} />
        ))}
        {drawing.pins.map((pin, index) => {
          const label = pinLabel(pin);
          return (
            <g key={`pin-${index}`}>
              <circle cx={pin.x} cy={pin.y} r="2.5" />
              <text x={label.x} y={label.y} textAnchor={label.anchor}>
                {pin.order ?? "?"} · {pin.name || "unnamed"}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>LTspice symbol · terminal numbers are the .SUBCKT order</figcaption>
    </figure>
  );
}

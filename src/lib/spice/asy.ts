export interface AsyLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AsyRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AsyPin {
  x: number;
  y: number;
  side: string;
  name: string;
  order: number | null;
}

export interface AsyDrawing {
  lines: AsyLine[];
  rectangles: AsyRect[];
  pins: AsyPin[];
  viewBox: { x: number; y: number; width: number; height: number };
}

/** Parse the small, documented subset Forge itself emits. Unknown commands are ignored. */
export function parseAsy(source: string): AsyDrawing {
  const lines: AsyLine[] = [];
  const rectangles: AsyRect[] = [];
  const pins: AsyPin[] = [];
  let currentPin: AsyPin | null = null;

  for (const raw of source.split(/\r?\n/)) {
    const tokens = raw.trim().split(/\s+/);
    if (tokens[0] === "LINE" && tokens.length >= 6) {
      const [x1, y1, x2, y2] = tokens.slice(2, 6).map(Number);
      if ([x1, y1, x2, y2].every(Number.isFinite)) lines.push({ x1, y1, x2, y2 });
    } else if (tokens[0] === "RECTANGLE" && tokens.length >= 6) {
      const [x1, y1, x2, y2] = tokens.slice(2, 6).map(Number);
      if ([x1, y1, x2, y2].every(Number.isFinite)) rectangles.push({ x1, y1, x2, y2 });
    } else if (tokens[0] === "PIN" && tokens.length >= 5) {
      const x = Number(tokens[1]);
      const y = Number(tokens[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        currentPin = { x, y, side: tokens[3], name: "", order: null };
        pins.push(currentPin);
      }
    } else if (tokens[0] === "PINATTR" && currentPin && tokens[1] === "PinName") {
      currentPin.name = tokens.slice(2).join(" ");
    } else if (tokens[0] === "PINATTR" && currentPin && tokens[1] === "SpiceOrder") {
      const order = Number(tokens[2]);
      currentPin.order = Number.isFinite(order) ? order : null;
    }
  }

  const coordinates = [
    ...lines.flatMap((line) => [[line.x1, line.y1], [line.x2, line.y2]]),
    ...rectangles.flatMap((rect) => [[rect.x1, rect.y1], [rect.x2, rect.y2]]),
    ...pins.map((pin) => [pin.x, pin.y])
  ];
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  const minX = xs.length ? Math.min(...xs) : -32;
  const maxX = xs.length ? Math.max(...xs) : 32;
  const minY = ys.length ? Math.min(...ys) : -32;
  const maxY = ys.length ? Math.max(...ys) : 32;
  const padX = 54;
  const padY = 42;

  return {
    lines,
    rectangles,
    pins,
    viewBox: { x: minX - padX, y: minY - padY, width: maxX - minX + padX * 2, height: maxY - minY + padY * 2 }
  };
}

"use client";

import { useRef, useState } from "react";

/**
 * A draw-with-finger-or-mouse signature pad. Captures strokes on a canvas
 * and hands back a PNG data URL when the customer is done signing.
 */
export function SignaturePad({
  onSave,
  onCancel,
  saving = false,
}: {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    lastPoint.current = point(e);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPoint.current) return;
    const p = point(e);
    ctx.strokeStyle = "#18181b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    setHasInk(true);
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = false;
    lastPoint.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={640}
        height={240}
        className="h-[220px] w-full touch-none rounded-md border border-zinc-300 bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <p className="mt-1 text-center text-xs text-zinc-400">Sign above</p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={saving}
          className="btn-ghost px-3 py-1.5 text-sm"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!hasInk || saving}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          {saving ? "Saving…" : "Save signature"}
        </button>
      </div>
    </div>
  );
}

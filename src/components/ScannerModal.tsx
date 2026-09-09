"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

type ScanResult = { ok: boolean; message: string };

const HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
    ],
  ],
  [DecodeHintType.TRY_HARDER, true],
]);

/**
 * Camera barcode scanner for the register. Streams the back camera, decodes
 * 1D/2D barcodes, and hands each code to `onScan`, which resolves it to a
 * product and returns a message to flash. Keeps scanning so several items can
 * go through in a row; "Done" closes it. Falls back to manual entry if the
 * camera can't start.
 */
export function ScannerModal({
  onScan,
  onClose,
}: {
  onScan: (code: string) => Promise<ScanResult>;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [flash, setFlash] = useState<ScanResult | null>(null);
  const [manual, setManual] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busyRef = useRef(false);

  async function handle(code: string) {
    const c = code.trim();
    if (!c || busyRef.current) return;
    const now = Date.now();
    if (c === lastRef.current.code && now - lastRef.current.at < 1500) return;
    lastRef.current = { code: c, at: now };
    busyRef.current = true;
    try {
      const res = await onScan(c);
      setFlash(res);
      setTimeout(() => setFlash(null), 2200);
    } finally {
      busyRef.current = false;
    }
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      /* device rejected it */
    }
  }

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader(HINTS, {
      delayBetweenScanAttempts: 120,
    });

    (async () => {
      try {
        controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoRef.current!,
          (result, err) => {
            if (result) {
              handle(result.getText());
            } else if (err && err.name && err.name !== "NotFoundException") {
              // "NotFoundException" fires every empty frame — that's normal.
              console.debug("scan error", err.name);
            }
          },
        );
        if (cancelled) {
          controls?.stop();
          return;
        }
        // Torch capability check on the live track.
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setHasTorch(!!caps?.torch);
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setCamError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser settings, or type the code below."
            : name === "NotFoundError"
              ? "No camera found — type the code below instead."
              : "Couldn't start the camera. Type the code below instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="card w-full max-w-md overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-lg font-semibold">Scan a barcode</h2>
          <button onClick={onClose} className="btn-ghost px-2 py-1 text-sm">
            ✕
          </button>
        </div>

        <div className="relative bg-black">
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            className="block max-h-[55vh] w-full object-cover"
          />
          {!camError && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-24 w-4/5 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
          {!camError && (
            <p className="absolute inset-x-0 top-2 text-center text-xs text-white/80">
              Hold the barcode inside the frame
            </p>
          )}
          {hasTorch && !camError && (
            <button
              onClick={toggleTorch}
              className="absolute right-2 top-2 rounded-full bg-black/50 px-3 py-1 text-xs text-white"
            >
              {torchOn ? "Torch off" : "Torch"}
            </button>
          )}
          {flash && (
            <div
              className={`absolute inset-x-0 bottom-0 px-4 py-2 text-center text-sm font-medium text-white ${
                flash.ok ? "bg-green-600/90" : "bg-red-600/90"
              }`}
            >
              {flash.ok ? "Added" : ""} {flash.message}
            </div>
          )}
        </div>

        <div className="space-y-2 px-4 py-3">
          {camError && <p className="text-xs text-amber-700">{camError}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) {
                handle(manual);
                setManual("");
              }
            }}
            className="flex gap-2"
          >
            <input
              className="input h-9"
              placeholder="…or type the code and press Enter"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              inputMode="text"
            />
            <button type="submit" className="btn-secondary h-9 shrink-0">
              Add
            </button>
          </form>
          <button onClick={onClose} className="btn-primary h-9 w-full">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

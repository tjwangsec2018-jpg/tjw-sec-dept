import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

interface Props {
  onSignatureChange: (dataUrl: string | null) => void;
}

export const SignatureCanvas: React.FC<Props> = ({ onSignatureChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    canvas.height = Math.max(180, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#0F172A';
    }
  }, []);

  const getCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const pt = getCoords(e);
    lastPointRef.current = pt;

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.3, 0, Math.PI * 2);
      ctx.fillStyle = '#0F172A';
      ctx.fill();
    }
    setHasStroke(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastPointRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const pt = getCoords(e);
    const prev = lastPointRef.current;
    const midX = (prev.x + pt.x) / 2;
    const midY = (prev.y + pt.y) / 2;

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();

    lastPointRef.current = pt;
  };

  const finishStroke = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    if (canvasRef.current) {
      onSignatureChange(canvasRef.current.toDataURL('image/png'));
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasStroke(false);
    onSignatureChange(null);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">
          Sign inside the box using your finger, stylus, or trackpad
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasStroke}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#0F172A] disabled:opacity-40 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>
      <div className="relative rounded-xl border border-slate-300 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="w-full h-44 touch-none cursor-crosshair block"
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-6 border-b border-dashed border-slate-300" />
        {!hasStroke && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Draw Director Signature Here
          </div>
        )}
      </div>
    </div>
  );
};

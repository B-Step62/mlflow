import React, { useEffect, useRef } from 'react';

export interface RawPixelCanvasProps {
  src: string;
  width: number;
  height: number;
  className?: string;
  ariaLabel?: string;
}

export default function RawPixelCanvas({ src, width, height, className, ariaLabel }: RawPixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;

    async function drawPixels() {
      const response = await fetch(src);
      const buffer = await response.arrayBuffer();
      if (cancelled) {
        return;
      }

      const pixels = new Uint8ClampedArray(buffer);
      const expectedLength = width * height * 4;
      if (pixels.length !== expectedLength) {
        throw new Error(`Expected ${expectedLength} RGBA bytes, received ${pixels.length}`);
      }

      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      canvas.dataset.pixelsReady = 'true';
    }

    drawPixels();

    return () => {
      cancelled = true;
    };
  }, [height, src, width]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={width}
      height={height}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    />
  );
}

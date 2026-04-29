import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function IconMaskable() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, #7C3AED 0%, #5B21B6 60%, #3B0764 100%)',
          color: '#FFFFFF',
          fontSize: 220,
          fontWeight: 800,
          letterSpacing: -12,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          borderRadius: 96,
          margin: 64,
        }}
      >
        S
      </div>
    ),
    { ...size }
  );
}

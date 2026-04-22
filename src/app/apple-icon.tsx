import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 112,
          fontWeight: 800,
          letterSpacing: -6,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        S
      </div>
    ),
    { ...size }
  );
}

import { Html } from '@react-three/drei';

export function ZoneLabel({ label, position, color = '#6b5e4e' }: {
  label: string; position: [number, number, number]; color?: string;
}) {
  return (
    <Html center position={position} transform sprite style={{ pointerEvents: 'none' }}>
      <div style={{
        padding: '4px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
        background: 'rgba(255,252,247,0.92)', border: '1px solid #e0d8cc',
        color, whiteSpace: 'nowrap', userSelect: 'none',
      }}>
        {label}
      </div>
    </Html>
  );
}

import { useEffect, useState } from 'react';

export function downloadPosterBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  blob: Blob | null;
  filename: string;
  onClose: () => void;
  onSaved?: () => void;
};

/** 全屏海报预览 — 用户确认后再保存图片 */
export function SharePosterPreview({ blob, filename, onClose, onSaved }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  useEffect(() => {
    if (!blob) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blob, onClose]);

  if (!blob || !url) return null;

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 10000 }}
      onClick={onClose}
    >
      <div
        className="modal-box"
        style={{ maxWidth: 680, width: 'min(96vw, 680px)', padding: 16 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#3d3530', margin: 0 }}>分享海报预览</h2>
          <button type="button" className="ui-btn modal-close" onClick={onClose} title="关闭">✕</button>
        </div>
        <div style={{
          borderRadius: 10, overflow: 'hidden', background: '#1a1a1a',
          border: '1px solid #ebe4d8', marginBottom: 14,
        }}>
          <img
            src={url}
            alt="分享海报"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="ui-btn"
            style={{ flex: 1, padding: '10px 0', fontWeight: 700 }}
            onClick={() => {
              downloadPosterBlob(blob, filename);
              onSaved?.();
            }}
          >
            💾 保存图片
          </button>
          <button type="button" className="ui-btn" style={{ flex: 1, padding: '10px 0' }} onClick={onClose}>
            关闭
          </button>
        </div>
        <p style={{ fontSize: 10, color: '#9a8b7a', textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
          长按图片可保存（移动端）· 或点「保存图片」下载
        </p>
      </div>
    </div>
  );
}

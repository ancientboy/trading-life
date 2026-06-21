import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const MARKS = [
  { target: '.left-sidebar', title: '左侧 · 去哪', body: '切换大厅、工坊、休闲区与竞技馆。一功能一个主入口。' },
  { target: '.right-panel', title: '右侧 · 在这干什么', body: '任务、持仓、竞技操作都在这里完成，不必反复开弹窗。' },
  { target: '.top-nav-stats', title: '顶部 · 账户层', body: '模拟资产、盈亏、积分与每日津贴。玩法入口在左侧与右栏。' },
] as const;

export function CoachMarks({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = document.querySelector(MARKS[index].target);
    if (!el) {
      setRect(null);
      return;
    }
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [index]);

  const mark = MARKS[index];
  const isLast = index >= MARKS.length - 1;

  return createPortal(
    <div className="coach-marks-overlay" role="dialog" aria-label="新手提示">
      <div className="coach-marks-scrim" />
      {rect && (
        <div className="coach-marks-highlight" style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }} />
      )}
      <div className="coach-marks-card">
        <div style={{ fontSize: 10, color: '#9a8b7a', marginBottom: 4 }}>{index + 1} / {MARKS.length}</div>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{mark.title}</div>
        <p style={{ fontSize: 13, color: '#6b5e4e', lineHeight: 1.55, marginBottom: 14 }}>{mark.body}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="ui-btn" style={{ fontSize: 12 }}
            onClick={() => { localStorage.setItem('tl_coach_seen', '1'); onDone(); }}>
            不再提示
          </button>
          <button type="button" className="ui-btn" style={{ fontSize: 12, fontWeight: 700 }}
            onClick={() => {
              if (isLast) {
                localStorage.setItem('tl_coach_seen', '1');
                onDone();
              } else {
                setIndex(i => i + 1);
              }
            }}>
            {isLast ? '知道了' : '下一步'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

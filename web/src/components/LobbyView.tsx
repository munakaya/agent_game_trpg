import { useState } from 'react';
import type { UIState } from '../state/types';
import { startDemo, startRoguelike } from '../net/apiClient';

interface Props {
  state: UIState;
}

function toReadableError(error?: string): string {
  if (!error) return '요청 처리에 실패했습니다.';
  if (error.includes('session is not in LOBBY state')) {
    return '이미 진행 중인 세션입니다. 새로고침 후 현재 화면으로 이동해 주세요.';
  }
  if (error.includes('demo already running')) {
    return '데모가 이미 실행 중입니다. 잠시 후 다시 확인해 주세요.';
  }
  return error;
}

export default function LobbyView({ state }: Props) {
  const { lobby, session } = state;
  const [loading, setLoading] = useState(false);
  const [loadingRL, setLoadingRL] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await startDemo();
      if (!result.ok) {
        setError(toReadableError(result.error));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRoguelike = async () => {
    setLoadingRL(true);
    setError(null);
    try {
      const result = await startRoguelike();
      if (!result.ok) {
        setError(toReadableError(result.error));
      }
    } finally {
      setLoadingRL(false);
    }
  };

  return (
    <div className="lobby-view">
      <span className="lobby-kicker">TACTICAL CO-OP SESSION</span>
      <h2 className="lobby-title">{session.title || '작전 준비 중'}</h2>
      <p className="lobby-subtitle">모드를 선택하면 전투 시뮬레이션이 즉시 시작됩니다.</p>

      <div className="lobby-status">
        <div className={`lobby-badge ${lobby.dmConnected ? 'ready' : 'waiting'}`}>
          <div className="lobby-role">DM Link</div>
          <div className={`lobby-badge-state ${lobby.dmConnected ? 'ready' : 'waiting'}`}>
            {lobby.dmConnected ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>

        <div className={`lobby-badge ${(lobby.playersConnected ?? 0) >= 2 ? 'ready' : 'waiting'}`}>
          <div className="lobby-role">Agents</div>
          <div className={`lobby-badge-state ${(lobby.playersConnected ?? 0) >= 2 ? 'ready' : 'waiting'}`}>
            {lobby.playersConnected ?? 0} / 4 READY
          </div>
        </div>
      </div>

      {lobby.roleNeed && (
        <div className="lobby-role-need">
          <span className="lobby-role-need-label">필요 역할</span>
          {lobby.roleNeed.tank && <span className="lobby-role-chip">Tank</span>}
          {lobby.roleNeed.healer && <span className="lobby-role-chip">Healer</span>}
          {lobby.roleNeed.dps && <span className="lobby-role-chip">DPS</span>}
          {!lobby.roleNeed.tank && !lobby.roleNeed.healer && !lobby.roleNeed.dps && (
            <span className="lobby-role-chip">All filled</span>
          )}
        </div>
      )}

      <div className="lobby-mode-grid">
        <button
          onClick={handleRoguelike}
          disabled={loadingRL || loading}
          className="lobby-mode-card primary"
        >
          <span className="lobby-mode-chip">RECOMMENDED</span>
          <strong className="lobby-mode-title">{loadingRL ? '시작 중...' : '로그라이크 원정'}</strong>
          <span className="lobby-mode-desc">층별 보상 선택이 있는 고밀도 전투 루프</span>
          <span className="lobby-mode-meta">10층 · 약 5분 · 보상 시스템</span>
        </button>

        <button
          onClick={handleDemo}
          disabled={loading || loadingRL}
          className="lobby-mode-card secondary"
        >
          <span className="lobby-mode-chip">CLASSIC</span>
          <strong className="lobby-mode-title">{loading ? '시작 중...' : '클래식 데모'}</strong>
          <span className="lobby-mode-desc">기본 TRPG 흐름을 확인하는 시네마틱 데모</span>
          <span className="lobby-mode-meta">약 10분 · 스토리 중심</span>
        </button>
      </div>

      {error && (
        <span className="lobby-error">{error}</span>
      )}
    </div>
  );
}

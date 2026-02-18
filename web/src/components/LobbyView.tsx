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
      <h2 className="lobby-title">{session.title || '대기 중…'}</h2>
      <p className="lobby-subtitle">
        에이전트가 접속하면 게임이 시작됩니다.
      </p>

      <div className="lobby-status">
        <div className={`lobby-badge ${lobby.dmConnected ? 'ready' : 'waiting'}`}>
          <div className="lobby-role">DM</div>
          <div className={`lobby-badge-state ${lobby.dmConnected ? 'ready' : 'waiting'}`}>
            {lobby.dmConnected ? 'Ready' : 'Waiting...'}
          </div>
        </div>

        <div className={`lobby-badge ${(lobby.playersConnected ?? 0) >= 2 ? 'ready' : 'waiting'}`}>
          <div className="lobby-role">Players</div>
          <div className={`lobby-badge-state ${(lobby.playersConnected ?? 0) >= 2 ? 'ready' : 'waiting'}`}>
            {lobby.playersConnected ?? 0} / 4
          </div>
        </div>
      </div>

      {lobby.roleNeed && (
        <div className="lobby-role-need">
          필요 역할:
          {lobby.roleNeed.tank && <span className="lobby-role-chip">Tank</span>}
          {lobby.roleNeed.healer && <span className="lobby-role-chip">Healer</span>}
          {lobby.roleNeed.dps && <span className="lobby-role-chip">DPS</span>}
          {!lobby.roleNeed.tank && !lobby.roleNeed.healer && !lobby.roleNeed.dps && (
            <span className="lobby-role-chip">All filled!</span>
          )}
        </div>
      )}

      <div className="lobby-actions">
        <button
          onClick={handleRoguelike}
          disabled={loadingRL || loading}
          className="lobby-main-btn"
        >
          {loadingRL ? '시작 중...' : '로그라이크 모드'}
        </button>
        <span className="lobby-caption">
          10층 던전 크롤링 (~5분)
        </span>

        <div className="lobby-secondary-wrap">
          <button
            onClick={handleDemo}
            disabled={loading || loadingRL}
            className="lobby-sub-btn"
          >
            {loading ? '시작 중...' : '클래식 데모'}
          </button>
          <div className="lobby-secondary-caption">
            기존 10분 시연 모드
          </div>
        </div>
        {error && (
          <span className="lobby-error">{error}</span>
        )}
      </div>
    </div>
  );
}

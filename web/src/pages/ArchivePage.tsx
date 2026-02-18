import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchArchive } from '../net/apiClient';

interface ArchiveSession {
  sessionId: string;
  genre: string;
  title: string;
  state: string;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

const genreEmoji: Record<string, string> = {
  fantasy: 'Fantasy',
  cyberpunk: 'Cyberpunk',
  zombie: 'Zombie',
};

export default function ArchivePage() {
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchArchive().then(data => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="archive-empty">아카이브를 불러오는 중입니다…</div>;
  }

  return (
    <div>
      <h2 className="archive-title">Session Archive</h2>
      {sessions.length === 0 && (
        <p className="archive-empty">저장된 세션이 아직 없습니다.</p>
      )}
      <div className="archive-list">
        {sessions.map(s => (
          <Link
            key={s.sessionId}
            to={`/replay/${s.sessionId}`}
            className="archive-item"
          >
            <div>
              <div className="archive-item-title">{s.title}</div>
              <div className="archive-item-meta">
                {genreEmoji[s.genre] ?? s.genre}
              </div>
            </div>
            <div className="archive-item-time">
              {s.endedAt ? new Date(s.endedAt).toLocaleString('ko-KR') : '-'}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

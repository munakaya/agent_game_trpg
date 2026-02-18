import { useEffect, useRef } from 'react';
import type { UIState } from '../state/types';

interface Props {
  state: UIState;
}

export default function ChatLog({ state }: Props) {
  const { messages, streaming } = state.chat;
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 채팅형 UX: 새 메시지가 들어오면 항상 하단 고정
    const id = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, streaming]);

  return (
    <div className="chat-log" ref={containerRef}>
      {messages.map((msg) => {
        if (msg.speaker.type === 'COMBAT') {
          const isHeal = msg.text.startsWith('💚');
          const isDeath = msg.text.startsWith('💀');
          const cls = `chat-msg chat-combat${isHeal ? ' heal' : ''}${isDeath ? ' death' : ''}`;
          return (
            <div key={msg.messageId} className={cls}>
              <span>{msg.text}</span>
            </div>
          );
        }
        return (
          <div key={msg.messageId} className="chat-msg">
            <span className={`chat-speaker ${msg.speaker.type}`}>
              {msg.speaker.name}
            </span>
            <span>{msg.text}</span>
          </div>
        );
      })}

      {Object.entries(streaming).length > 0 && (
        <div className="chat-streaming-dock">
          {Object.entries(streaming).map(([id]) => (
            <div key={id} className="chat-msg chat-streaming">
              <span>응답 생성 중…</span>
            </div>
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

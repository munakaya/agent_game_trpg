import { useEffect, useRef } from 'react';
import type { UIState } from '../state/types';

interface Props {
  state: UIState;
}

export default function ChatLog({ state }: Props) {
  const { messages, streaming } = state.chat;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, Object.keys(streaming).length]);

  return (
    <div className="chat-log">
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

      {Object.entries(streaming).map(([id]) => (
        <div key={id} className="chat-msg chat-streaming">
          <span>응답 생성 중…</span>
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}

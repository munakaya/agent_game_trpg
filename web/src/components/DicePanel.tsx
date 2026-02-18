import type { UIState } from '../state/types';

interface Props {
  state: UIState;
}

export default function DicePanel({ state }: Props) {
  const { recent } = state.dice;

  return (
    <div className="dice-panel">
      <div className="dice-title">판정 기록</div>
      {recent.length === 0 && (
        <div className="dice-empty">아직 판정이 없습니다.</div>
      )}
      {[...recent].reverse().map((roll, i) => {
        const cls = roll.success === true ? 'dice-success' : roll.success === false ? 'dice-fail' : '';
        return (
          <div key={i} className={`dice-roll ${cls}`}>
            <span className="dice-who">{roll.who.byName}</span>
            {' '}
            <span className="dice-code">{roll.dice}</span>
            {' '}
            [{roll.rolls.join(',')}]
            {roll.modifier !== 0 && <span>+{roll.modifier}</span>}
            {' = '}
            <strong>{roll.total}</strong>
            {roll.dc && (
              <span className="dice-dc"> vs DC{roll.dc}</span>
            )}
            {roll.success !== undefined && (
              <span className={`dice-result ${roll.success ? 'ok' : 'ng'}`}>
                {roll.success ? 'Success' : 'Fail'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

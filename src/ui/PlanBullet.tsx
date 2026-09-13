import type { PlanProgress } from '../core/hours'

/**
 * A bullet graph: the bar is the hours done, the tick is where the plan expected
 * you to be by today, and the track is cut at each phase boundary so the bar
 * also says which stage you are in. One measure against one target — the reading
 * the old items-done meter could not give, because 20 of 138 is neither good nor
 * bad without knowing what today should look like.
 */
export function PlanBullet({ progress }: { progress: PlanProgress }) {
  const { done, expected, total, phases } = progress
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  const delta = done - expected
  const at = (hours: number) => `${total === 0 ? 0 : (hours / total) * 100}%`

  return (
    <div className="plan">
      <div className="plan-head">
        <div>
          <div className="stat-label">Plan</div>
          <div className="plan-value">
            {percent}% <span className="plan-of">{hours(done)} of {hours(total)}h</span>
          </div>
        </div>
        <div className={delta < -0.5 ? 'plan-pace bad' : delta > 0.5 ? 'plan-pace good' : 'plan-pace'}>
          {paceText(delta, expected)}
        </div>
      </div>

      <div
        className="bullet"
        role="img"
        aria-label={`${hours(done)} of ${hours(total)} planned hours done; the plan expected ${hours(expected)} by today`}
      >
        <div className="bullet-track">
          {phases
            .filter((phase) => phase.hours > 0)
            .map((phase) => (
              <div
                key={phase.phase}
                className="bullet-phase"
                style={{ flexGrow: phase.hours }}
                title={`Phase ${phase.phase}: ${hours(phase.done)} of ${hours(phase.hours)}h done`}
              >
                <div
                  className="bullet-fill"
                  style={{ width: `${Math.min(phase.done / phase.hours, 1) * 100}%` }}
                />
              </div>
            ))}
        </div>
        <div
          className="bullet-target"
          style={{ left: at(expected) }}
          title={`Plan by today: ${hours(expected)}h`}
        />
        <div className="bullet-phases" aria-hidden="true">
          {phases
            .filter((phase) => phase.hours > 0)
            .map((phase) => (
              <span key={phase.phase} style={{ flexGrow: phase.hours }}>
                {phase.phase}
              </span>
            ))}
        </div>
      </div>

      <ul className="bullet-legend">
        <li>
          <span className="bullet-key-fill" /> done
        </li>
        <li>
          <span className="bullet-key-target" /> plan by today
        </li>
        <li className="faint">numbers under the bar are phases</li>
      </ul>
    </div>
  )
}

function paceText(delta: number, expected: number): string {
  if (Math.abs(delta) <= 0.5) {
    return expected === 0 ? 'nothing was due yet' : 'on the plan'
  }
  return delta < 0 ? `${hours(-delta)}h behind the plan` : `${hours(delta)}h ahead of the plan`
}

function hours(value: number): string {
  return String(Math.round(value))
}

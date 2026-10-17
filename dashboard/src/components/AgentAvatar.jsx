import { agentMeta } from '../lib/pipeline.js'

export function AgentAvatar({ agent, size = 28, active = false }) {
  const meta = agentMeta(agent)
  const Icon = meta.icon
  return (
    <span
      className={`agent-avatar agent-${meta.cls}${active ? ' is-active' : ''}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      title={agent}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.54)} strokeWidth={2} />
    </span>
  )
}

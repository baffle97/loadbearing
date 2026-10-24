import { useHover } from '../lib/hoverBus'

interface Props {
  describe: (index: number) => { title: string; detail: string }
}

export function Tooltip({ describe }: Props) {
  const hover = useHover()
  if (!hover) return null
  const { title, detail } = describe(hover.index)
  return (
    <div className="tooltip" style={{ left: hover.x + 16, top: hover.y + 16 }} role="presentation">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

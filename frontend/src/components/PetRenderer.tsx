import { useMemo } from 'react'

const DEFAULT_ROW_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6]

interface PetRendererProps {
  spritesheetPath: string
  size?: number
  frameCount?: number
  rowCount?: number
  animationRow?: number
  frameWidth?: number
  frameHeight?: number
  fps?: number
  animate?: boolean
  cycleAll?: boolean
  rowFrameCounts?: number[]
  className?: string
}

function buildCycleKeyframes(
  animId: string,
  rowFrameCounts: number[],
  displayWidth: number,
  displayHeight: number,
): string {
  const totalFrames = rowFrameCounts.reduce((a, b) => a + b, 0)
  const pctPerFrame = 100 / totalFrames
  const lines: string[] = []

  let frameIdx = 0
  for (let row = 0; row < rowFrameCounts.length; row++) {
    const cols = rowFrameCounts[row]
    for (let col = 0; col < cols; col++) {
      const pct = (frameIdx * pctPerFrame).toFixed(3)
      lines.push(`  ${pct}% { background-position: -${col * displayWidth}px -${row * displayHeight}px; }`)
      frameIdx++
    }
  }

  // Duplicate last frame at 100% to prevent flash at loop point
  const lastRow = rowFrameCounts.length - 1
  const lastCol = rowFrameCounts[lastRow] - 1
  lines.push(`  100% { background-position: -${lastCol * displayWidth}px -${lastRow * displayHeight}px; }`)

  return `@keyframes ${animId} {\n${lines.join('\n')}\n}`
}

function buildRowKeyframes(animId: string, frameCount: number, displayWidth: number): string {
  const pctPerFrame = 100 / frameCount
  const lines: string[] = []
  for (let i = 0; i < frameCount; i++) {
    const pct = (i * pctPerFrame).toFixed(1)
    lines.push(`  ${pct}% { background-position-x: -${i * displayWidth}px; }`)
  }
  lines.push(`  100% { background-position-x: -${(frameCount - 1) * displayWidth}px; }`)
  return `@keyframes ${animId} {\n${lines.join('\n')}\n}`
}

export default function PetRenderer({
  spritesheetPath,
  size = 48,
  frameCount = 8,
  rowCount = 9,
  animationRow = 0,
  frameWidth = 192,
  frameHeight = 208,
  fps = 8,
  animate = true,
  cycleAll = false,
  rowFrameCounts,
  className,
}: PetRendererProps) {
  const aspectRatio = frameWidth / frameHeight
  const displayWidth = size
  const displayHeight = Math.round(size / aspectRatio)

  const bgWidth = displayWidth * frameCount
  const bgHeight = displayHeight * rowCount

  const effectiveRowFrames = rowFrameCounts ?? DEFAULT_ROW_FRAMES
  const effectiveFrameCount = cycleAll
    ? effectiveRowFrames.reduce((a, b) => a + b, 0)
    : (effectiveRowFrames[animationRow] ?? frameCount)
  const duration = (effectiveFrameCount / fps).toFixed(2)

  const animId = useMemo(() => `pet-${Math.random().toString(36).slice(2, 7)}`, [])

  const keyframes = useMemo(() => {
    if (cycleAll) {
      return buildCycleKeyframes(animId, effectiveRowFrames, displayWidth, displayHeight)
    }
    return buildRowKeyframes(animId, effectiveFrameCount, displayWidth)
  }, [animId, displayWidth, displayHeight, cycleAll, effectiveRowFrames, animationRow, effectiveFrameCount])

  const style: React.CSSProperties = {
    width: displayWidth,
    height: displayHeight,
    backgroundImage: `url(${spritesheetPath})`,
    backgroundSize: `${bgWidth}px ${bgHeight}px`,
    backgroundPosition: cycleAll ? '0px 0px' : `0px -${animationRow * displayHeight}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    ...(animate
      ? { animation: `${animId} ${duration}s step-start infinite` }
      : {}),
  }

  return (
    <div className={className} style={style}>
      {animate && <style>{keyframes}</style>}
    </div>
  )
}

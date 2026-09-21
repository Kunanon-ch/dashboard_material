import { useEffect, useRef } from 'react'
import { init, use, type ComposeOption, type EChartsType } from 'echarts/core'
import { LineChart, BarChart, type LineSeriesOption, type BarSeriesOption } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent,
  type GridComponentOption, type TooltipComponentOption, type LegendComponentOption,
} from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, LabelLayout, CanvasRenderer])

export type ChartOption = ComposeOption<LineSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption>

interface ChartProps {
  option: ChartOption
  label: string
  height?: number
  className?: string
  onReady?: (chart: EChartsType | null) => void
}

export function Chart({ option, label, height = 280, className = '', onReady }: ChartProps) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<EChartsType | null>(null)

  useEffect(() => {
    if (!container.current) return
    const chart = init(container.current, undefined, { renderer: 'canvas' })
    instance.current = chart
    onReady?.(chart)
    const resize = new ResizeObserver(() => chart.resize())
    resize.observe(container.current)
    return () => { resize.disconnect(); onReady?.(null); chart.dispose(); instance.current = null }
  }, [onReady])

  useEffect(() => {
    instance.current?.setOption({ ...option, animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches }, { notMerge: true })
  }, [option])

  return <div ref={container} className={`dash-chart ${className}`} style={{ height }} role="img" aria-label={label} />
}

export default Chart

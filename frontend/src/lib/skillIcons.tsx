import { type LucideIcon, ClipboardCheck, CircleDollarSign, Building, PackageSearch, Bot } from 'lucide-react'

const iconMap: Record<string, LucideIcon> = {
  'clipboard-check': ClipboardCheck,
  'circle-dollar-sign': CircleDollarSign,
  'building': Building,
  'package-search': PackageSearch,
  'bot': Bot,
}

export const skillIconNames = Object.keys(iconMap)

export function getSkillIcon(name: string): LucideIcon {
  return iconMap[name] || Bot
}

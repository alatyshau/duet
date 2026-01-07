/*
 * ЧТО: Утилиты для работы с CSS классами.
 * ЗАЧЕМ: Объединяет Tailwind классы без конфликтов.
 * КТО ИСПОЛЬЗУЕТ: shadcn/ui компоненты.
 */
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

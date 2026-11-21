import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string, locale: string = 'en') {
  const d = new Date(date);
  return d.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

export function calculateAge(dob: Date | string): number {
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

export function getUCategory(age: number): string | null {
  if (age < 17) return 'U17';
  if (age < 19) return 'U19';
  if (age < 21) return 'U21';
  if (age < 23) return 'U23';
  return null;
}

export function getPositionColor(pos: string): string {
  const colors: Record<string, string> = {
    GK: '#f59e0b', CB: '#3b82f6', LB: '#6366f1', RB: '#6366f1',
    LWB: '#6366f1', RWB: '#6366f1', CDM: '#22c55e', CM: '#22c55e',
    CAM: '#a855f7', LM: '#a855f7', RM: '#a855f7', LW: '#ec4899',
    RW: '#ec4899', CF: '#ef4444', ST: '#ef4444'
  };
  return colors[pos] || '#6b7280';
}

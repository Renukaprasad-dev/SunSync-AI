import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slotToTime(slot: number): string {
  const clamped = Math.max(0, Math.min(95, Math.floor(slot)));
  const totalMin = clamped * 15;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

export function formatRs(val: number): string {
  return `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

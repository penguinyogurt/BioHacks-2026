import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 4805 → "4,805". Grouping matters at a glance; raw digits don't read. */
export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** 0.93 → "0.93". Fixed width so columns of probabilities line up. */
export function prob(p: number): string {
  return p.toFixed(2);
}

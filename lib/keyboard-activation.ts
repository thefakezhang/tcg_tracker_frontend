import type { KeyboardEvent } from "react";

export function activateOnEnterOrSpace(
  event: KeyboardEvent<HTMLElement>,
  activate: () => void,
): void {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
  event.preventDefault();
  activate();
}

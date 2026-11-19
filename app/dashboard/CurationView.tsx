"use client";

import { CurationWorkspace } from "./curation-workspace";
import { CurationCandidateCard as SharedCandidateCard } from "./curation-candidate-card";
import { normalizeSinglesCandidate, singlesCuration, type SinglesApproval, type SinglesCandidate } from "./curation-adapters";
import type { CurationApproval, CurationCardProps } from "./curation-model";

export default function CurationView() {
  return <CurationWorkspace config={singlesCuration} />;
}

function singlesApproval(options?: CurationApproval): SinglesApproval | undefined {
  if (!options) return undefined;
  const { matchId, condition, ...common } = options;
  return { ...common,
    ...("matchId" in options ? { cardId: matchId } : {}),
    ...("condition" in options ? { grading: condition } : {}) };
}

// Keep the existing candidate-card contract at the singles entry point.
export function CurationCandidateCard(props: CurationCardProps<SinglesCandidate, SinglesApproval>) {
  return <SharedCandidateCard {...props} config={singlesCuration} c={normalizeSinglesCandidate(props.c)}
    onApprove={(_, options) => props.onApprove(props.c, singlesApproval(options))}
    onReject={(_, notes) => props.onReject(props.c, notes)}
    onSendBack={(_, notes) => props.onSendBack(props.c, notes)}
    onUndo={props.onUndo ? () => props.onUndo?.(props.c) : undefined} />;
}

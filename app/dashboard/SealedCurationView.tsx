"use client";

import { CurationWorkspace } from "./curation-workspace";
import { CurationCandidateCard as SharedCandidateCard } from "./curation-candidate-card";
import { normalizeSealedCandidate, sealedCuration, type SealedApproval, type SealedCandidate } from "./curation-adapters";
import type { CurationApproval, CurationCardProps } from "./curation-model";

export default function SealedCurationView() {
  return <CurationWorkspace config={sealedCuration} />;
}

function sealedApproval(options?: CurationApproval): SealedApproval | undefined {
  if (!options) return undefined;
  const { matchId, ...common } = options;
  return { ...common, ...("matchId" in options ? { productId: matchId } : {}) };
}

// Keep the existing candidate-card contract at the sealed entry point.
export function SealedCurationCandidateCard(props: CurationCardProps<SealedCandidate, SealedApproval>) {
  return <SharedCandidateCard {...props} config={sealedCuration} c={normalizeSealedCandidate(props.c)}
    onApprove={(_, options) => props.onApprove(props.c, sealedApproval(options))}
    onReject={(_, notes) => props.onReject(props.c, notes)}
    onSendBack={(_, notes) => props.onSendBack(props.c, notes)}
    onUndo={props.onUndo ? () => props.onUndo?.(props.c) : undefined} />;
}

export const SAMPLE_CASES = [
  {
    id: 'launch-outage',
    account: 'Sample account A',
    plan: 'Studio',
    priceCents: 4900,
    currency: 'USD',
    incident: 'On 28 October, sign-in was unavailable for 2 hours during the customer’s scheduled product launch. The customer could not access the dashboard or publish planned updates. Service was restored at 14:00 UTC.',
    request: 'I paid for a working service, but my team could not log in during our launch. Please make this right.'
  },
  {
    id: 'minor-delay',
    account: 'Sample account B',
    plan: 'Starter',
    priceCents: 1900,
    currency: 'USD',
    incident: 'On 27 October, email notifications were delayed by 20 minutes. The customer could still access the dashboard and complete all core actions. The queue recovered automatically.',
    request: 'Our notifications came a little late. Is there any credit for this?'
  }
];

export const POLICY = Object.freeze({ none: 0, minor: 5, major: 15, critical: 25 });

export function makeRecommendation(caseData, analysis) {
  if (!caseData || !Number.isInteger(caseData.priceCents) || caseData.priceCents <= 0) throw new Error('Invalid case price');
  const severity = analysis?.severity;
  if (!Object.hasOwn(POLICY, severity)) throw new Error('Invalid severity');
  if (typeof analysis?.evidence !== 'string' || !analysis.evidence.trim() || !caseData.incident.includes(analysis.evidence)) {
    throw new Error('AI evidence must be an exact quote from the incident');
  }
  if (typeof analysis?.reason !== 'string' || analysis.reason.length < 12 || analysis.reason.length > 500) throw new Error('Invalid reason');
  const percent = POLICY[severity];
  return {
    severity,
    percent,
    refundCents: Math.round(caseData.priceCents * percent / 100),
    evidence: analysis.evidence,
    reason: analysis.reason,
    policy: 'Fixed service-recovery policy: minor 5%, major 15%, critical 25% of the original payment. A human approves each refund.'
  };
}

export function canRefund(caseData) {
  if (!caseData.recommendation) return 'Analyze the incident first.';
  if (!caseData.paypal?.captureId) return 'Complete a PayPal Sandbox test payment first.';
  if (caseData.refund?.id) return 'This case already has a refund.';
  if (caseData.recommendation.refundCents <= 0) return 'Policy recommends no refund for this case.';
  if (caseData.recommendation.refundCents > caseData.priceCents) return 'Refund exceeds payment.';
  return null;
}

export function centsToAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid amount');
  return (cents / 100).toFixed(2);
}

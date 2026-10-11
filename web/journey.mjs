export function journey({workflowId, selected = 0, reviewing = false}) {
  const hasWorkflow = !!workflowId;
  const review = hasWorkflow && (selected > 0 || reviewing);
  return {step: review ? 3 : hasWorkflow ? 2 : 1, executionsVisible: hasWorkflow, reviewVisible: review};
}

export function redirectToEditor(error, location) {
  if (!['session_expired', 'open_editor_first'].includes(error?.code)) return false;
  location.assign('/');
  return true;
}

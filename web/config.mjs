export const config = Object.freeze({
  expectedN8nVersion: '2.42.4',
  discoverWorkflows: true,
  previewConcurrency: 4,
  // Optional explicit allowlist: workflow ID -> {trigger: 'Recorded trigger name'}.
  workflows: Object.freeze({}),
});

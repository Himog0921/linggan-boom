export function removeStaleMediaBlockingRule(
  declarativeNetRequest = globalThis.chrome?.declarativeNetRequest,
) {
  const updateDynamicRules = declarativeNetRequest?.updateDynamicRules;
  if (typeof updateDynamicRules !== 'function') return false;

  try {
    const result = updateDynamicRules.call(declarativeNetRequest, {
      removeRuleIds: [1],
    });
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

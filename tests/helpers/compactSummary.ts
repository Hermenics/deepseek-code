/** Builds a valid compact handoff while keeping the supplied text available in every section. */
export function validCompactSummary(sectionText: string): string {
  return Array.from({ length: 9 }, (_, index) => {
    const content = index === 5
      ? `- Completed: None\n- Pending: ${sectionText}\n- Blocked: None\n- Next action: Continue from the retained source evidence.`
      : sectionText
    return `## ${index + 1}. Section\n${content}`
  }).join('\n')
}

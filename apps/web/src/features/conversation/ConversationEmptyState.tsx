export function ConversationEmptyState(props: { projectName?: string }) {
  const title = props.projectName ? `要在 ${props.projectName} 中处理什么？` : '今天要让 Clawee 处理什么？';

  return (
    <section className="conversation-empty-state" aria-labelledby="conversation-empty-title">
      <h2 id="conversation-empty-title">{title}</h2>
    </section>
  );
}

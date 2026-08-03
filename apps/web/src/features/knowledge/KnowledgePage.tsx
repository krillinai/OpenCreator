import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Bot, Building2, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import {
  createKnowledgeAnswer,
  getAccessibleKnowledgeScopes,
  getKnowledgeProfile,
  getKnowledgeSuggestions,
  type KnowledgeAccessLevel,
  type KnowledgeEvidence,
  type KnowledgeProfile,
  type KnowledgeRole
} from './knowledge-model.js';
import './knowledge.css';

type KnowledgeMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  evidence?: KnowledgeEvidence[];
};

const accessLevelLabels: Record<KnowledgeAccessLevel, string> = {
  organization: '全员可用',
  team: '所属团队',
  restricted: '受限范围'
};

export function KnowledgePage() {
  const nextMessageId = useRef(0);
  const [role, setRole] = useState<KnowledgeRole>('employee');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<KnowledgeMessage[]>(() => [
    createWelcomeMessage(getKnowledgeProfile('employee'))
  ]);
  const profile = getKnowledgeProfile(role);
  const scopes = getAccessibleKnowledgeScopes(role);
  const suggestions = getKnowledgeSuggestions(role);

  function switchRole(nextRole: KnowledgeRole) {
    if (nextRole === role) return;
    const nextProfile = getKnowledgeProfile(nextRole);
    setRole(nextRole);
    setDraft('');
    setMessages([createWelcomeMessage(nextProfile)]);
  }

  function sendQuestion(value: string) {
    const question = value.trim();
    if (question.length === 0) return;
    const answer = createKnowledgeAnswer(role, question);
    const id = `${role}-${nextMessageId.current++}`;
    setMessages(current => [
      ...current,
      { id: `${id}-user`, role: 'user', text: question },
      { id: `${id}-assistant`, role: 'assistant', text: answer.text, evidence: answer.evidence }
    ]);
    setDraft('');
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendQuestion(draft);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendQuestion(draft);
  }

  return (
    <main className="knowledge-page">
      <div className="knowledge-page__inner">
        <header className="knowledge-header">
          <div>
            <div className="knowledge-title-row">
              <h1>企业知识库</h1>
              <span>静态示例</span>
            </div>
            <p>直接提问，回答会自动遵循当前身份的知识权限</p>
          </div>
          <div className="knowledge-role-switch" role="group" aria-label="知识库视图">
            <button type="button" aria-pressed={role === 'employee'} onClick={() => switchRole('employee')}>员工视图</button>
            <button type="button" aria-pressed={role === 'admin'} onClick={() => switchRole('admin')}>管理员视图</button>
          </div>
        </header>

        <div className="knowledge-notice" role="note">
          静态示例数据，未连接企业知识服务
        </div>

        <div className="knowledge-workbench">
          <section className="knowledge-conversation" aria-label="知识对话">
            <div className="knowledge-conversation__body" role="log" aria-live="polite">
              <div className="knowledge-conversation__intro">
                <span><Sparkles size={15} aria-hidden="true" />权限内推荐</span>
                <div className="knowledge-suggestions">
                  {suggestions.map(suggestion => (
                    <button key={suggestion} type="button" onClick={() => sendQuestion(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <div className="knowledge-messages">
                {messages.map(message => (
                  <article className="knowledge-message" data-role={message.role} key={message.id}>
                    <div className="knowledge-message__avatar" aria-hidden="true">
                      {message.role === 'assistant' ? <Bot size={17} /> : <UserRound size={16} />}
                    </div>
                    <div className="knowledge-message__content">
                      <strong>{message.role === 'assistant' ? '知识助手' : profile.name}</strong>
                      <p className="knowledge-message__text">{message.text}</p>
                      {message.evidence && message.evidence.length > 0 ? (
                        <div className="knowledge-evidence" aria-label="回答依据">
                          {message.evidence.map(item => (
                            <span key={item.scopeId}>{item.label} · {item.count} 条依据</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <form className="knowledge-composer" onSubmit={submitQuestion}>
              <textarea
                aria-label="询问企业知识"
                onChange={event => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="询问制度、产品、客户流程或其他企业知识"
                rows={2}
                value={draft}
              />
              <button type="submit" aria-label="发送" disabled={draft.trim().length === 0} title="发送">
                <ArrowUp size={18} aria-hidden="true" />
              </button>
            </form>
          </section>

          <aside className="knowledge-permissions" aria-label="当前知识权限">
            <header>
              <span className="knowledge-profile-icon" aria-hidden="true">
                {role === 'admin' ? <Building2 size={18} /> : <UserRound size={18} />}
              </span>
              <div><strong>{profile.name}</strong><span>{profile.department} · {profile.roleLabel}</span></div>
            </header>
            <div className="knowledge-permission-status">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>已按当前身份过滤</span>
            </div>
            <div className="knowledge-permission-heading">
              <h2>可询问范围</h2>
              <span>{scopes.length} 个知识域</span>
            </div>
            <ul className="knowledge-scope-list">
              {scopes.map(scope => (
                <li key={scope.id}>
                  <div><strong>{scope.name}</strong><span>{scope.summary}</span></div>
                  <small>{accessLevelLabels[scope.accessLevel]} · {scope.itemCount} 条知识</small>
                </li>
              ))}
            </ul>
            <p className="knowledge-permission-footnote">回答只使用你有权访问的企业知识。</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

function createWelcomeMessage(profile: KnowledgeProfile): KnowledgeMessage {
  return {
    id: `welcome-${profile.id}`,
    role: 'assistant',
    text: profile.id === 'admin'
      ? '你好，企业管理员。你可以询问全企业知识，我会在回答中标注使用的知识域。'
      : `上午好，${profile.name}。你可以直接询问公司制度、产品资料和客户成功相关问题。`
  };
}

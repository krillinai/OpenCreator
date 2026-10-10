import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import './personal-center.css';

export function AccountAvatar(props: {
  email?: string; accountId?: string; avatarUrl?: string; large?: boolean;
  loadAvatar?(accountId: string, revision: string): Promise<Blob>;
}) {
  const [image, setImage] = useState<{ key: string; url: string }>();
  const key = `${props.accountId ?? ''}:${props.avatarUrl ?? ''}`;
  useEffect(() => {
    if (!props.email || !props.accountId || !props.avatarUrl || !props.loadAvatar) return;
    let active = true;
    let objectURL: string | undefined;
    void props.loadAvatar(props.accountId, props.avatarUrl).then(blob => {
      if (!active) return;
      objectURL = URL.createObjectURL(blob);
      setImage({ key, url: objectURL });
    }).catch(() => undefined);
    return () => { active = false; if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [props.email, props.accountId, props.avatarUrl, props.loadAvatar, key]);
  return <span className={`account-avatar${props.large ? ' account-avatar--large' : ''}`} aria-hidden="true">
    {props.email ? props.email.trim().charAt(0).toUpperCase() : <UserRound size={props.large ? 28 : 18}/>}
    {props.email && props.avatarUrl && image?.key === key ? <img src={image.url} alt="" onError={() => setImage(undefined)}/> : null}
  </span>;
}

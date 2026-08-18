import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode
} from 'react';
import { ConfirmDialog } from './ConfirmDialog.js';

export type ConfirmDialogOptions = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PendingConfirmation = ConfirmDialogOptions & {
  id: number;
  resolve(result: boolean): void;
};

type ConfirmDialogContextValue = (options: ConfirmDialogOptions) => Promise<boolean>;

const standaloneConfirm: ConfirmDialogContextValue = async () => false;

const ConfirmDialogContext = createContext<ConfirmDialogContextValue>(standaloneConfirm);

export function ConfirmDialogProvider({ children }: PropsWithChildren) {
  const nextId = useRef(0);
  const [queue, setQueue] = useState<PendingConfirmation[]>([]);
  const current = queue[0];

  const confirm = useCallback<ConfirmDialogContextValue>(options => new Promise(resolve => {
    nextId.current += 1;
    setQueue(items => [...items, { ...options, id: nextId.current, resolve }]);
  }), []);

  function finish(result: boolean) {
    if (current === undefined) return;
    current.resolve(result);
    setQueue(items => items[0]?.id === current.id
      ? items.slice(1)
      : items.filter(item => item.id !== current.id));
  }

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={current !== undefined}
        title={current?.title ?? ''}
        description={current?.description ?? ''}
        confirmLabel={current?.confirmLabel ?? ''}
        {...(current?.cancelLabel === undefined ? {} : { cancelLabel: current.cancelLabel })}
        destructive={current?.destructive}
        onCancel={() => finish(false)}
        onConfirm={() => finish(true)}
      />
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmDialogContextValue {
  return useContext(ConfirmDialogContext);
}

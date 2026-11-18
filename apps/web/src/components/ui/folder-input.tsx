import { useState, type InputHTMLAttributes } from 'react';
import { desktop } from '../../desktop.ts';
import { Button } from './primitives.tsx';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/**
 * A text field for a folder on the server's machine. In the desktop app it adds Browse, which opens the system folder
 * dialog (bridge `pickFolder`) and fills in the absolute path it returns. A browser or a phone cannot hand the page a
 * path (and its folders are not the server's), so there the field stays as typed text only.
 * `onPick`: after a folder is picked, for a field that saves as it goes. `dialogTitle`: the dialog's title.
 * `compact`: Browse as an icon only, for a row with no room. `wrapperClassName`: the field and button's row.
 */
export function FolderInput({
  value,
  onChange,
  onPick,
  dialogTitle,
  compact,
  className = '!text-[13px]',
  wrapperClassName = '',
  ...input
}: InputProps & {
  value: string;
  onChange: (value: string) => void;
  onPick?: (path: string) => void;
  dialogTitle: string;
  compact?: boolean;
  wrapperClassName?: string;
}) {
  const [picking, setPicking] = useState(false);
  const pickFolder = desktop?.pickFolder;
  const browse = async () => {
    if (!pickFolder) return;
    setPicking(true);
    try {
      const path = await pickFolder({ title: dialogTitle, defaultPath: value.trim() || (typeof input.placeholder === 'string' ? input.placeholder : undefined) });
      if (path) {
        onChange(path);
        onPick?.(path);
      }
    } catch {
      // The dialog could not open; the field still takes a typed path.
    } finally {
      setPicking(false);
    }
  };
  const field = <input {...input} type="text" className={`field font-mono ${pickFolder ? 'min-w-0 flex-1' : ''} ${className}`} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (!pickFolder) return field;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${wrapperClassName}`}>
      {field}
      <Button
        icon="folder"
        size={compact ? 'sm' : 'md'}
        variant={compact ? 'ghost' : 'secondary'}
        busy={picking}
        onClick={() => void browse()}
        aria-label={`Browse for ${dialogTitle.charAt(0).toLowerCase()}${dialogTitle.slice(1)}`}
        title="Choose a folder"
        className={compact ? 'shrink-0 !px-2' : 'shrink-0'}
      >
        {compact ? null : 'Browse'}
      </Button>
    </div>
  );
}

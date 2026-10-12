import { useCallback } from "react";
import { folderFacts } from "./folderFacts.js";
import { BackIcon, ChevronRightIcon } from "./icons.js";
import type { ManagerProps } from "./useFileManager.js";

interface CrumbButtonProps {
  readonly id: string | null;
  readonly label: string;
  readonly here: boolean;
  readonly onOpen: (id: string | null) => void;
}

function CrumbButton({ id, label, here, onOpen }: CrumbButtonProps) {
  const open = useCallback(() => onOpen(id), [onOpen, id]);
  return <button type="button" className="nfm-crumb" aria-current={here ? "location" : undefined} onClick={open}>{label}</button>;
}

interface BackButtonProps {
  readonly target: string | null;
  readonly label: string;
  readonly onOpen: (id: string | null) => void;
}

function BackButton({ target, label, onOpen }: BackButtonProps) {
  const back = useCallback(() => onOpen(target), [onOpen, target]);
  return <button type="button" className="nfm-iconbtn nfm-back" aria-label={`Back to ${label}`} onClick={back}><BackIcon /></button>;
}

/** Folder path: full trail on desktop, a back button and the folder name on touch. */
export function Breadcrumbs<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, compact }, navigator: { folderId, navigate } } = manager;
  const { crumbs, current, currentName } = folderFacts(index, folderId, labels.root);
  if (compact) {
    return (
      <nav className="nfm-crumbs" aria-label="Folder path">
        {folderId !== null && <BackButton target={current?.parentId ?? null} label={crumbs.at(-1)?.name ?? labels.root} onOpen={navigate} />}
        <span className="nfm-crumb" aria-current="location">{currentName}</span>
      </nav>
    );
  }
  return (
    <nav className="nfm-crumbs" aria-label="Folder path">
      <ol>
        <li><CrumbButton id={null} label={labels.root} here={folderId === null} onOpen={navigate} /></li>
        {crumbs.map((node) => (
          <li key={node.id}><ChevronRightIcon /><CrumbButton id={node.id} label={node.name} here={false} onOpen={navigate} /></li>
        ))}
        {current !== null && <li><ChevronRightIcon /><span className="nfm-crumb" aria-current="location">{current.name}</span></li>}
      </ol>
    </nav>
  );
}

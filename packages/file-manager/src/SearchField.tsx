import { useCallback, type ChangeEvent } from "react";
import { folderFacts } from "./folderFacts.js";
import { CloseIcon, SearchIcon } from "./icons.js";
import type { ManagerProps } from "./useFileManager.js";

export function SearchField<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels }, navigator: { folderId }, options: { query, setQuery } } = manager;
  const { currentName } = folderFacts(index, folderId, labels.root);
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), [setQuery]);
  const clear = useCallback(() => setQuery(""), [setQuery]);
  return (
    <label className="nfm-field nfm-search">
      <SearchIcon />
      <input type="search" value={query} aria-label={`Search in ${currentName}`} placeholder={folderId === null ? labels.searchPlaceholder : `Search in ${currentName}`} autoComplete="off" onChange={change} />
      {query !== "" && <button type="button" className="nfm-field-clear" aria-label="Clear search" onClick={clear}><CloseIcon /></button>}
    </label>
  );
}

import {
  ArrowDown, ArrowRight, ArrowUp, Captions, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronsUpDown, File, FileText, FileVideoCamera, Folder,
  FolderInput, FolderOpen, FolderPlus, FolderTree, Funnel, LockKeyhole,
  Search, TextCursorInput, Trash2, TriangleAlert, X,
  type LucideIcon,
} from "lucide-react";

// One icon family and optical weight. Keep small navigation glyphs compact,
// but give file types and actions enough room to remain recognizable.
function icon(Glyph: LucideIcon, size = 18) {
  return function ManagerIcon() {
    return (
      <Glyph
        className="nfm-icon"
        size={size}
        strokeWidth={1.8}
        aria-hidden="true"
        focusable="false"
      />
    );
  };
}

export const FolderIcon = icon(Folder);
export const FolderOpenIcon = icon(FolderOpen);
export const FileIcon = icon(File);
export const VideoFileIcon = icon(FileVideoCamera);
export const TextFileIcon = icon(FileText);
export const CaptionsIcon = icon(Captions);
export const ChevronRightIcon = icon(ChevronRight, 14);
export const ChevronDownIcon = icon(ChevronDown, 14);
export const ArrowUpIcon = icon(ArrowUp, 14);
export const ArrowDownIcon = icon(ArrowDown, 14);
export const ArrowRightIcon = icon(ArrowRight, 16);
export const SortableIcon = icon(ChevronsUpDown, 14);
export const FilterIcon = icon(Funnel, 14);
export const SearchIcon = icon(Search, 16);
export const CloseIcon = icon(X, 16);
export const NewFolderIcon = icon(FolderPlus);
export const MoveIcon = icon(FolderInput);
export const RenameIcon = icon(TextCursorInput);
export const TrashIcon = icon(Trash2);
export const LockIcon = icon(LockKeyhole, 12);
export const CheckIcon = icon(Check, 14);
export const FolderTreeIcon = icon(FolderTree);
export const WarnIcon = icon(TriangleAlert, 16);
export const BackIcon = icon(ChevronLeft, 16);

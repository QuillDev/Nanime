import type { ReactNode } from "react";
import { CaptionsIcon, FileIcon, FolderIcon, FolderOpenIcon, TextFileIcon, VideoFileIcon } from "./icons.js";
import type { FileItem } from "./types.js";

const VIDEO = /\.(?:mkv|mp4|m4v|webm|avi|mov|ts)$/iu;
const SUBTITLE = /\.(?:ass|ssa|srt|vtt)$/iu;
const TEXT = /\.(?:txt|md|nfo|json)$/iu;

function fileTypeIcon(name: string): ReactNode {
  if (VIDEO.test(name)) {
    return <VideoFileIcon />;
  }
  if (SUBTITLE.test(name)) {
    return <CaptionsIcon />;
  }
  return TEXT.test(name) ? <TextFileIcon /> : <FileIcon />;
}

/** Built-in glyph for an item when the host doesn't supply `renderIcon`. */
export function defaultIcon<M>(item: FileItem<M>, open: boolean): ReactNode {
  if (item.kind === "folder") {
    return open ? <FolderOpenIcon /> : <FolderIcon />;
  }
  return fileTypeIcon(item.name);
}

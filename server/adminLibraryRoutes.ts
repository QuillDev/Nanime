import { extname } from "node:path";
import type { AuthUser } from "../shared/types.ts";
import { recoverLibraryFileOperations, type LibraryFileContext } from "./libraryFileOperations.ts";
import { episodeNamesResponse } from "./episodeNames.ts";
import { libraryFilesResponse } from "./libraryFilesRoutes.ts";
import { absolutePath } from "./libraryPaths.ts";
import { beginLibraryMutation, noteLibraryMutation, refreshInBackground } from "./mediaLibrary.ts";
import { torrentOwnership } from "./torrents.ts";
import { activeTransferPaths, downloadRoutes } from "./downloads.ts";
import { moveTrickplayCache } from "./trickplay.ts";

interface AdminLibraryConfiguration {
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly directPlayExtensions: ReadonlySet<string>;
}

interface AdminLibraryRequest {
  readonly req: Request;
  readonly pathname: string;
  readonly url: URL;
  readonly user: AuthUser;
}

export interface AdminLibraryRoutes {
  /** Torrent and library file routes; null when the path belongs elsewhere. */
  readonly respond: (request: AdminLibraryRequest) => Promise<Response> | null;
  /** Rolls back file operations a previous process didn't finish. */
  readonly recover: () => Promise<number>;
}

function libraryFileContext(configuration: AdminLibraryConfiguration): LibraryFileContext {
  const { mediaDir, mediaRoot, videoExtensions, directPlayExtensions } = configuration;
  return {
    root: mediaRoot,
    videoExtensions,
    lockSources: { roots: [...new Set([mediaRoot, mediaDir])], torrents: torrentOwnership, uploads: activeTransferPaths },
    beginMutation: beginLibraryMutation,
    afterCommit: async (plan) => {
      noteLibraryMutation();
      void refreshInBackground({ mediaDir, videoExtensions, directPlayExtensions });
      const videos = plan.files.filter((file) => videoExtensions.has(extname(file.from).toLowerCase()));
      await Promise.all(videos.map((file) => moveTrickplayCache(absolutePath(mediaRoot, file.from), absolutePath(mediaRoot, file.to))));
    },
  };
}

function forbidden(): Promise<Response> {
  return Promise.resolve(new Response("Forbidden", { status: 403 }));
}

/** Admin-only library management: downloads and the library file manager. */
export function adminLibraryRoutes(configuration: AdminLibraryConfiguration): AdminLibraryRoutes {
  const context = libraryFileContext(configuration);
  const downloads = downloadRoutes(configuration);
  return {
    respond: ({ req, pathname, url, user }) => {
      if (pathname === "/api/library/files/episode-names" && req.method === "POST") {
        return user.isAdmin ? episodeNamesResponse(req, { context, actor: user }) : forbidden();
      }
      if (pathname === "/api/library/files" || pathname.startsWith("/api/library/files/")) {
        return user.isAdmin ? libraryFilesResponse({ req, pathname, context, actor: user }) : forbidden();
      }
      if (downloads.handles(pathname)) {
        return user.isAdmin ? downloads.respond(req, url) : forbidden();
      }
      return null;
    },
    recover: async () => {
      const recovered = await recoverLibraryFileOperations(configuration.mediaRoot);
      downloads.start();
      return recovered;
    },
  };
}

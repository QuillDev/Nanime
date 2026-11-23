import { useMemo } from "react";
import { Player } from "../components/Player.tsx";
import { WatchTogetherContext, useWatchTogetherContext } from "../hooks/watchTogetherContext.ts";
import type { ShowGroup } from "../lib/library.ts";
import type { PlaybackProgressMap } from "../types.ts";
import { showPageMetadata } from "./seasonsFixtures.ts";
import { ShowPreview } from "./ShowPreview.tsx";

export { ShowPreview } from "./ShowPreview.tsx";

const noop = (): void => undefined;
const PARTY_ID = "preview-party";
// A title long enough to be cut off beside the party button.
const EPISODE = { number: 2, title: "The Lamplighter's Long Walk Home Through the Flooded Quarter" };
const GUESTS = ["mika", "ren", "sora", "haru", "yuki", "aoi"];

function partyMembers(crowded: boolean) {
  const guests = GUESTS.slice(0, crowded ? GUESTS.length : 2).map((name) => ({ id: name, name, isHost: false, isSelf: false }));
  return [{ id: "self", name: "quill", isHost: true, isSelf: true }, ...guests];
}

/** A party the viewer hosts, laid over the real session so the panel has people to list. */
function PreviewParty({ crowded, children }: { readonly crowded: boolean; readonly children: React.ReactNode }): React.JSX.Element {
  const session = useWatchTogetherContext();
  const party = useMemo(() => {
    const memberList = partyMembers(crowded);
    return {
      ...session,
      host: { id: PARTY_ID, memberToken: "", connectionId: "", incarnation: 0 },
      snapshot: {
        receivedAt: 0,
        latency: 0,
        state: { id: PARTY_ID, rel: null, position: 0, paused: true, rate: 1, updatedAt: 0, serverTime: 0, isHost: true, generation: 1, hostName: "quill", members: memberList.length, memberList },
      },
    };
  }, [crowded, session]);
  return <WatchTogetherContext value={party}>{children}</WatchTogetherContext>;
}

interface PlayerPreviewProps {
  readonly show: ShowGroup;
  readonly progress: PlaybackProgressMap;
  /** "party" seats a few guests, "party-crowded" more than the panel fits; anything else leaves no party running. */
  readonly party: string;
}

/** The player over the show page: the video never loads, so the controls stay as they are on open. */
export function PlayerPreview({ show, progress, party }: PlayerPreviewProps): React.JSX.Element {
  const [, entry = show.entries[0]] = show.entries;
  const library = useMemo(() => ({ shows: [show], metadata: showPageMetadata, progress, onSelect: noop }), [progress, show]);
  const player = entry !== undefined && (
    <Player
      entry={entry}
      episodeDisplay={EPISODE}
      nextAvailable
      library={library}
      initialProgress={progress[entry.rel]}
      onClose={noop}
      onNext={noop}
      anilistTarget={null}
      knownDuration={1440}
      preferredAudioLanguage={null}
    />
  );
  return (
    <>
      <ShowPreview show={show} progress={progress} />
      {party === "party" || party === "party-crowded" ? <PreviewParty crowded={party === "party-crowded"}>{player}</PreviewParty> : player}
    </>
  );
}

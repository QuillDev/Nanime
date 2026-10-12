// Fictitious, in-memory library. Nothing here maps to real files.
import { useMemo, type ReactNode } from "react";
import { ancestorsOf, buildIndex, modifiedColumn, sizeColumn, type FileColumn, type FileItem, type ItemLock } from "../src/index.ts";

export interface MediaMeta {
  readonly codec?: string;
  readonly resolution?: string;
  readonly subtitles?: string;
  readonly audio?: string;
  readonly download?: { readonly progress: number };
}

export type Item = FileItem<MediaMeta>;

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 86_400_000;
const BASE = Date.UTC(2026, 8, 30, 18, 0);

let seed = 7;
function rand(): number {
  seed = (seed * 16_807) % 2_147_483_647;
  return seed / 2_147_483_647;
}

interface FileFacts {
  readonly size: number;
  readonly daysAgo: number;
  readonly metadata?: MediaMeta;
}

/** Item builders for one parent folder (`null` = the library root). */
function under(parentId: string | null) {
  return {
    folder: (id: string, name: string, daysAgo = 20): Item => ({ id, parentId, name, kind: "folder", modifiedAt: BASE - daysAgo * DAY }),
    file: (id: string, name: string, { size, daysAgo, metadata }: FileFacts): Item => (metadata === undefined
      ? { id, parentId, name, kind: "file", size: Math.round(size), modifiedAt: BASE - daysAgo * DAY }
      : { id, parentId, name, kind: "file", size: Math.round(size), modifiedAt: BASE - daysAgo * DAY, metadata }),
  };
}

const HOSHIZORA_S1 = ["The Signal Tower", "Static Between Stars", "Night Shift", "Relay Point Nine", "Night Shift", "Lanterns on the Line", "A Quiet Frequency", "Overpass", "The Long Dark Hour", "Northbound", "Carrier Wave", "Last Transmission"];
const HOSHIZORA_S2 = ["Reboot", "Junction Rain", "Moth Light", "The Antenna Garden", "Low Orbit", "Paper Satellites", "Morning Relay"];
const KUMO = ["Platform Zero", "The Cloud Timetable", "Missed Connection", "Umbrella Exchange", "Terminus", "Rain Check", "Night Express", "The Lost Ticket", "Fog Signal", "Cloudline"];
const LANTERN = ["The Festival Case", "Ink and Ash", "Seven Paper Cranes", "The Locked Teahouse", "Moonlit Alibi", "The Kite Thief", "A Lantern Too Many", "Ember Street"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function libraryFolders(): Item[] {
  const root = under(null);
  const shows = under("shows");
  const hoshizora = under("hoshizora");
  const lantern = under("lantern");
  return [
    root.folder("shows", "Shows", 2),
    root.folder("movies", "Movies", 30),
    root.folder("incoming", "Incoming", 0),
    root.file("root-capture", "Untitled capture.mp4", { size: 412 * MB, daysAgo: 3, metadata: { codec: "H.264", resolution: "1080p", audio: "JPN" } }),

    shows.folder("hoshizora", "Hoshizora Relay", 2),
    hoshizora.folder("hz-s1", "Season 01", 40),
    hoshizora.folder("hz-s2", "Season 02", 0),
    hoshizora.folder("hz-extras", "Extras", 38),
    shows.folder("kumo", "Kumo no Kanata Station", 12),
    shows.folder("lantern", "Paper Lantern Detectives", 5),
    lantern.folder("pl-s1", "Season 01", 5),
    lantern.folder("pl-specials", "Specials", 9),
    shows.folder("misc", "Misc", 6),
  ];
}

function hoshizoraEpisodes(): Item[] {
  const season1 = under("hz-s1");
  const season2 = under("hz-s2");
  const first = HOSHIZORA_S1.map((title, i) => season1.file(`hz-s1-e${pad(i + 1)}`, `Hoshizora Relay - S01E${pad(i + 1)} - ${title}.mkv`, { size: (1.05 + rand() * 0.5) * GB, daysAgo: 60 - i, metadata: { codec: "HEVC", resolution: "1080p", subtitles: "ASS", audio: "JPN" } }));
  const second = HOSHIZORA_S2.map((title, i) => {
    const id = `hz-s2-e${pad(i + 1)}`;
    const name = `Hoshizora Relay - S02E${pad(i + 1)} - ${title}.mkv`;
    return i === 6
      ? season2.file(id, name, { size: 0.83 * GB, daysAgo: 0, metadata: { codec: "HEVC", resolution: "1080p", audio: "JPN", download: { progress: 0.62 } } })
      : season2.file(id, name, { size: (1.1 + rand() * 0.4) * GB, daysAgo: 14 - i * 2, metadata: { codec: "HEVC", resolution: "1080p", subtitles: i === 4 ? "SRT" : "ASS", audio: i < 3 ? "JPN, ENG" : "JPN" } });
  });
  return [...first, ...second];
}

function hoshizoraExtras(): Item[] {
  const season2 = under("hz-s2");
  const extras = under("hz-extras");
  return [
    season2.file("hz-s2-sub-05", "Hoshizora Relay - S02E05 - Low Orbit.en.ass", { size: 61 * 1024, daysAgo: 6 }),
    season2.file("hz-s2-sub-06", "Hoshizora Relay - S02E06 - Paper Satellites.en.ass", { size: 58 * 1024, daysAgo: 4 }),
    season2.file("hz-s2-op", "Creditless OP - Moth Light.mkv", { size: 186 * MB, daysAgo: 9, metadata: { codec: "HEVC", resolution: "1080p", audio: "JPN" } }),
    extras.file("hz-ex-ncop", "NCOP 01.mkv", { size: 172 * MB, daysAgo: 39, metadata: { codec: "HEVC", resolution: "1080p", audio: "JPN" } }),
    extras.file("hz-ex-nced", "NCED 01.mkv", { size: 168 * MB, daysAgo: 39, metadata: { codec: "HEVC", resolution: "1080p", audio: "JPN" } }),
    extras.file("hz-ex-pv", "Season 02 Teaser PV.mp4", { size: 48 * MB, daysAgo: 31, metadata: { codec: "H.264", resolution: "720p", subtitles: "SRT", audio: "JPN" } }),
  ];
}

function otherEpisodes(): Item[] {
  const kumo = under("kumo");
  const lantern = under("pl-s1");
  const stations = KUMO.map((title, i) => kumo.file(`kumo-e${pad(i + 1)}`, `Kumo no Kanata Station - ${pad(i + 1)} - ${title}.mp4`, { size: (480 + rand() * 260) * MB, daysAgo: 90 - i * 3, metadata: { codec: "H.264", resolution: "720p", subtitles: i % 4 === 3 ? undefined : "SRT", audio: "JPN" } as MediaMeta }));
  const cases = LANTERN.map((title, i) => lantern.file(`pl-s1-e${pad(i + 1)}`, `Paper Lantern Detectives - S01E${pad(i + 1)} - ${title}.mkv`, { size: (0.7 + rand() * 0.3) * GB, daysAgo: 20 - i, metadata: { codec: "AV1", resolution: i < 6 ? "1080p" : "2160p", subtitles: i === 2 ? undefined : "ASS", audio: "JPN, ENG" } as MediaMeta }));
  return [...stations, ...cases];
}

function looseFiles(): Item[] {
  const misc = under("misc");
  const movies = under("movies");
  const incoming = under("incoming");
  return [
    under("pl-specials").file("pl-sp1", "Paper Lantern Detectives - SP1 - Lantern Night.mkv", { size: 1.4 * GB, daysAgo: 9, metadata: { codec: "AV1", resolution: "1080p", subtitles: "ASS", audio: "JPN" } }),
    misc.file("misc-night", "Hoshizora Relay - S01E05 - Night Shift.mkv", { size: 1.21 * GB, daysAgo: 6, metadata: { codec: "H.264", resolution: "1080p", audio: "JPN" } }),
    misc.file("misc-trailer", "Glass Orchard - Trailer.mp4", { size: 96 * MB, daysAgo: 44, metadata: { codec: "H.264", resolution: "1080p", subtitles: "SRT", audio: "ENG" } }),
    misc.folder("misc-clips", "Clips", 15),
    under("misc-clips").file("misc-clip-1", "Rooftop scene.mp4", { size: 74 * MB, daysAgo: 15, metadata: { codec: "H.264", resolution: "1080p", audio: "JPN" } }),
    movies.file("mov-tidewater", "Tidewater Signal (2024).mkv", { size: 18.6 * GB, daysAgo: 30, metadata: { codec: "HEVC", resolution: "2160p", subtitles: "ASS", audio: "JPN, ENG" } }),
    movies.file("mov-orchard", "Glass Orchard (2023).mp4", { size: 3.9 * GB, daysAgo: 52, metadata: { codec: "H.264", resolution: "1080p", subtitles: "SRT", audio: "ENG" } }),
    incoming.file("in-lantern-09", "[Lumen] Paper Lantern Detectives - 09 [1080p].mkv", { size: 0.21 * GB, daysAgo: 0, metadata: { codec: "AV1", resolution: "1080p", audio: "JPN", download: { progress: 0.18 } } }),
    incoming.file("in-kumo-11", "[Lumen] Kumo no Kanata Station - 11 [720p].mp4", { size: 540 * MB, daysAgo: 1, metadata: { codec: "H.264", resolution: "720p", audio: "JPN" } }),
    incoming.file("in-notes", "release notes.txt", { size: 2.1 * 1024, daysAgo: 1 }),
  ];
}

/** The same fictitious library every time: sizes come from a reseeded generator, in a fixed order. */
export function createFixture(): Item[] {
  seed = 7;
  const folders = libraryFolders();
  const hoshizora = hoshizoraEpisodes();
  const extras = hoshizoraExtras();
  const others = otherEpisodes();
  return [...folders, ...hoshizora, ...extras, ...others, ...looseFiles()];
}

/** Host lock policy: an active download pins the file and every folder above it. */
export function createLockPolicy(items: readonly Item[]): (item: Item) => ItemLock | null {
  const index = buildIndex(items);
  const holders = new Map<string, string>();
  for (const item of items) {
    if (item.metadata?.download !== undefined) {
      for (const ancestor of ancestorsOf(index, item.id)) {
        if (!holders.has(ancestor.id)) {
          holders.set(ancestor.id, item.name);
        }
      }
    }
  }
  return function lockOf(item: Item): ItemLock | null {
    const download = item.metadata?.download;
    if (download !== undefined) {
      return { tone: "busy", reason: `Downloading (${Math.round(download.progress * 100)}%). It can be renamed, moved or deleted once it finishes.` };
    }
    const holder = holders.get(item.id);
    return holder === undefined ? null : { tone: "locked", reason: `Contains an active download (${holder}).` };
  };
}

interface DownloadMeterProps {
  readonly percent: number;
}

function DownloadMeter({ percent }: DownloadMeterProps) {
  const fill = useMemo(() => ({ width: `${percent}%` }), [percent]);
  return (
    <span className="demo-dl" title={`Downloading, ${percent}%`}>
      <span className="demo-dl-track"><span style={fill} /></span>
      {percent}%
    </span>
  );
}

function meta(item: Item): MediaMeta | undefined {
  return item.kind === "file" ? item.metadata : undefined;
}

export const columns: readonly FileColumn<MediaMeta>[] = [
  sizeColumn(),
  { id: "codec", header: "Codec", width: "84px", sortable: true, filterable: true, value: (item) => meta(item)?.codec },
  { id: "resolution", header: "Res", width: "72px", sortable: true, filterable: true, value: (item) => meta(item)?.resolution, minViewport: 860 },
  { id: "subtitles", header: "Subs", width: "76px", sortable: true, filterable: true, value: (item) => meta(item)?.subtitles },
  { id: "audio", header: "Audio", width: "92px", sortable: true, filterable: true, value: (item) => meta(item)?.audio, minViewport: 1180 },
  {
    id: "state",
    header: "State",
    width: "108px",
    sortable: true,
    filterable: true,
    value: (item) => (meta(item)?.download === undefined ? undefined : "Downloading"),
    /** A progress meter while the host is still downloading the file. */
    render(item): ReactNode {
      const download = meta(item)?.download;
      return download === undefined ? null : <DownloadMeter percent={Math.round(download.progress * 100)} />;
    },
  },
  modifiedColumn({ minViewport: 1020 }),
];

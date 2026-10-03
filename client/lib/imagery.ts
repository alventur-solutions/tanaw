export type ImageryRelease = { id: string; date: string; tileUrl: string };
export type ImageryCatalog = { sourceUrl: string; releases: ImageryRelease[] };

export function formatImageryDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function releaseForYear(releases: ImageryRelease[], year: number) {
  return (
    releases.filter((release) => release.date <= `${year}-12-31`).at(-1) ??
    releases[0]
  );
}

export function releasesAroundProject(
  releases: ImageryRelease[],
  year: number,
  startDate: string | null,
  completionDate: string | null,
) {
  if (!releases.length) return { before: null, after: null };

  const start = startDate ?? `${year}-01-01`;
  const end = completionDate ?? `${year}-12-31`;
  let beforeIndex = -1;
  for (let index = 0; index < releases.length; index += 1) {
    if (releases[index].date <= start) beforeIndex = index;
  }
  let afterIndex = releases.findIndex((release) => release.date >= end);
  if (beforeIndex < 0) beforeIndex = 0;
  if (afterIndex < 0) afterIndex = releases.length - 1;

  if (beforeIndex >= afterIndex && releases.length > 1) {
    if (beforeIndex === 0) afterIndex = 1;
    else if (afterIndex === releases.length - 1) beforeIndex -= 1;
    else beforeIndex = afterIndex - 1;
  }

  return {
    before: releases[beforeIndex],
    after: releases[afterIndex],
  };
}

// Keep the native date menus readable while retaining a sample from the archive
// and always including the first and latest releases.
export function visibleReleases(releases: ImageryRelease[]) {
  const out: ImageryRelease[] = [];
  let previous = -Infinity;
  for (const release of releases) {
    const current = Date.parse(release.date);
    if (current - previous >= 150 * 864e5) {
      out.push(release);
      previous = current;
    }
  }
  if (releases.length && out.at(-1)?.id !== releases.at(-1)?.id)
    out.push(releases.at(-1)!);
  return out;
}

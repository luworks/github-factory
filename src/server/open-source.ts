/** Conservative SPDX admission. Unknown/custom/source-available licenses are
 * not equivalent to an observed open-source license. No model decides this. */
const OPEN_SOURCE_SPDX = new Set([
  "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear",
  "ISC", "0BSD", "Zlib", "BSL-1.0", "Unlicense", "CC0-1.0", "MPL-2.0", "EPL-1.0", "EPL-2.0",
  "GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later",
  "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later",
  "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "Artistic-2.0", "OSL-3.0", "AFL-3.0",
  "NCSA", "PostgreSQL", "Python-2.0", "OFL-1.1", "EUPL-1.2", "WTFPL", "Vim", "CDDL-1.0", "CDDL-1.1",
]);

export function isOpenSourceLicense(spdx: unknown): spdx is string {
  return typeof spdx === "string" && OPEN_SOURCE_SPDX.has(spdx);
}

export function requireOpenSourceLicense(spdx: unknown): asserts spdx is string {
  if (!isOpenSourceLicense(spdx)) throw Object.assign(
    new Error("Only public repositories with a recognized open-source license can be analyzed. Missing or custom licensing remains unverified."),
    { status: 403, code: "OPEN_SOURCE_REQUIRED" },
  );
}

import { diffJson, diffLines } from 'diff';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import * as TOML from 'smol-toml';
import { format as sqlFormatter } from 'sql-formatter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const IPV4_MAX = 0xffff_ffff;

const XML_PARSE_OPTIONS = {
  allowBooleanAttributes: true,
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  ignoreDeclaration: false,
  ignorePiTags: false,
  parseAttributeValue: false,
  parseTagValue: false,
  textNodeName: '#text',
  trimValues: false,
} as const;

const XML_BUILD_OPTIONS = {
  attributeNamePrefix: '@_',
  format: true,
  ignoreAttributes: false,
  indentBy: '  ',
  suppressEmptyNode: false,
  textNodeName: '#text',
} as const;

type SqlFormatterOptions = NonNullable<Parameters<typeof sqlFormatter>[1]>;

export type SqlDialect = NonNullable<SqlFormatterOptions['language']>;

export interface DiffPart {
  added?: boolean;
  count?: number;
  removed?: boolean;
  value: string;
}

export interface RegexMatch {
  groups: string[];
  index: number;
  match: string;
  namedGroups?: Record<string, string>;
}

export interface RegexTestResult {
  error?: string;
  isMatch: boolean;
  isValid: boolean;
  matches: RegexMatch[];
}

export interface Ipv4AddressConversion {
  address: string;
  binary: string;
  hexadecimal: string;
  integer: number;
  octets: [number, number, number, number];
}

export interface Ipv4SubnetResult {
  address: string;
  broadcastAddress: string;
  cidr: string;
  firstUsableAddress: string;
  lastUsableAddress: string;
  netmask: string;
  networkAddress: string;
  networkCidr: string;
  prefixLength: number;
  totalAddresses: number;
  usableHosts: number;
  wildcardMask: string;
}

export interface MacAddressOptions {
  locallyAdministered?: boolean;
  multicast?: boolean;
  separator?: ':' | '-';
  uppercase?: boolean;
}

interface LibraryDiffPart {
  added?: boolean;
  count?: number;
  removed?: boolean;
  value: string;
}

interface XmlValidationFailure {
  err: {
    col: number;
    line: number;
    msg: string;
  };
}

/** Ensures a value can be represented as a TOML document root. */
function assertTomlDocument(value: unknown): asserts value is Record<string, unknown> {
  // TOML documents require a table at the root, so arrays, primitives, and null cannot be serialized faithfully.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('TOML conversion requires an object at the document root.');
  }
}

/** Ensures a value can be represented as an XML document object. */
function assertXmlDocument(value: unknown): asserts value is Record<string, unknown> {
  // XML builders need named elements at the root, which JSON arrays and primitives do not provide.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('XML conversion requires an object at the document root.');
  }
}

/** Rejects malformed XML with the validator's source location. */
function assertValidXml(input: string): void {
  const validationResult = XMLValidator.validate(input);

  // A non-true validation result contains the parser error that is more useful than a later build failure.
  if (validationResult !== true) {
    const failure = validationResult as XmlValidationFailure;
    throw new SyntaxError(
      `Invalid XML at line ${failure.err.line}, column ${failure.err.col}: ${failure.err.msg}`,
    );
  }
}

/** Converts a library diff item into the stable shape exposed by this module. */
function normalizeDiffPart(part: LibraryDiffPart): DiffPart {
  return {
    added: part.added,
    count: part.count,
    removed: part.removed,
    value: part.value,
  };
}

/** Produces a readable message for thrown values of any JavaScript type. */
function errorMessage(error: unknown): string {
  // Native Error instances retain the actionable parser or regular-expression message.
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/** Converts a RegExp match into serializable UI data. */
function normalizeRegexMatch(match: RegExpMatchArray): RegexMatch {
  return {
    groups: match.slice(1),
    index: match.index as number,
    match: match[0],
    namedGroups: match.groups,
  };
}

/** Parses and validates one decimal IPv4 octet. */
function parseIpv4Octet(octet: string): number {
  // Canonical decimal syntax avoids ambiguous signed, hexadecimal, and legacy octal octets.
  if (!/^(0|[1-9]\d{0,2})$/.test(octet)) {
    throw new SyntaxError(`Invalid IPv4 octet: ${octet}`);
  }

  const value = Number(octet);

  // An IPv4 octet is exactly one unsigned byte.
  if (value > 255) {
    throw new RangeError(`IPv4 octet is outside 0-255: ${octet}`);
  }

  return value;
}

/** Parses a dotted-decimal IPv4 address into its unsigned 32-bit integer. */
function parseDottedIpv4(input: string): number {
  const parts = input.split('.');

  // IPv4 dotted notation must supply all four octets.
  if (parts.length !== 4) {
    throw new SyntaxError(`Invalid IPv4 address: ${input}`);
  }

  const first = parseIpv4Octet(parts[0]);
  const second = parseIpv4Octet(parts[1]);
  const third = parseIpv4Octet(parts[2]);
  const fourth = parseIpv4Octet(parts[3]);

  return (((first * 256 + second) * 256 + third) * 256 + fourth) >>> 0;
}

/** Verifies that a number fits in the full unsigned IPv4 address space. */
function assertIpv4Integer(value: number): void {
  // Fractional, unsafe, negative, and wider-than-32-bit values cannot map to one IPv4 address.
  if (!Number.isSafeInteger(value) || value < 0 || value > IPV4_MAX) {
    throw new RangeError('IPv4 integer must be between 0 and 4294967295.');
  }
}

/** Parses dotted, decimal, hexadecimal, or binary IPv4 input into an integer. */
function parseIpv4Value(input: string | number): number {
  // Numeric callers already identify the representation, so only range validation is needed.
  if (typeof input === 'number') {
    assertIpv4Integer(input);
    return input;
  }

  const value = input.trim();

  // A dot unambiguously identifies canonical dotted-decimal notation.
  if (value.includes('.')) {
    return parseDottedIpv4(value);
  }

  // A 0x prefix explicitly selects hexadecimal notation.
  if (/^0x[\da-f]{1,8}$/i.test(value)) {
    const parsed = Number.parseInt(value.slice(2), 16);
    assertIpv4Integer(parsed);
    return parsed;
  }

  // A 0b prefix explicitly selects binary notation with up to 32 bits.
  if (/^0b[01]{1,32}$/i.test(value)) {
    return Number.parseInt(value.slice(2), 2);
  }

  // An unprefixed 32-bit bit string is recognizable without conflicting with ordinary short decimals.
  if (/^[01]{32}$/.test(value)) {
    return Number.parseInt(value, 2);
  }

  // Remaining unsigned digits are interpreted as the common integer representation.
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    assertIpv4Integer(parsed);
    return parsed;
  }

  throw new SyntaxError(`Unsupported IPv4 representation: ${input}`);
}

/** Renders an unsigned 32-bit integer as dotted-decimal IPv4. */
function renderIpv4(value: number): string {
  assertIpv4Integer(value);

  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

/** Converts a CIDR prefix length into its unsigned IPv4 netmask. */
function prefixToMask(prefixLength: number): number {
  // A zero-length prefix has no network bits and cannot use a 32-bit left shift safely.
  if (prefixLength === 0) {
    return 0;
  }

  return (IPV4_MAX << (32 - prefixLength)) >>> 0;
}

/** Parses an IPv4 CIDR string into its address and prefix components. */
function parseIpv4Cidr(cidr: string): { addressValue: number; prefixLength: number } {
  const parts = cidr.trim().split('/');

  // CIDR syntax has exactly one address and one prefix component.
  if (parts.length !== 2) {
    throw new SyntaxError(`Invalid IPv4 CIDR: ${cidr}`);
  }

  // Prefixes are unsigned decimal counts, not alternate numeric representations.
  if (!/^\d{1,2}$/.test(parts[1])) {
    throw new SyntaxError(`Invalid IPv4 prefix length: ${parts[1]}`);
  }

  const prefixLength = Number(parts[1]);

  // IPv4 contains at most 32 network bits.
  if (prefixLength > 32) {
    throw new RangeError('IPv4 prefix length must be between 0 and 32.');
  }

  return {
    addressValue: parseDottedIpv4(parts[0]),
    prefixLength,
  };
}

/** Validates entropy bytes and returns a mutable copy for deterministic generation. */
function copyEntropy(entropy: ArrayLike<number>, minimumLength: number): number[] {
  // Generators need enough caller-provided entropy to fill every random field.
  if (entropy.length < minimumLength) {
    throw new RangeError(`At least ${minimumLength} entropy bytes are required.`);
  }

  const bytes = Array.from(entropy);

  // Every entropy element must be a real byte so bit operations remain deterministic.
  for (const byte of bytes) {
    // Values outside one unsigned byte indicate a caller contract error.
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new RangeError('Entropy values must be integers between 0 and 255.');
    }
  }

  return bytes;
}

/** Formats one byte as a two-character uppercase hexadecimal token. */
function formatHexByte(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase();
}

/** Formats one IPv6 group as four lowercase hexadecimal characters. */
function formatIpv6Group(group: number): string {
  return group.toString(16).padStart(4, '0');
}

/** Converts YAML text to indented JSON text. */
export function yamlToJson(input: string): string {
  return JSON.stringify(parseYaml(input), null, 2);
}

/** Converts a YAML object document to TOML text. */
export function yamlToToml(input: string): string {
  const value: unknown = parseYaml(input);
  assertTomlDocument(value);
  return TOML.stringify(value as Parameters<typeof TOML.stringify>[0]);
}

/** Converts JSON text to a normalized YAML document. */
export function jsonToYaml(input: string): string {
  const value: unknown = JSON.parse(input);
  return stringifyYaml(value, { lineWidth: 0 });
}

/** Converts a JSON object document to TOML text. */
export function jsonToToml(input: string): string {
  const value: unknown = JSON.parse(input);
  assertTomlDocument(value);
  return TOML.stringify(value as Parameters<typeof TOML.stringify>[0]);
}

/** Converts TOML text to indented JSON text. */
export function tomlToJson(input: string): string {
  return JSON.stringify(TOML.parse(input), null, 2);
}

/** Converts TOML text to a normalized YAML document. */
export function tomlToYaml(input: string): string {
  return stringifyYaml(TOML.parse(input), { lineWidth: 0 });
}

/** Converts XML text to indented JSON while preserving attributes and text nodes. */
export function xmlToJson(input: string): string {
  assertValidXml(input);
  const parser = new XMLParser(XML_PARSE_OPTIONS);
  return JSON.stringify(parser.parse(input), null, 2);
}

/** Converts a JSON document object to formatted XML text. */
export function jsonToXml(input: string): string {
  const value: unknown = JSON.parse(input);
  assertXmlDocument(value);
  const builder = new XMLBuilder(XML_BUILD_OPTIONS);
  const output = builder.build(value);
  assertValidXml(output);
  return output;
}

/** Parses and re-emits YAML using stable two-space indentation. */
export function formatYaml(input: string): string {
  return stringifyYaml(parseYaml(input), { indent: 2, lineWidth: 0 });
}

/** Parses and re-emits TOML in the library's canonical layout. */
export function formatToml(input: string): string {
  return TOML.stringify(TOML.parse(input));
}

/** Parses and re-emits XML with two-space indentation. */
export function formatXml(input: string): string {
  assertValidXml(input);
  const parser = new XMLParser(XML_PARSE_OPTIONS);
  const builder = new XMLBuilder(XML_BUILD_OPTIONS);
  return builder.build(parser.parse(input));
}

/** Formats SQL for the requested sql-formatter dialect. */
export function formatSqlText(input: string, dialect: SqlDialect = 'sql'): string {
  return sqlFormatter(input, {
    keywordCase: 'upper',
    language: dialect,
    linesBetweenQueries: 1,
  });
}

/** Computes a presentation-ready JSON diff from two JSON documents. */
export function jsonDiff(before: string, after: string): DiffPart[] {
  const beforeValue = JSON.parse(before) as Parameters<typeof diffJson>[0];
  const afterValue = JSON.parse(after) as Parameters<typeof diffJson>[1];
  return diffJson(beforeValue, afterValue).map(normalizeDiffPart);
}

/** Tests a regular expression and returns every match without mutating caller state. */
export function testRegex(input: string, pattern: string, flags = ''): RegexTestResult {
  let enumerationFlags = flags;

  // matchAll requires global mode, so a local clone adds it without changing the caller's requested expression.
  if (!enumerationFlags.includes('g')) {
    enumerationFlags += 'g';
  }

  try {
    const expression = new RegExp(pattern, enumerationFlags);
    const matches = Array.from(input.matchAll(expression), normalizeRegexMatch);

    return {
      isMatch: matches.length > 0,
      isValid: true,
      matches,
    };
  } catch (error: unknown) {
    return {
      error: errorMessage(error),
      isMatch: false,
      isValid: false,
      matches: [],
    };
  }
}

/** Normalizes an IPv4 representation and exposes its common converted forms. */
export function convertIpv4Address(input: string | number): Ipv4AddressConversion {
  const integer = parseIpv4Value(input);
  const address = renderIpv4(integer);
  const octets = address.split('.').map(Number) as [number, number, number, number];

  return {
    address,
    binary: integer.toString(2).padStart(32, '0'),
    hexadecimal: `0x${integer.toString(16).padStart(8, '0').toUpperCase()}`,
    integer,
    octets,
  };
}

/** Calculates network, broadcast, mask, and usable-host details for IPv4 CIDR. */
export function calculateIpv4Subnet(cidr: string): Ipv4SubnetResult {
  const { addressValue, prefixLength } = parseIpv4Cidr(cidr);
  const netmaskValue = prefixToMask(prefixLength);
  const wildcardValue = (~netmaskValue) >>> 0;
  const networkValue = (addressValue & netmaskValue) >>> 0;
  const broadcastValue = (networkValue | wildcardValue) >>> 0;
  const totalAddresses = 2 ** (32 - prefixLength);
  let firstUsableValue: number;
  let lastUsableValue: number;
  let usableHosts: number;

  // A /32 names one host, so its sole address is both the first and last usable address.
  if (prefixLength === 32) {
    firstUsableValue = networkValue;
    lastUsableValue = networkValue;
    usableHosts = 1;
  } else if (prefixLength === 31) {
    // RFC 3021 point-to-point /31 networks use both addresses without network or broadcast reservations.
    firstUsableValue = networkValue;
    lastUsableValue = broadcastValue;
    usableHosts = 2;
  } else {
    // Traditional wider subnets reserve the network and broadcast endpoints.
    firstUsableValue = networkValue + 1;
    lastUsableValue = broadcastValue - 1;
    usableHosts = totalAddresses - 2;
  }

  const address = renderIpv4(addressValue);
  const networkAddress = renderIpv4(networkValue);

  return {
    address,
    broadcastAddress: renderIpv4(broadcastValue),
    cidr: `${address}/${prefixLength}`,
    firstUsableAddress: renderIpv4(firstUsableValue),
    lastUsableAddress: renderIpv4(lastUsableValue),
    netmask: renderIpv4(netmaskValue),
    networkAddress,
    networkCidr: `${networkAddress}/${prefixLength}`,
    prefixLength,
    totalAddresses,
    usableHosts,
    wildcardMask: renderIpv4(wildcardValue),
  };
}

/** Builds a deterministic MAC address from caller-provided entropy bytes. */
export function generateMacAddress(
  entropy: ArrayLike<number>,
  options: MacAddressOptions = {},
): string {
  const {
    locallyAdministered = true,
    multicast = false,
    separator = ':',
    uppercase = true,
  } = options;
  const bytes = copyEntropy(entropy, 6).slice(0, 6);

  // Locally generated addresses set the U/L bit to avoid claiming an assigned vendor OUI.
  if (locallyAdministered) {
    bytes[0] |= 0x02;
  } else {
    // Explicit globally administered mode clears the U/L bit supplied by entropy.
    bytes[0] &= 0xfd;
  }

  // Multicast addresses set the I/G bit when that specialized mode is requested.
  if (multicast) {
    bytes[0] |= 0x01;
  } else {
    // Ordinary generated station addresses must remain unicast.
    bytes[0] &= 0xfe;
  }

  let output = bytes.map(formatHexByte).join(separator);

  // Lowercase output is an optional display preference; uppercase remains the canonical default.
  if (!uppercase) {
    output = output.toLowerCase();
  }

  return output;
}

/** Builds an RFC 4193 locally assigned /48 IPv6 ULA prefix from five entropy bytes. */
export function generateIpv6Ula(entropy: ArrayLike<number>): string {
  const bytes = copyEntropy(entropy, 5);
  const groups = [
    0xfd00 | bytes[0],
    (bytes[1] << 8) | bytes[2],
    (bytes[3] << 8) | bytes[4],
  ];

  return `${groups.map(formatIpv6Group).join(':')}::/48`;
}

/** Computes a line-oriented text diff suitable for side-by-side or unified rendering. */
export function compareText(before: string, after: string): DiffPart[] {
  return diffLines(before, after).map(normalizeDiffPart);
}

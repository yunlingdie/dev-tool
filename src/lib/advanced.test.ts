import { describe, expect, it } from 'vitest';

import {
  calculateIpv4Subnet,
  compareText,
  convertIpv4Address,
  expandIpv4Range,
  formatSqlText,
  formatToml,
  formatXml,
  formatYaml,
  generateIpv6Ula,
  generateMacAddress,
  jsonDiff,
  jsonToToml,
  jsonToXml,
  jsonToYaml,
  testRegex,
  tomlToJson,
  tomlToYaml,
  xmlToJson,
  yamlToJson,
  yamlToToml,
} from './advanced';

describe('structured data conversions', () => {
  // Groups round-trip checks for the supported structured text formats.
  it('converts between YAML, JSON, and TOML', () => {
    // Verifies values survive each supported YAML, JSON, and TOML route.
    const yaml = 'name: Ada\nactive: true\nprofile:\n  role: admin\n';
    const json = yamlToJson(yaml);
    const toml = yamlToToml(yaml);

    expect(JSON.parse(json)).toEqual({
      active: true,
      name: 'Ada',
      profile: { role: 'admin' },
    });
    expect(JSON.parse(tomlToJson(toml))).toEqual(JSON.parse(json));
    expect(JSON.parse(yamlToJson(jsonToYaml(json)))).toEqual(JSON.parse(json));
    expect(JSON.parse(yamlToJson(tomlToYaml(toml)))).toEqual(JSON.parse(json));
    expect(JSON.parse(tomlToJson(jsonToToml(json)))).toEqual(JSON.parse(json));
  });

  it('converts XML attributes and text without losing them', () => {
    // Verifies the XML mapping remains reversible for common element and attribute data.
    const xml = '<root id="7"><name>Ada</name></root>';
    const json = xmlToJson(xml);

    expect(JSON.parse(json)).toEqual({
      root: {
        '@_id': '7',
        name: 'Ada',
      },
    });
    expect(jsonToXml(json)).toContain('<root id="7">');
    expect(jsonToXml(json)).toContain('<name>Ada</name>');
  });

  it('rejects roots that TOML and XML cannot represent', () => {
    // Verifies unsupported array roots fail clearly instead of producing misleading documents.
    const convertArrayToToml = () => jsonToToml('[1, 2]');
    // Verifies unsupported primitive roots fail clearly for XML too.
    const convertPrimitiveToXml = () => jsonToXml('"value"');

    expect(convertArrayToToml).toThrow(/object at the document root/i);
    expect(convertPrimitiveToXml).toThrow(/object at the document root/i);
  });
});

describe('formatters and diffs', () => {
  // Groups canonical formatting and comparison behavior.
  it('formats YAML, TOML, XML, and SQL', () => {
    // Verifies each formatter emits readable normalized output.
    expect(formatYaml('root: {name: Ada, active: true}')).toContain('name: Ada');
    expect(formatToml('name="Ada"\n[profile]\nrole="admin"')).toContain('[profile]');
    expect(formatXml('<root><name>Ada</name></root>')).toContain('  <name>Ada</name>');
    expect(formatSqlText('select id,name from users where active=1')).toContain('SELECT');
    expect(formatSqlText('select id,name from users where active=1')).toMatch(/FROM\s+users/);
  });

  it('returns added and removed JSON and text parts', () => {
    // Verifies consumers can render both sides of structured and plain-text changes.
    const jsonParts = jsonDiff('{"name":"Ada"}', '{"name":"Grace"}');
    const textParts = compareText('first\nold\n', 'first\nnew\n');

    expect(jsonParts).toEqual(expect.arrayContaining([expect.objectContaining({ added: true })]));
    expect(jsonParts).toEqual(expect.arrayContaining([expect.objectContaining({ removed: true })]));
    expect(textParts).toEqual(expect.arrayContaining([expect.objectContaining({ added: true })]));
    expect(textParts).toEqual(expect.arrayContaining([expect.objectContaining({ removed: true })]));
  });
});

describe('regular expression testing', () => {
  // Groups valid and invalid regular-expression outcomes.
  it('collects all matches and capture groups without requiring a global flag', () => {
    // Verifies tester semantics enumerate matches while preserving capture data.
    const result = testRegex('id=12 id=34', 'id=(?<id>\\d+)', 'i');

    expect(result.isValid).toBe(true);
    expect(result.isMatch).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      groups: ['12'],
      index: 0,
      match: 'id=12',
      namedGroups: { id: '12' },
    });
  });

  it('returns an error result for invalid syntax', () => {
    // Verifies user-entered invalid patterns do not throw through the UI boundary.
    const result = testRegex('text', '[', '');

    expect(result.isValid).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe('IPv4 tools', () => {
  // Groups address conversion, subnet calculation, and bounded expansion.
  it('converts dotted, integer, hexadecimal, and binary address forms', () => {
    // Verifies all accepted representations normalize to the same IPv4 address.
    const dotted = convertIpv4Address('192.168.1.1');

    expect(dotted).toEqual({
      address: '192.168.1.1',
      binary: '11000000101010000000000100000001',
      hexadecimal: '0xC0A80101',
      integer: 3232235777,
      octets: [192, 168, 1, 1],
    });
    expect(convertIpv4Address(3232235777).address).toBe('192.168.1.1');
    expect(convertIpv4Address('0xC0A80101').address).toBe('192.168.1.1');
    expect(convertIpv4Address('0b11000000101010000000000100000001').address).toBe('192.168.1.1');
  });

  it('calculates conventional and point-to-point subnet boundaries', () => {
    // Verifies masks, endpoints, and RFC 3021 host semantics.
    const subnet = calculateIpv4Subnet('192.168.1.42/24');
    const pointToPoint = calculateIpv4Subnet('10.0.0.8/31');

    expect(subnet).toMatchObject({
      broadcastAddress: '192.168.1.255',
      firstUsableAddress: '192.168.1.1',
      lastUsableAddress: '192.168.1.254',
      netmask: '255.255.255.0',
      networkAddress: '192.168.1.0',
      totalAddresses: 256,
      usableHosts: 254,
      wildcardMask: '0.0.0.255',
    });
    expect(pointToPoint).toMatchObject({
      firstUsableAddress: '10.0.0.8',
      lastUsableAddress: '10.0.0.9',
      usableHosts: 2,
    });
  });

  it('expands inclusive ranges and enforces the safety limit', () => {
    // Verifies range output includes both endpoints and rejects oversized allocations.
    expect(expandIpv4Range('192.168.1.254', '192.168.2.1')).toEqual([
      '192.168.1.254',
      '192.168.1.255',
      '192.168.2.0',
      '192.168.2.1',
    ]);
    // Verifies callers must explicitly opt in to materializing larger ranges.
    const expandPastLimit = () => expandIpv4Range('10.0.0.1', '10.0.0.3', 2);
    expect(expandPastLimit).toThrow(/exceeding limit/i);
  });
});

describe('network identifier generation', () => {
  // Groups deterministic MAC and IPv6 ULA generation from supplied entropy.
  it('sets MAC administration bits according to options', () => {
    // Verifies default output is locally administered unicast and remains deterministic.
    expect(generateMacAddress(Uint8Array.from([0, 17, 34, 51, 68, 85]))).toBe(
      '02:11:22:33:44:55',
    );
    expect(
      generateMacAddress([255, 17, 34, 51, 68, 85], {
        locallyAdministered: false,
        separator: '-',
        uppercase: false,
      }),
    ).toBe('fc-11-22-33-44-55');
  });

  it('builds an RFC 4193 locally assigned prefix', () => {
    // Verifies the fixed fd prefix and 40-bit caller entropy are placed correctly.
    expect(generateIpv6Ula([1, 2, 3, 4, 5])).toBe('fd01:0203:0405::/48');
  });
});

import 'reflect-metadata'

import { Buffer } from 'node:buffer'

import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
  cryptoProvider,
} from '@peculiar/x509'
import { beforeAll, describe, expect, it } from 'vitest'

import { parseCertificate, verifyCertificateKeyPair } from './certificate'

interface RsaCertificateMaterial {
  certificatePem: string
  privateKeyPem: string
}

const RSA_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
}

/** Encodes test DER data in a conventional PEM envelope. */
function toPem(data: ArrayBuffer, type: string): string {
  const base64 = Buffer.from(data).toString('base64')
  const body = base64.match(/.{1,64}/g)!.join('\n')

  return `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----`
}

/** Generates a self-signed RSA certificate and its unencrypted PKCS#8 private key. */
async function createRsaCertificateMaterial(): Promise<RsaCertificateMaterial> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    RSA_ALGORITHM,
    true,
    ['sign', 'verify'],
  )
  const certificate = await X509CertificateGenerator.createSelfSigned(
    {
      extensions: [
        new SubjectAlternativeNameExtension([
          { type: 'dns', value: 'example.test' },
          { type: 'ip', value: '127.0.0.1' },
        ]),
        new BasicConstraintsExtension(true, 1, true),
        new KeyUsagesExtension(
          KeyUsageFlags.digitalSignature | KeyUsageFlags.keyCertSign,
          true,
        ),
        new ExtendedKeyUsageExtension([
          ExtendedKeyUsage.serverAuth,
          ExtendedKeyUsage.clientAuth,
        ]),
      ],
      keys: keyPair,
      name: 'CN=example.test, O=Dev Tool',
      notAfter: new Date('2030-01-01T00:00:00.000Z'),
      notBefore: new Date('2026-01-01T00:00:00.000Z'),
      serialNumber: '1234',
      signingAlgorithm: RSA_ALGORITHM,
    },
    globalThis.crypto,
  )
  const privateKey = await globalThis.crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  return {
    certificatePem: certificate.toString('pem'),
    privateKeyPem: toPem(privateKey, 'PRIVATE KEY'),
  }
}

describe('certificate parsing and key verification', () => {
  let matchingMaterial: RsaCertificateMaterial
  let otherMaterial: RsaCertificateMaterial

  // Shared generated certificates keep the cryptographic tests focused and reasonably fast.
  beforeAll(async () => {
    cryptoProvider.set(globalThis.crypto)
    const materials = await Promise.all([
      createRsaCertificateMaterial(),
      createRsaCertificateMaterial(),
    ])
    matchingMaterial = materials[0]
    otherMaterial = materials[1]
  })

  // Parsed output should expose stable JSON data for every requested certificate field.
  it('parses certificate identity, algorithms, validity, extensions, and fingerprint', async () => {
    const details = await parseCertificate(
      matchingMaterial.certificatePem,
      new Date('2027-01-01T00:00:00.000Z'),
    )

    expect(details).toMatchObject({
      extendedKeyUsages: ['serverAuth', 'clientAuth'],
      isCertificateAuthority: true,
      issuer: 'CN=example.test, O=Dev Tool',
      keyUsages: ['digitalSignature', 'keyCertSign'],
      pathLength: 1,
      publicKeyAlgorithm: {
        modulusLength: 2048,
        name: 'RSASSA-PKCS1-v1_5',
        namedCurve: null,
      },
      serialNumber: '1234',
      signatureAlgorithm: {
        hash: 'SHA-256',
        name: 'RSASSA-PKCS1-v1_5',
      },
      status: 'valid',
      subject: 'CN=example.test, O=Dev Tool',
      subjectAlternativeNames: [
        { type: 'dns', value: 'example.test' },
        { type: 'ip', value: '127.0.0.1' },
      ],
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2030-01-01T00:00:00.000Z',
    })
    expect(details.sha256Fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(() => JSON.stringify(details)).not.toThrow()
  })

  // A signature made by the certificate's own private key must verify successfully.
  it('accepts a matching PKCS#8 private key', async () => {
    await expect(
      verifyCertificateKeyPair(
        matchingMaterial.certificatePem,
        matchingMaterial.privateKeyPem,
      ),
    ).resolves.toBe(true)
  })

  // A different RSA private key can import successfully but must fail public-key verification.
  it('rejects a non-matching private key', async () => {
    await expect(
      verifyCertificateKeyPair(matchingMaterial.certificatePem, otherMaterial.privateKeyPem),
    ).resolves.toBe(false)
  })

  // Legacy PKCS#1 labels need a concrete conversion message before WebCrypto import is attempted.
  it('rejects unsupported private-key PEM labels with a specific message', async () => {
    const legacyLabel = matchingMaterial.privateKeyPem
      .replace('BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY')
      .replace('END PRIVATE KEY', 'END RSA PRIVATE KEY')

    await expect(
      verifyCertificateKeyPair(matchingMaterial.certificatePem, legacyLabel),
    ).rejects.toThrow('PKCS#1 RSA PRIVATE KEY is not supported')
  })
})

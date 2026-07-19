import 'reflect-metadata'

import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  PemConverter,
  SubjectAlternativeNameExtension,
  X509Certificate,
  cryptoProvider,
} from '@peculiar/x509'

export type CertificateStatus = 'expired' | 'not-yet-valid' | 'valid'

export interface CertificateAlgorithmDetails {
  hash: string | null
  name: string
}

export interface CertificatePublicKeyDetails {
  modulusLength: number | null
  name: string
  namedCurve: string | null
}

export interface CertificateSubjectAlternativeName {
  type: string
  value: string
}

export interface CertificateDetails {
  extendedKeyUsages: string[]
  isCertificateAuthority: boolean
  issuer: string
  keyUsages: string[]
  pathLength: number | null
  publicKeyAlgorithm: CertificatePublicKeyDetails
  serialNumber: string
  sha256Fingerprint: string
  signatureAlgorithm: CertificateAlgorithmDetails
  status: CertificateStatus
  subject: string
  subjectAlternativeNames: CertificateSubjectAlternativeName[]
  validFrom: string
  validTo: string
}

interface AlgorithmWithDetails extends Algorithm {
  hash?: AlgorithmIdentifier
  modulusLength?: number
  namedCurve?: string
}

interface KeyPairVerificationAlgorithms {
  keyImportAlgorithm: Algorithm | EcKeyImportParams | RsaHashedImportParams
  signatureAlgorithm: AlgorithmIdentifier
}

const KEY_USAGE_LABELS: ReadonlyArray<readonly [KeyUsageFlags, string]> = [
  [KeyUsageFlags.digitalSignature, 'digitalSignature'],
  [KeyUsageFlags.nonRepudiation, 'nonRepudiation'],
  [KeyUsageFlags.keyEncipherment, 'keyEncipherment'],
  [KeyUsageFlags.dataEncipherment, 'dataEncipherment'],
  [KeyUsageFlags.keyAgreement, 'keyAgreement'],
  [KeyUsageFlags.keyCertSign, 'keyCertSign'],
  [KeyUsageFlags.cRLSign, 'cRLSign'],
  [KeyUsageFlags.encipherOnly, 'encipherOnly'],
  [KeyUsageFlags.decipherOnly, 'decipherOnly'],
]

const EXTENDED_KEY_USAGE_LABELS: Readonly<Record<string, string>> = {
  [ExtendedKeyUsage.serverAuth]: 'serverAuth',
  [ExtendedKeyUsage.clientAuth]: 'clientAuth',
  [ExtendedKeyUsage.codeSigning]: 'codeSigning',
  [ExtendedKeyUsage.emailProtection]: 'emailProtection',
  [ExtendedKeyUsage.timeStamping]: 'timeStamping',
  [ExtendedKeyUsage.ocspSigning]: 'ocspSigning',
}

const ECDSA_HASHES: Readonly<Record<string, string>> = {
  'P-256': 'SHA-256',
  'P-384': 'SHA-384',
  'P-521': 'SHA-512',
}

/** Returns WebCrypto and registers the same provider for all x509 operations. */
function getWebCrypto(): Crypto {
  const currentCrypto = globalThis.crypto

  // Certificate hashing and key verification require the standard SubtleCrypto implementation.
  if (!currentCrypto?.subtle) {
    throw new Error('WebCrypto is not available in this environment')
  }

  cryptoProvider.set(currentCrypto)
  return currentCrypto
}

/** Converts any thrown JavaScript value into a readable error message. */
function errorMessage(error: unknown): string {
  // Native Error messages retain the useful parser or WebCrypto failure reason.
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/** Reads exactly one PEM block and rejects a missing or ambiguous document. */
function decodeSinglePemBlock(
  pem: string,
  inputName: string,
): { rawData: ArrayBuffer; type: string } {
  let blocks: ReturnType<typeof PemConverter.decodeWithHeaders>

  try {
    blocks = PemConverter.decodeWithHeaders(pem)
  } catch (error) {
    throw new Error(`${inputName} is not valid PEM: ${errorMessage(error)}`)
  }

  // No decoded block means the envelope, Base64 payload, or closing label is malformed.
  if (blocks.length === 0) {
    throw new Error(`${inputName} is not a valid PEM document`)
  }

  // Multiple blocks are rejected so callers never verify an unintended first item from a bundle.
  if (blocks.length !== 1) {
    throw new Error(`${inputName} must contain exactly one PEM block`)
  }

  return blocks[0]
}

/** Parses one CERTIFICATE PEM block and wraps ASN.1 failures with input context. */
function createCertificate(pem: string): X509Certificate {
  const block = decodeSinglePemBlock(pem, 'Certificate input')

  // A certificate parser must not silently reinterpret another PEM object as a certificate.
  if (block.type !== 'CERTIFICATE') {
    throw new Error(`Certificate input must use a CERTIFICATE PEM block, received ${block.type}`)
  }

  try {
    return new X509Certificate(block.rawData)
  } catch (error) {
    throw new Error(`Unable to parse certificate: ${errorMessage(error)}`)
  }
}

/** Returns a specific remediation message for a non-PKCS#8 private-key envelope. */
function unsupportedPrivateKeyLabel(type: string): string {
  // PKCS#1 RSA keys need conversion before the WebCrypto PKCS#8 import path can use them.
  if (type === 'RSA PRIVATE KEY') {
    return 'PKCS#1 RSA PRIVATE KEY is not supported; use an unencrypted PKCS#8 PRIVATE KEY'
  }

  // SEC1 EC keys omit the PKCS#8 algorithm wrapper required by WebCrypto.
  if (type === 'EC PRIVATE KEY') {
    return 'SEC1 EC PRIVATE KEY is not supported; use an unencrypted PKCS#8 PRIVATE KEY'
  }

  // EncryptedPrivateKeyInfo requires password-based decryption that this local verifier does not perform.
  if (type === 'ENCRYPTED PRIVATE KEY') {
    return 'Encrypted private keys are not supported; use an unencrypted PKCS#8 PRIVATE KEY'
  }

  // OpenSSH key containers are not a WebCrypto key import format.
  if (type === 'OPENSSH PRIVATE KEY') {
    return 'OpenSSH private keys are not supported; use an unencrypted PKCS#8 PRIVATE KEY'
  }

  return `Private key input must use a PRIVATE KEY PEM block, received ${type}`
}

/** Reads exactly one unencrypted PKCS#8 PRIVATE KEY PEM block. */
function decodePrivateKey(pem: string): ArrayBuffer {
  const block = decodeSinglePemBlock(pem, 'Private key input')

  // Only this label represents the unencrypted PKCS#8 structure accepted by the verifier.
  if (block.type !== 'PRIVATE KEY') {
    throw new Error(unsupportedPrivateKeyLabel(block.type))
  }

  return block.rawData
}

/** Converts a WebCrypto algorithm identifier into its serializable name. */
function algorithmIdentifierName(identifier: AlgorithmIdentifier | undefined): string | null {
  // Missing hashes are valid for algorithms such as Ed25519 that define hashing internally.
  if (identifier === undefined) {
    return null
  }

  // String identifiers already contain the complete algorithm name.
  if (typeof identifier === 'string') {
    return identifier
  }

  return identifier.name
}

/** Normalizes a certificate signature algorithm into JSON-safe fields. */
function normalizeSignatureAlgorithm(algorithm: AlgorithmWithDetails): CertificateAlgorithmDetails {
  return {
    hash: algorithmIdentifierName(algorithm.hash),
    name: algorithm.name,
  }
}

/** Normalizes certificate public-key metadata without retaining library objects. */
function normalizePublicKeyAlgorithm(algorithm: AlgorithmWithDetails): CertificatePublicKeyDetails {
  // Only RSA algorithms expose a modulus length, so other key types use an explicit null.
  const modulusLength = algorithm.modulusLength ?? null
  // Only EC algorithms expose a named curve, so other key types use an explicit null.
  const namedCurve = algorithm.namedCurve ?? null

  return {
    modulusLength,
    name: algorithm.name,
    namedCurve,
  }
}

/** Classifies certificate validity at the supplied point in time. */
function certificateStatus(certificate: X509Certificate, now: Date): CertificateStatus {
  const timestamp = now.getTime()

  // An invalid comparison date would otherwise make every certificate appear valid.
  if (Number.isNaN(timestamp)) {
    throw new TypeError('Certificate comparison date must be valid')
  }

  // Dates before notBefore mean the certificate has not entered its validity period.
  if (timestamp < certificate.notBefore.getTime()) {
    return 'not-yet-valid'
  }

  // Dates after notAfter mean the certificate validity period has ended.
  if (timestamp > certificate.notAfter.getTime()) {
    return 'expired'
  }

  return 'valid'
}

/** Formats a digest as the conventional uppercase, colon-separated fingerprint. */
function formatFingerprint(buffer: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(buffer),
    (byte) => byte.toString(16).padStart(2, '0').toUpperCase(),
  ).join(':')
}

/** Expands the Key Usage extension bit field into stable display labels. */
function readKeyUsages(certificate: X509Certificate): string[] {
  const extension = certificate.getExtension(KeyUsagesExtension)
  const labels: string[] = []

  // Certificates may omit Key Usage when their public key is not restricted by this extension.
  if (!extension) {
    return labels
  }

  for (const [flag, label] of KEY_USAGE_LABELS) {
    // Only flags explicitly present in the bit field belong in the parsed result.
    if ((extension.usages & flag) === flag) {
      labels.push(label)
    }
  }

  return labels
}

/** Maps known Extended Key Usage OIDs to names and preserves unknown OIDs. */
function readExtendedKeyUsages(certificate: X509Certificate): string[] {
  const extension = certificate.getExtension(ExtendedKeyUsageExtension)
  const labels: string[] = []

  // Certificates without EKU do not declare a finite list of extended purposes.
  if (!extension) {
    return labels
  }

  for (const usage of extension.usages) {
    const label = EXTENDED_KEY_USAGE_LABELS[usage]

    // Known standard purposes are easier to scan by name than by OID.
    if (label) {
      labels.push(label)
    } else {
      // Unknown or private purposes stay lossless by retaining their original OID.
      labels.push(usage)
    }
  }

  return labels
}

/** Extracts Subject Alternative Names as plain JSON values. */
function readSubjectAlternativeNames(
  certificate: X509Certificate,
): CertificateSubjectAlternativeName[] {
  const extension = certificate.getExtension(SubjectAlternativeNameExtension)

  // SAN is optional, so a missing extension is represented by an empty list.
  if (!extension) {
    return []
  }

  return extension.names.toJSON().map((name) => ({
    type: name.type,
    value: name.value,
  }))
}

/** Chooses compatible import and signing parameters from the certificate subject public key. */
function keyPairVerificationAlgorithms(certificate: X509Certificate): KeyPairVerificationAlgorithms {
  const publicKeyAlgorithm = certificate.publicKey.algorithm as AlgorithmWithDetails
  const normalizedName = publicKeyAlgorithm.name.toUpperCase()

  // Generic RSA and constrained RSA-PSS public keys can both prove possession with RSA-PSS.
  if (normalizedName === 'RSASSA-PKCS1-V1_5' || normalizedName === 'RSA-PSS') {
    return {
      keyImportAlgorithm: { name: 'RSA-PSS', hash: 'SHA-256' },
      signatureAlgorithm: { name: 'RSA-PSS', saltLength: 32 } as RsaPssParams,
    }
  }

  // ECDSA import must use the exact named curve encoded in the certificate SPKI.
  if (normalizedName === 'ECDSA') {
    const namedCurve = publicKeyAlgorithm.namedCurve

    // Missing curve parameters make an EC public key unusable in WebCrypto.
    if (!namedCurve) {
      throw new Error('Unsupported ECDSA certificate public key: missing named curve')
    }

    const hash = ECDSA_HASHES[namedCurve]

    // Browser WebCrypto only guarantees the three NIST curves supported by this verifier.
    if (!hash) {
      throw new Error(`Unsupported ECDSA certificate curve: ${namedCurve}`)
    }

    return {
      keyImportAlgorithm: { name: 'ECDSA', namedCurve },
      signatureAlgorithm: { name: 'ECDSA', hash } as EcdsaParams,
    }
  }

  // Modern WebCrypto exposes Ed25519 directly without separate hash parameters.
  if (normalizedName === 'ED25519') {
    return {
      keyImportAlgorithm: { name: 'Ed25519' },
      signatureAlgorithm: { name: 'Ed25519' },
    }
  }

  throw new Error(`Unsupported certificate public key algorithm: ${publicKeyAlgorithm.name}`)
}

/** Parses one PEM X.509 certificate into serializable display details. */
export async function parseCertificate(pem: string, now = new Date()): Promise<CertificateDetails> {
  const currentCrypto = getWebCrypto()
  const certificate = createCertificate(pem)

  try {
    const thumbprint = await certificate.getThumbprint('SHA-256', currentCrypto)
    const subjectAlternativeNames = readSubjectAlternativeNames(certificate)
    const keyUsages = readKeyUsages(certificate)
    const extendedKeyUsages = readExtendedKeyUsages(certificate)
    const basicConstraints = certificate.getExtension(BasicConstraintsExtension)
    let isCertificateAuthority = false
    let pathLength: number | null = null

    // Basic Constraints is the authoritative source for CA and path-length metadata.
    if (basicConstraints) {
      isCertificateAuthority = basicConstraints.ca

      // An omitted path length means the extension does not impose a numeric maximum.
      if (basicConstraints.pathLength !== undefined) {
        pathLength = basicConstraints.pathLength
      }
    }

    return {
      extendedKeyUsages,
      isCertificateAuthority,
      issuer: certificate.issuer,
      keyUsages,
      pathLength,
      publicKeyAlgorithm: normalizePublicKeyAlgorithm(
        certificate.publicKey.algorithm as AlgorithmWithDetails,
      ),
      serialNumber: certificate.serialNumber,
      sha256Fingerprint: formatFingerprint(thumbprint),
      signatureAlgorithm: normalizeSignatureAlgorithm(
        certificate.signatureAlgorithm as AlgorithmWithDetails,
      ),
      status: certificateStatus(certificate, now),
      subject: certificate.subject,
      subjectAlternativeNames,
      validFrom: certificate.notBefore.toISOString(),
      validTo: certificate.notAfter.toISOString(),
    }
  } catch (error) {
    throw new Error(`Unable to parse certificate details: ${errorMessage(error)}`)
  }
}

/** Verifies that one unencrypted PKCS#8 private key matches a certificate public key. */
export async function verifyCertificateKeyPair(
  certificatePem: string,
  privateKeyPem: string,
): Promise<boolean> {
  const currentCrypto = getWebCrypto()
  const certificate = createCertificate(certificatePem)
  const privateKeyData = decodePrivateKey(privateKeyPem)
  const algorithms = keyPairVerificationAlgorithms(certificate)
  let privateKey: CryptoKey

  try {
    privateKey = await currentCrypto.subtle.importKey(
      'pkcs8',
      privateKeyData,
      algorithms.keyImportAlgorithm,
      false,
      ['sign'],
    )
  } catch (error) {
    throw new Error(`Unable to import PKCS#8 private key: ${errorMessage(error)}`)
  }

  try {
    const publicKey = await certificate.publicKey.export(
      algorithms.keyImportAlgorithm,
      ['verify'],
      currentCrypto,
    )
    const challenge = currentCrypto.getRandomValues(new Uint8Array(32))
    const signature = await currentCrypto.subtle.sign(
      algorithms.signatureAlgorithm,
      privateKey,
      challenge,
    )

    return currentCrypto.subtle.verify(
      algorithms.signatureAlgorithm,
      publicKey,
      signature,
      challenge,
    )
  } catch (error) {
    throw new Error(`Unable to verify certificate key pair: ${errorMessage(error)}`)
  }
}

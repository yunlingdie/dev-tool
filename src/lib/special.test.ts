import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
  arrayBufferToBase64,
  arrayBufferToDataUrl,
  base64ToArrayBuffer,
  composeToDockerRuns,
  createBase64Download,
  dataUrlToArrayBuffer,
  dockerRunToCompose,
  fileToBase64Data,
  generateRsaKeyPair,
} from './special'

describe('RSA helpers', () => {
  // The generated material should use interoperable public and private PEM envelopes.
  it('generates an RSA key pair as PEM', async () => {
    const result = await generateRsaKeyPair(2048)

    expect(result.publicKeyPem).toMatch(
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----$/,
    )
    expect(result.privateKeyPem).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PRIVATE KEY-----$/,
    )
  })
})

describe('Base64 file helpers', () => {
  // Binary conversion must preserve UTF-8 bytes rather than JavaScript code units.
  it('round trips an ArrayBuffer through Base64', () => {
    const source = new TextEncoder().encode('Dev Tool / 中文')
    const encoded = arrayBufferToBase64(source.buffer)
    const decoded = base64ToArrayBuffer(encoded)

    expect(new TextDecoder().decode(decoded)).toBe('Dev Tool / 中文')
  })

  // Data URLs and download metadata should retain MIME type, payload, and byte size.
  it('builds data URL and download values', () => {
    const source = new TextEncoder().encode('hello')
    const dataUrl = arrayBufferToDataUrl(source.buffer, 'text/plain')
    const parsed = dataUrlToArrayBuffer(dataUrl)
    const download = createBase64Download(dataUrl, 'hello.txt')

    expect(parsed.mimeType).toBe('text/plain')
    expect(new TextDecoder().decode(parsed.buffer)).toBe('hello')
    expect(download).toEqual({
      href: 'data:text/plain;base64,aGVsbG8=',
      download: 'hello.txt',
      mimeType: 'text/plain',
      size: 5,
    })
  })

  // File conversion should expose both the raw payload and a ready-to-use data URL.
  it('converts a browser File to Base64 data', async () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    await expect(fileToBase64Data(file)).resolves.toEqual({
      fileName: 'hello.txt',
      mimeType: 'text/plain',
      size: 5,
      base64: 'aGVsbG8=',
      dataUrl: 'data:text/plain;base64,aGVsbG8=',
    })
  })
})

describe('Docker converters', () => {
  // Every requested docker run field should have a concrete Compose representation.
  it('converts docker run options and argv to Compose YAML', () => {
    const compose = dockerRunToCompose(
      "docker run -d --name web -p 8080:80 -v './site:/usr/share/nginx/html:ro' -e MODE=production -e EMPTY --restart unless-stopped --network app-net -w /srv --entrypoint /bin/sh nginx:alpine -c 'echo hello'",
    )
    const document = parseYaml(compose)

    expect(document).toEqual({
      services: {
        web: {
          image: 'nginx:alpine',
          container_name: 'web',
          ports: ['8080:80'],
          volumes: ['./site:/usr/share/nginx/html:ro'],
          environment: ['MODE=production', 'EMPTY'],
          'x-docker-run-detach': true,
          restart: 'unless-stopped',
          network_mode: 'app-net',
          working_dir: '/srv',
          entrypoint: ['/bin/sh'],
          command: ['-c', 'echo hello'],
        },
      },
    })
  })

  // Docker's attached short values, equals syntax, and explicit false flag should parse consistently.
  it('supports attached and inline docker option values', () => {
    const compose = dockerRunToCompose(
      'docker run --detach=false --name=api -p8080:80 -vdata:/data -eMODE=dev -w/app example/api:1 start',
    )
    const document = parseYaml(compose)

    expect(document.services.api).toEqual({
      image: 'example/api:1',
      container_name: 'api',
      ports: ['8080:80'],
      volumes: ['data:/data'],
      environment: ['MODE=dev'],
      working_dir: '/app',
      command: ['start'],
    })
  })

  // Multiple services must produce separate paste-ready commands and preserve field ordering.
  it('converts every Compose service to a docker run command', () => {
    const conversions = composeToDockerRuns(`
services:
  web:
    image: nginx:alpine
    container_name: public-web
    ports:
      - "8080:80"
    volumes:
      - ./site:/usr/share/nginx/html:ro
    environment:
      MODE: production
      EMPTY:
    restart: unless-stopped
    network_mode: host
    working_dir: /srv
    entrypoint: ["/bin/sh", "-c"]
    command: ["echo hello"]
    x-docker-run-detach: true
  worker:
    image: example/worker:1
    environment:
      - QUEUE=high priority
    command: ["run", "worker"]
`)

    expect(conversions).toEqual([
      {
        serviceName: 'web',
        command:
          "docker run -d --name public-web -p 8080:80 -v ./site:/usr/share/nginx/html:ro -e MODE=production -e EMPTY --restart unless-stopped --network host --workdir /srv --entrypoint /bin/sh nginx:alpine -c 'echo hello'",
      },
      {
        serviceName: 'worker',
        command: "docker run -e 'QUEUE=high priority' example/worker:1 run worker",
      },
    ])
  })

  // Invalid shell quoting should be reported instead of producing subtly changed argv.
  it('rejects an unfinished docker command', () => {
    expect(() => dockerRunToCompose("docker run alpine 'echo")).toThrow(
      'unclosed quote',
    )
  })
})

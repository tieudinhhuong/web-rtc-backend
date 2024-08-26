import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import { createWorker } from 'mediasoup';
import {
  AppData,
  Router,
  WebRtcTransport,
  WorkerSettings,
  Worker,
  RtpCodecCapability,
  Producer,
  Consumer,
} from 'mediasoup/node/lib/types';

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins
    methods: ['GET', 'POST'], // Allow specific methods
    allowedHeaders: ['my-custom-header'], // Allow specific headers
    credentials: true, // Allow credentials
  },
});

const workerOptions: WorkerSettings<AppData> = {
  rtcMinPort: 10000,
  rtcMaxPort: 10100,
  logLevel: 'warn',
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
};

const mediaCodecOptions: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

let worker: Worker;
let router: Router;
let producerTransport: WebRtcTransport;
let consumerTransport: WebRtcTransport;

(async () => {
  worker = await createWorker(workerOptions);
  router = await worker.createRouter({
    mediaCodecs: mediaCodecOptions,
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('createProducerTransport', async (callback) => {
      producerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0' }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      callback({
        id: producerTransport.id,
        iceParameters: producerTransport.iceParameters,
        iceCandidates: producerTransport.iceCandidates,
        dtlsParameters: producerTransport.dtlsParameters,
      });
    });

    socket.on('createConsumerTransport', async (callback) => {
      consumerTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0' }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      callback({
        id: consumerTransport.id,
        iceParameters: consumerTransport.iceParameters,
        iceCandidates: consumerTransport.iceCandidates,
        dtlsParameters: consumerTransport.dtlsParameters,
      });
    });

    socket.on(
      'connectProducerTransport',
      async ({ dtlsParameters }, callback) => {
        await producerTransport.connect({ dtlsParameters });
        callback();
      },
    );

    socket.on(
      'connectConsumerTransport',
      async ({ dtlsParameters }, callback) => {
        await consumerTransport.connect({ dtlsParameters });
        callback();
      },
    );

    socket.on('produce', async ({ kind, rtpParameters }, callback) => {
      const producer: Producer = await producerTransport.produce({
        kind,
        rtpParameters,
      });
      callback({ id: producer.id });
    });

    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        return callback({ error: 'Cannot consume' });
      }

      const consumer: Consumer = await consumerTransport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      callback({
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    });

    socket.on('getRouterRtpCapabilities', (callback) => {
      callback(router.rtpCapabilities);
    });
  });

  server.listen(3000, () => {
    console.log('Server is running on port 3000');
  });
})();

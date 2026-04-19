const WebSocket = require('ws');
const http = require('http');

console.log("Connecting to local WSS server...");
const ws = new WebSocket('ws://localhost:3001/twilio-media/6513da73-0adb-441d-b74a-6086bed43b5c');

ws.on('open', () => {
    console.log("Connected to WS. Sending start event...");
    ws.send(JSON.stringify({
        event: "start",
        sequenceNumber: "1",
        start: {
            streamSid: "MZ_dummy_stream_sid",
            callSid: "CA_dummy_call_sid",
            tracks: ["inbound", "outbound"],
            mediaFormat: {
                encoding: "audio/x-mulaw",
                sampleRate: 8000,
                channels: 1
            }
        },
        streamSid: "MZ_dummy_stream_sid"
    }));
});

let mediaPacketsReceived = 0;

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data.toString());
        if (msg.event === "media") {
            mediaPacketsReceived++;
            if (mediaPacketsReceived === 1) {
                console.log("RECEIVED FIRST MEDIA PACKET! Payload length:", msg.media.payload.length);
            }
        } else {
            console.log("Received non-media event:", msg.event);
        }
    } catch(e) {
        console.log("Received raw data:", data.toString().slice(0, 100));
    }
});

setTimeout(() => {
    console.log(`Total media packets received in 5s: ${mediaPacketsReceived}`);
    process.exit(0);
}, 5000);

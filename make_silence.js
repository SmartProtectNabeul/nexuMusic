const fs = require('fs');
const sr = 44100, len = sr * 2; // 2 seconds
const buf = Buffer.alloc(44 + len * 2);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + len * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(len * 2, 40);
fs.writeFileSync('silence.wav', buf);
console.log('silence.wav created successfully!');

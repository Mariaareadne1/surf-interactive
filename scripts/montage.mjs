// node scripts/montage.mjs out.png "x,y,w,h" cols in1.png in2.png ...  — crop each input and tile them.
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const [out, crop, cols, ...inputs] = process.argv.slice(2);
const [x, y, w, h] = crop.split(',').map(Number);
const n = inputs.length;
const c = Number(cols);
const filters = inputs.map((_, i) => `[${i}]crop=${w}:${h}:${x}:${y}[v${i}]`);
const layout = inputs.map((_, i) => `${(i % c) * w}_${Math.floor(i / c) * h}`).join('|');
const graph = n === 1 ? `${filters[0]}` : `${filters.join(';')};${inputs.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=white`;
execFileSync(ffmpeg, ['-v', 'error', '-y', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', graph, ...(n === 1 ? ['-map', '[v0]'] : []), out]);
console.log(out);

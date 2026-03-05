const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const SYMBOLS = {
    '.': { duration: 1 / 8, type: 'note' },
    ':': { duration: 1 / 4, type: 'note' },
    '|': { duration: 1 / 2, type: 'note' },
    '-': { duration: 1.0, type: 'note' },
    '=': { duration: 2.0, type: 'note' },
    '*': { duration: 4.0, type: 'note' },
    '!': { duration: 1 / 8, type: 'rest' },
    '"': { duration: 1 / 4, type: 'rest' },
    '#': { duration: 1 / 2, type: 'rest' },
    '@': { duration: 1.0, type: 'rest' },
    ' ': { duration: 1 / 8, type: 'rest' },  // Keep space for flexibility
    '　': { duration: 1 / 4, type: 'rest' }  // Keep full-width space for flexibility
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_ALIASES = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
    'midC': 'C4'
};

function noteToFreq(noteStr) {
    if (NOTE_ALIASES[noteStr]) noteStr = NOTE_ALIASES[noteStr];

    const match = noteStr.match(/^([A-G][#b]?)(\d)$/i);
    if (!match) return null;

    let name = match[1].toUpperCase();
    if (name.length > 1 && name[1] === 'b') {
        const idx = NOTE_NAMES.indexOf(name[0]);
        name = NOTE_NAMES[(idx + 11) % 12];
    }

    const octave = parseInt(match[2]);
    const semitones = NOTE_NAMES.indexOf(name);
    const n = (octave - 4) * 12 + semitones - 9;
    return 440 * Math.pow(2, n / 12);
}

const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const bpmInput = document.getElementById('bpm');
const bpmRange = document.getElementById('bpm-range');
const rhythmInput = document.getElementById('rhythm-input');
const visualizer = document.getElementById('visualizer');

let isPlaying = false;
let tracksData = [];
let trackStates = [];
let timerID;

// Create visualizer bars
for (let i = 0; i < 32; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = '10%';
    visualizer.appendChild(bar);
}
const bars = document.querySelectorAll('.bar');

bpmInput.addEventListener('input', (e) => {
    bpmRange.value = e.target.value;
});

bpmRange.addEventListener('input', (e) => {
    bpmInput.value = e.target.value;
});

function playSound(time, frequency) {
    const now = time;
    const duration = 2.0;

    const masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);

    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.4, now + 0.005);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // Harmonics for piano-like timbre
    const harmonics = [
        { ratio: 1, gain: 0.5 },
        { ratio: 2, gain: 0.2 },
        { ratio: 3, gain: 0.1 },
        { ratio: 4, gain: 0.05 }
    ];

    harmonics.forEach(h => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency * h.ratio, now);
        osc.detune.setValueAtTime(Math.random() * 2, now);

        g.gain.setValueAtTime(h.gain, now);

        osc.connect(g);
        g.connect(masterGain);

        osc.start(now);
        osc.stop(now + duration);
    });

    // Visual feedback
    const barIndex = Math.floor(Math.random() * bars.length);
    setTimeout(() => {
        bars[barIndex].classList.add('active');
        bars[barIndex].style.height = '100%';
        setTimeout(() => {
            bars[barIndex].classList.remove('active');
            bars[barIndex].style.height = '10%';
        }, 100);
    }, (time - audioCtx.currentTime) * 1000);
}

function parseInput(inputText) {
    const lines = inputText.split('\n');
    const tracks = [];

    lines.forEach(line => {
        if (!line.trim()) return;

        let loopDuration = null;
        const cleanLine = line.replace(/\[(\d+(?:\.\d+)?)\]/, (m, g1) => {
            loopDuration = parseFloat(g1);
            return '';
        });

        const events = [];
        let stateFreq = 180;
        let i = 0;
        while (i < cleanLine.length) {
            const char = cleanLine[i];
            if (char === '(') {
                let end = cleanLine.indexOf(')', i);
                if (end !== -1) {
                    const tag = cleanLine.substring(i + 1, end);
                    const freqMatch = tag.match(/^(\d+)Hz$/i);
                    if (freqMatch) stateFreq = parseFloat(freqMatch[1]);
                    else {
                        const freq = noteToFreq(tag);
                        if (freq) stateFreq = freq;
                    }
                    i = end + 1;
                    continue;
                }
            }
            if (char === '/') {
                if (events.length > 0) events[events.length - 1].duration *= 1.5;
            } else if (SYMBOLS[char]) {
                events.push({ ...SYMBOLS[char], frequency: stateFreq });
            }
            i++;
        }

        if (events.length > 0) {
            const totalEventsDuration = events.reduce((sum, e) => sum + e.duration, 0);
            tracks.push({
                events,
                loopDuration: loopDuration || totalEventsDuration
            });
        }
    });
    return tracks;
}

function scheduler() {
    const bpm = parseFloat(bpmInput.value);
    const secondsPerBeat = 60.0 / bpm;
    const scheduleAheadTime = 0.1;

    let allTracksFinished = true;

    tracksData.forEach((track, idx) => {
        const state = trackStates[idx];
        if (state.finished) return;

        allTracksFinished = false;

        while (state.nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
            const event = track.events[state.eventIndex];

            if (event.type === 'note') {
                playSound(state.nextNoteTime, event.frequency);
            }

            state.nextNoteTime += event.duration * secondsPerBeat;
            state.eventIndex++;

            if (state.eventIndex >= track.events.length) {
                state.finished = true;
                break;
            }
        }
    });

    if (allTracksFinished) {
        stopPlayback();
    } else if (isPlaying) {
        timerID = setTimeout(scheduler, 25);
    }
}

function startPlayback() {
    if (isPlaying) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    tracksData = parseInput(rhythmInput.value);
    if (tracksData.length === 0) return;

    isPlaying = true;
    const startTime = audioCtx.currentTime + 0.05;
    trackStates = tracksData.map(() => ({
        eventIndex: 0,
        nextNoteTime: startTime,
        finished: false
    }));

    scheduler();
    playBtn.textContent = '続行中...';
    playBtn.disabled = true;
}

function stopPlayback() {
    isPlaying = false;
    clearTimeout(timerID);
    playBtn.textContent = '再生';
    playBtn.disabled = false;
}

playBtn.addEventListener('click', startPlayback);
stopBtn.addEventListener('click', stopPlayback);

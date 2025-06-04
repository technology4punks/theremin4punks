// Elementi DOM
const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('start-button');
const frequencyValue = document.getElementById('frequency-value');
const noteValue = document.getElementById('note-value');
const volumeValue = document.getElementById('volume-value');
const reverbValue = document.getElementById('reverb-value');
const scaleSelect = document.getElementById('scale-select');
const rootNoteSelect = document.getElementById('root-note');
const handStateValue = document.getElementById('hand-state');
const lastDrumValue = document.getElementById('last-drum');
const drumVolumeSlider = document.getElementById('drum-volume');
const drumVolumeValue = document.getElementById('drum-volume-value');
const leftHandModeSelect = document.getElementById('left-hand-mode');

// Accedi alle classi MediaPipe dal namespace globale
const Hands = window.Hands;
const Camera = window.Camera;
const { HAND_CONNECTIONS } = window;
const { drawConnectors, drawLandmarks } = window;

// Inizializza l'oggetto hands di MediaPipe
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,  // Ridotto a 1 per migliorare la stabilità
    minDetectionConfidence: 0.5,  // Ridotto per evitare errori di rilevamento
    minTrackingConfidence: 0.5
});

// Configurazione della camera
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await hands.send({ image: videoElement });
    },
    width: 640,
    height: 480
});

// Variabili per il theremin
let isPlaying = false;
let synth = null;
let reverb = null;

// Nuove variabili per le percussioni
let snarePlayer = null;
let kickPlayer = null;
let lastHandState = null;
let drumVolume = -5;

// Variabili per la modalità mano sinistra
let leftHandMode = 'drums';
let organSynth = null;
let lastLeftHandY = 0;

// Parametri del theremin
const MIN_FREQ = 100;
const MAX_FREQ = 1000;
const MIN_VOL = -40;
const MAX_VOL = 0;

// Definizione delle scale musicali
const SCALES = {
    'cromatica': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'maggiore': [0, 2, 4, 5, 7, 9, 11],
    'minore': [0, 2, 3, 5, 7, 8, 10],
    'pentatonica': [0, 2, 4, 7, 9],
    'blues': [0, 3, 5, 6, 7, 10]
};

// Scala corrente (default: cromatica)
let currentScale = 'cromatica';
let rootNote = 0; // Do (C) come nota base di default

// Nomi delle note
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_IT = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

// Funzione per convertire la frequenza alla nota più vicina nella scala selezionata
function snapToScale(frequency) {
    // Se è selezionata la scala cromatica, restituisci la frequenza esatta senza modifiche
    if (currentScale === 'cromatica') {
        return frequency;
    }
    
    // La nota di riferimento è A4 (La4) a 440 Hz
    const A4 = 440.0;
    
    // Calcola il numero di semitoni rispetto a A4
    const semitoneFromA4 = Math.round(12 * Math.log2(frequency / A4));
    
    // Calcola l'ottava e la nota all'interno dell'ottava
    const octave = 4 + Math.floor((semitoneFromA4 + 9) / 12);
    let noteIndex = (semitoneFromA4 + 9) % 12;
    if (noteIndex < 0) {
        noteIndex += 12;
    }
    
    // Trova la nota più vicina nella scala corrente
    const scale = SCALES[currentScale];
    // Aggiungi la nota base alla scala
    const transposedScale = scale.map(n => (n + rootNote) % 12);
    
    // Trova la nota più vicina nella scala
    let minDistance = 12;
    let closestNote = noteIndex;
    
    for (const scaleNote of transposedScale) {
        const distance = Math.min(
            Math.abs(scaleNote - noteIndex),
            Math.abs(scaleNote + 12 - noteIndex),
            Math.abs(scaleNote - 12 - noteIndex)
        );
        
        if (distance < minDistance) {
            minDistance = distance;
            closestNote = scaleNote;
        }
    }
    
    noteIndex = closestNote;
    
    // Calcola il numero di semitoni rispetto a A4 per la nota corretta
    const adjustedSemitoneFromA4 = (noteIndex - 9) + (octave - 4) * 12;
    
    // Converti di nuovo in frequenza
    return A4 * Math.pow(2, adjustedSemitoneFromA4 / 12);
}

// Funzione per convertire la frequenza in nome della nota
function getNoteName(frequency) {
    // Se è selezionata la scala cromatica, mostra la nota più vicina ma non modificare la frequenza
    const A4 = 440.0;
    
    // Calcola il numero di semitoni rispetto a A4
    const semitoneFromA4 = Math.round(12 * Math.log2(frequency / A4));
    
    // A4 è la nota 9 (La) nell'ottava 4
    // Calcola l'ottava
    const octave = 4 + Math.floor((semitoneFromA4 + 9) / 12);
    
    // Calcola l'indice della nota (0-11, dove 0 è Do, 9 è La)
    let noteIndex = (semitoneFromA4 + 9) % 12;
    if (noteIndex < 0) {
        noteIndex += 12;
    }
    
    // Restituisci il nome della nota con l'ottava
    return `${NOTE_NAMES_IT[noteIndex]}${octave}`;
}

// Inizializzazione di Tone.js
function initToneJS() {
    // Crea un sintetizzatore
    synth = new Tone.Synth({
        oscillator: {
            type: 'sine'
        },
        envelope: {
            attack: 0.1,
            decay: 0.2,
            sustain: 1.0,
            release: 0.8
        }
    });
    
    // Crea un effetto di riverbero
    reverb = new Tone.Reverb({
        decay: 1.5,
        wet: 0
    }).toDestination();
    
    // Collega il sintetizzatore al riverbero
    synth.connect(reverb);
    
    // Crea i player per le percussioni
    // Rullante (rumore bianco con filtro passa-alto)
    const snareNoise = new Tone.Noise("white").start();
    const snareFilter = new Tone.Filter({
        frequency: 1000,
        type: "highpass"
    });
    const snareEnv = new Tone.AmplitudeEnvelope({
        attack: 0.001,
        decay: 0.2,
        sustain: 0,
        release: 0.2
    });
    const snareGain = new Tone.Gain(0.5); // Controllo volume per rullante
    
    snareNoise.connect(snareFilter);
    snareFilter.connect(snareEnv);
    snareEnv.connect(snareGain);
    snareGain.toDestination();
    
    snarePlayer = {
        start: () => {
            snareEnv.triggerAttackRelease("8n");
        },
        volume: snareGain
    };
    
    // Cassa (oscillatore sinusoidale con inviluppo veloce)
    const kickOsc = new Tone.Oscillator({
        frequency: 60,
        type: "sine"
    });
    const kickEnv = new Tone.AmplitudeEnvelope({
        attack: 0.001,
        decay: 0.3,
        sustain: 0,
        release: 0.3
    });
    const kickFilter = new Tone.Filter({
        frequency: 200,
        type: "lowpass"
    });
    const kickGain = new Tone.Gain(0.5); // Controllo volume per cassa
    
    kickOsc.connect(kickFilter);
    kickFilter.connect(kickEnv);
    kickEnv.connect(kickGain);
    kickGain.toDestination();
    kickOsc.start();
    
    kickPlayer = {
        start: () => {
            kickEnv.triggerAttackRelease("8n");
        },
        volume: kickGain
    };
    
    // Crea il sintetizzatore per l'organo Hammond
    // Oscillatori multipli per simulare le ruote tonali Hammond
    const organOsc1 = new Tone.Oscillator({
        type: 'sine',
        frequency: 440
    });
    const organOsc2 = new Tone.Oscillator({
        type: 'sine',
        frequency: 880 // ottava superiore
    });
    const organOsc3 = new Tone.Oscillator({
        type: 'sine',
        frequency: 1320 // quinta dell'ottava superiore
    });
    
    // Mixer per bilanciare gli oscillatori (inizia silenzioso)
    const organMixer = new Tone.Gain(0);
    const organGain1 = new Tone.Gain(0.8); // Fondamentale
    const organGain2 = new Tone.Gain(0.6); // Ottava
    const organGain3 = new Tone.Gain(0.4); // Quinta
    
    // Filtro passa-basso per ammorbidire il suono
    const organFilter = new Tone.Filter({
        frequency: 2000,
        type: 'lowpass',
        rolloff: -12
    });
    
    // Chorus per l'effetto Hammond caratteristico
    const organChorus = new Tone.Chorus({
        frequency: 1.5,
        delayTime: 3.5,
        depth: 0.7,
        wet: 0.5
    }).start();
    
    // Distorsione leggera per il carattere Hammond
    const organDistortion = new Tone.Distortion({
        distortion: 0.1,
        wet: 0.3
    });
    
    // Connessioni audio
    organOsc1.connect(organGain1);
    organOsc2.connect(organGain2);
    organOsc3.connect(organGain3);
    
    organGain1.connect(organMixer);
    organGain2.connect(organMixer);
    organGain3.connect(organMixer);
    
    organMixer.connect(organFilter);
    organFilter.connect(organChorus);
    organChorus.connect(organDistortion);
    organDistortion.toDestination();
    
    // Avvia gli oscillatori
    organOsc1.start();
    organOsc2.start();
    organOsc3.start();
    
    // Oggetto organSynth per compatibilità
    organSynth = {
        oscillators: [organOsc1, organOsc2, organOsc3],
        mixer: organMixer,
        filter: organFilter,
        chorus: organChorus,
        distortion: organDistortion,
        triggerAttack: (frequency) => {
            organOsc1.frequency.value = frequency;
            organOsc2.frequency.value = frequency * 2; // ottava
            organOsc3.frequency.value = frequency * 3; // quinta dell'ottava
            organMixer.gain.rampTo(0.3, 0.1);
        },
        triggerRelease: () => {
            organMixer.gain.rampTo(0, 0.2);
        },
        dispose: () => {
            organOsc1.dispose();
            organOsc2.dispose();
            organOsc3.dispose();
            organMixer.dispose();
            organFilter.dispose();
            organChorus.dispose();
            organDistortion.dispose();
        }
    };
    
    // Avvia il sintetizzatore
    synth.triggerAttack(MIN_FREQ);
    
    // Imposta il volume iniziale
    synth.volume.value = MIN_VOL;
    
    // Imposta il volume delle percussioni
    updateDrumVolume();
}

// Funzione per aggiornare il volume delle percussioni
function updateDrumVolume() {
    if (snarePlayer && kickPlayer) {
        // Converti da dB a gain lineare
        const gainValue = Tone.dbToGain(drumVolume);
        snarePlayer.volume.gain.value = gainValue;
        kickPlayer.volume.gain.value = gainValue;
    }
}

// Funzione per mappare un valore da un intervallo a un altro
function mapRange(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

// Calcola la distanza tra due punti
function calculateDistance(point1, point2) {
    return Math.sqrt(
        Math.pow(point1.x - point2.x, 2) + 
        Math.pow(point1.y - point2.y, 2)
    );
}

// Variabili per lo smoothing delle dita
const fingerSmoothingFactor = 0.8;
let lastFingerPositions = Array(21).fill().map(() => ({ x: 0, y: 0, z: 0 }));

// Correzione dell'Offset tra la Mano e il Tracking

// Ridimensiona il canvas quando la finestra viene ridimensionata
function resizeCanvas() {
    // Imposta le dimensioni del canvas per corrispondere esattamente alle dimensioni del video
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;
    
    // Assicurati che il canvas abbia lo stesso stile di dimensioni del video
    canvasElement.style.width = videoElement.clientWidth + 'px';
    canvasElement.style.height = videoElement.clientHeight + 'px';
}

// Funzione per rilevare se la mano è aperta o chiusa
function detectHandState(landmarks) {
    // Calcola le distanze tra le punte delle dita e il palmo
    const palmCenter = landmarks[0]; // Centro del palmo
    const fingerTips = [4, 8, 12, 16, 20]; // Punte di pollice, indice, medio, anulare, mignolo
    
    let openFingers = 0;
    
    // Controlla ogni dito
    for (let i = 1; i < fingerTips.length; i++) { // Salta il pollice per ora
        const fingerTip = landmarks[fingerTips[i]];
        const fingerBase = landmarks[fingerTips[i] - 2]; // Base del dito
        
        // Se la punta del dito è più lontana dal palmo rispetto alla base, il dito è aperto
        const tipDistance = calculateDistance(fingerTip, palmCenter);
        const baseDistance = calculateDistance(fingerBase, palmCenter);
        
        if (tipDistance > baseDistance * 1.1) {
            openFingers++;
        }
    }
    
    // Controllo speciale per il pollice
    const thumbTip = landmarks[4];
    const thumbBase = landmarks[2];
    const indexBase = landmarks[5];
    
    const thumbToIndex = calculateDistance(thumbTip, indexBase);
    const thumbBaseToIndex = calculateDistance(thumbBase, indexBase);
    
    if (thumbToIndex > thumbBaseToIndex * 1.2) {
        openFingers++;
    }
    
    // Se almeno 3 dita sono aperte, considera la mano aperta
    return openFingers >= 3 ? 'aperta' : 'chiusa';
}

// Funzione per triggerare i suoni delle percussioni
function triggerDrumSound(handState) {
    if (handState !== lastHandState) {
        if (handState === 'aperta' && snarePlayer) {
            snarePlayer.start();
            lastDrumValue.textContent = 'Rullante';
        } else if (handState === 'chiusa' && kickPlayer) {
            kickPlayer.start();
            lastDrumValue.textContent = 'Cassa';
        }
        lastHandState = handState;
    }
}



// Funzione per aggiornare il volume delle percussioni
function updateDrumVolume() {
    if (snarePlayer && kickPlayer) {
        // Converti da dB a gain lineare
        const gainValue = Tone.dbToGain(drumVolume);
        snarePlayer.volume.gain.value = gainValue;
        kickPlayer.volume.gain.value = gainValue;
    }
}

// Nuova funzione per gestire l'organo
function handleOrganMode(landmarks) {
    const indexFingerTip = landmarks[8];
    const palmCenter = landmarks[0];
    
    // Usa la posizione Y dell'indice per il pitch (più in alto = più acuto)
    const organFrequency = mapRange(indexFingerTip.y, 0, 1, 800, 200); // Invertito: alto = acuto
    
    // Usa la distanza dal palmo per il volume
    const distance = calculateDistance(indexFingerTip, palmCenter);
    const organVolume = mapRange(distance, 0, 0.3, 0, 0.5); // Volume lineare da 0 a 0.5
    
    // Aggiorna la frequenza solo se c'è un cambiamento significativo
    if (Math.abs(indexFingerTip.y - lastLeftHandY) > 0.01) {
        // Aggiorna le frequenze di tutti gli oscillatori Hammond
        organSynth.oscillators[0].frequency.value = organFrequency;
        organSynth.oscillators[1].frequency.value = organFrequency * 2; // ottava
        organSynth.oscillators[2].frequency.value = organFrequency * 3; // quinta dell'ottava
        lastLeftHandY = indexFingerTip.y;
    }
    
    // Aggiorna il volume tramite il mixer
    organSynth.mixer.gain.value = Math.max(0, Math.min(0.5, organVolume));
    
    // Aggiorna i display
    handStateValue.textContent = `Freq: ${Math.round(organFrequency)}Hz`;
    lastDrumValue.textContent = `Vol: ${Math.round(organVolume * 100)}%`;
}

// Modifica la gestione della mano sinistra nella funzione onResults
// Sostituisci la sezione "Gestisci la mano sinistra" con:
// Aggiungi questa funzione dopo hands.setOptions
hands.onResults((results) => {
    // Pulisci il canvas
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    // Variabili per le mani
    let rightHand = null;
    let leftHand = null;
    
    // Identifica le mani (destra e sinistra)
    if (results.multiHandLandmarks && results.multiHandedness) {
        for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness[i];
            
            // MediaPipe restituisce "Left" per la mano destra vista dalla camera
            if (handedness.label === 'Left') {
                rightHand = { landmarks };
            } else {
                leftHand = { landmarks };
            }
        }
    }
    
    // Gestisci la mano destra (theremin)
    if (rightHand && isPlaying) {
        const landmarks = rightHand.landmarks;
        
        // Disegna la mano destra
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        drawLandmarks(canvasCtx, landmarks, { color: '#FF0000', lineWidth: 1 });
        
        // Usa l'indice per il pitch e il pollice per il volume
        const indexFingerTip = landmarks[8];
        const thumbTip = landmarks[4];
        
        // Applica smoothing alle posizioni delle dita
        lastFingerPositions[8].x = lastFingerPositions[8].x * fingerSmoothingFactor + indexFingerTip.x * (1 - fingerSmoothingFactor);
        lastFingerPositions[8].y = lastFingerPositions[8].y * fingerSmoothingFactor + indexFingerTip.y * (1 - fingerSmoothingFactor);
        lastFingerPositions[4].x = lastFingerPositions[4].x * fingerSmoothingFactor + thumbTip.x * (1 - fingerSmoothingFactor);
        lastFingerPositions[4].y = lastFingerPositions[4].y * fingerSmoothingFactor + thumbTip.y * (1 - fingerSmoothingFactor);
        
        // Calcola la frequenza basata sulla posizione Y dell'indice
        let frequency = mapRange(lastFingerPositions[8].y, 0, 1, MAX_FREQ, MIN_FREQ);
        
        // Applica la scala musicale
        frequency = snapToScale(frequency);
        
        // Calcola il volume basato sulla posizione Y del pollice
        const volume = mapRange(lastFingerPositions[4].y, 0, 1, MAX_VOL, MIN_VOL);
        
        // Calcola la distanza tra indice e pollice per il riverbero
        const distance = calculateDistance(lastFingerPositions[8], lastFingerPositions[4]);
        const reverbAmount = mapRange(distance, 0, 0.3, 0, 1);
        
        // Aggiorna il sintetizzatore
        synth.frequency.value = frequency;
        synth.volume.value = volume;
        reverb.wet.value = Math.max(0, Math.min(1, reverbAmount));
        
        // Aggiorna i display
        frequencyValue.textContent = Math.round(frequency);
        noteValue.textContent = getNoteName(frequency);
        volumeValue.textContent = Math.round(volume);
        reverbValue.textContent = Math.round(reverbAmount * 100);
        
        // Disegna indicatori visivi
        // Indicatore per il pitch (indice)
        canvasCtx.beginPath();
        canvasCtx.arc(
            lastFingerPositions[8].x * canvasElement.width,
            lastFingerPositions[8].y * canvasElement.height,
            10, 0, 2 * Math.PI
        );
        canvasCtx.fillStyle = 'rgba(255, 255, 0, 0.7)';
        canvasCtx.fill();
        
        // Indicatore per il volume (pollice)
        canvasCtx.beginPath();
        canvasCtx.arc(
            lastFingerPositions[4].x * canvasElement.width,
            lastFingerPositions[4].y * canvasElement.height,
            8, 0, 2 * Math.PI
        );
        canvasCtx.fillStyle = 'rgba(0, 255, 255, 0.7)';
        canvasCtx.fill();
    }
    
    // Gestisci la mano sinistra
    if (leftHand) {
        const landmarks = leftHand.landmarks;
        
        // Disegna la mano sinistra
        const handColor = leftHandMode === 'drums' ? '#0000FF' : '#FF8000';
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 2 });
        drawLandmarks(canvasCtx, landmarks, { color: '#00FFFF', lineWidth: 1 });
        
        if (leftHandMode === 'drums') {
            // Modalità percussioni (codice esistente)
            const handState = detectHandState(landmarks);
            handStateValue.textContent = handState;
            triggerDrumSound(handState);
            
            const palmCenter = landmarks[0];
            canvasCtx.beginPath();
            canvasCtx.arc(
                palmCenter.x * canvasElement.width,
                palmCenter.y * canvasElement.height,
                20, 0, 2 * Math.PI
            );
            canvasCtx.fillStyle = handState === 'aperta' ? 'rgba(255, 255, 0, 0.7)' : 'rgba(255, 0, 255, 0.7)';
            canvasCtx.fill();
        } else if (leftHandMode === 'organ') {
            // Modalità organo
            handleOrganMode(landmarks);
            
            // Evidenzia il dito indice per l'organo
            const indexTip = landmarks[8];
            canvasCtx.beginPath();
            canvasCtx.arc(
                indexTip.x * canvasElement.width,
                indexTip.y * canvasElement.height,
                15, 0, 2 * Math.PI
            );
            canvasCtx.fillStyle = 'rgba(255, 128, 0, 0.7)';
            canvasCtx.fill();
        }
    }
    
    canvasCtx.restore();
});

// Aggiungi event listener per il cambio modalità
leftHandModeSelect.addEventListener('change', (e) => {
    leftHandMode = e.target.value;
    
    if (leftHandMode === 'organ' && organSynth && isPlaying) {
        // Avvia l'organo quando si passa alla modalità organo
        organSynth.triggerAttack(400);
    } else if (leftHandMode === 'drums' && organSynth) {
        // Ferma l'organo quando si passa alle percussioni
        organSynth.triggerRelease();
    }
    
    // Reset dei display
    handStateValue.textContent = '-';
    lastDrumValue.textContent = '-';
});

// Modifica la funzione di dispose per includere l'organo
function disposeToneJS() {
    if (synth) {
        synth.triggerRelease();
        synth.dispose();
        synth = null;
    }
    if (reverb) {
        reverb.dispose();
        reverb = null;
    }
    if (organSynth) {
        organSynth.triggerRelease();
        organSynth.dispose();
        organSynth = null;
    }
    if (snarePlayer) {
        snarePlayer = null;
    }
    if (kickPlayer) {
        kickPlayer = null;
    }
    camera.stop();
    isPlaying = false;
    startButton.textContent = 'Avvia Theremin';
    lastHandState = null;
}

// Event listener per il pulsante start/stop
startButton.addEventListener('click', async () => {
    if (!isPlaying) {
        try {
            // Avvia Tone.js solo dopo l'interazione dell'utente
            await Tone.start();
            console.log('Audio context avviato');
            
            // Inizializza Tone.js
            initToneJS();
            
            // Avvia la camera
            await camera.start();
            
            isPlaying = true;
            startButton.textContent = 'Ferma Theremin';
        } catch (error) {
            console.error('Errore durante l\'avvio:', error);
            alert('Errore durante l\'avvio del theremin. Riprova.');
        }
    } else {
        // Ferma tutto
        disposeToneJS();
    }
});

// Aggiungi un event listener per quando il video è pronto
videoElement.addEventListener('loadedmetadata', () => {
    // Aggiorna le dimensioni del canvas quando il video è caricato
    resizeCanvas();
});

// Aggiungi listener per il ridimensionamento
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', resizeCanvas);
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
    
    // Avvia il sintetizzatore
    synth.triggerAttack(MIN_FREQ);
    
    // Imposta il volume iniziale
    synth.volume.value = MIN_VOL;
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

// Gestione dei risultati del tracking delle mani
hands.onResults((results) => {
    // Pulisci il canvas
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Assicurati che il canvas abbia le dimensioni corrette
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        resizeCanvas();
    }
    
    try {
        // Se ci sono mani rilevate
        if (results.multiHandLandmarks && isPlaying) {
            // Per ogni mano rilevata
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const smoothedLandmarks = [];
                
                // Applica lo smoothing a ogni punto della mano
                for (let j = 0; j < landmarks.length; j++) {
                    const landmark = landmarks[j];
                    const lastPosition = lastFingerPositions[j];
                    
                    // Calcola la velocità del movimento
                    const movementSpeed = Math.sqrt(
                        Math.pow(landmark.x - lastPosition.x, 2) + 
                        Math.pow(landmark.y - lastPosition.y, 2)
                    );
                    
                    // Smoothing adattivo: più veloce è il movimento, minore è lo smoothing
                    const adaptiveSmoothingFactor = Math.max(0.1, Math.min(0.5, 0.5 - movementSpeed * 2));
                    
                    // Applica lo smoothing
                    const smoothedPosition = {
                        x: lastPosition.x * adaptiveSmoothingFactor + landmark.x * (1 - adaptiveSmoothingFactor),
                        y: lastPosition.y * adaptiveSmoothingFactor + landmark.y * (1 - adaptiveSmoothingFactor),
                        z: lastPosition.z * adaptiveSmoothingFactor + landmark.z * (1 - adaptiveSmoothingFactor)
                    };
                    
                    // Aggiorna l'ultima posizione
                    lastFingerPositions[j] = smoothedPosition;
                    smoothedLandmarks.push(smoothedPosition);
                }
                
                // Disegna i punti di riferimento della mano con i valori smussati
                drawConnectors(canvasCtx, smoothedLandmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
                drawLandmarks(canvasCtx, smoothedLandmarks, { color: '#FF0000', lineWidth: 1 });
                
                // Se è la prima mano, usa i valori smussati per il controllo
                if (i === 0) {
                    // Usa la punta dell'indice (punto 8) per il controllo della frequenza
                    const indexFingerTip = smoothedLandmarks[8];
                    // Usa la punta del pollice (punto 4) per il controllo del volume
                    const thumbTip = smoothedLandmarks[4];
                    
                    // Mappa la posizione X dell'indice al pitch (frequenza)
                    const rawFrequency = mapRange(indexFingerTip.x, 0, 1, MIN_FREQ, MAX_FREQ);
                    const frequency = snapToScale(rawFrequency);
                    synth.frequency.value = frequency;
                    frequencyValue.textContent = `${Math.round(frequency)} Hz`;
                    
                    // Aggiorna la visualizzazione della nota
                    noteValue.textContent = getNoteName(frequency);
                    
                    // Mappa la posizione Y del pollice al volume
                    const volume = mapRange(thumbTip.y, 0, 1, MAX_VOL, MIN_VOL);
                    synth.volume.value = volume;
                    volumeValue.textContent = `${Math.round(volume)} dB`;
                    
                    // Calcola la distanza tra pollice e indice per il controllo del riverbero
                    const thumbIndexDistance = calculateDistance(thumbTip, indexFingerTip);
                    
                    // Mappa la distanza al riverbero (valori più piccoli per un controllo più preciso)
                    const reverbAmount = mapRange(thumbIndexDistance, 0.05, 0.3, 0, 1);
                    // Assicurati che il valore sia compreso tra 0 e 1
                    const clampedReverbAmount = Math.min(1, Math.max(0, reverbAmount));
                    reverb.wet.value = clampedReverbAmount;
                    reverbValue.textContent = clampedReverbAmount.toFixed(2);
                    
                    // Disegna una linea tra pollice e indice per visualizzare il controllo del riverbero
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(thumbTip.x * canvasElement.width, thumbTip.y * canvasElement.height);
                    canvasCtx.lineTo(indexFingerTip.x * canvasElement.width, indexFingerTip.y * canvasElement.height);
                    canvasCtx.strokeStyle = '#FFFF00';
                    canvasCtx.lineWidth = 2;
                    canvasCtx.stroke();
                    
                    // Evidenzia le dita attive
                    canvasCtx.beginPath();
                    canvasCtx.arc(
                        smoothedLandmarks[8].x * canvasElement.width,
                        smoothedLandmarks[8].y * canvasElement.height,
                        15, 0, 2 * Math.PI
                    );
                    canvasCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    canvasCtx.fill();
                    
                    canvasCtx.beginPath();
                    canvasCtx.arc(
                        smoothedLandmarks[4].x * canvasElement.width,
                        smoothedLandmarks[4].y * canvasElement.height,
                        15, 0, 2 * Math.PI
                    );
                    canvasCtx.fillStyle = 'rgba(0, 0, 255, 0.5)';
                    canvasCtx.fill();
                }
            }
        }
    } catch (error) {
        console.error('Errore durante l\'elaborazione dei risultati:', error);
    }
    
    canvasCtx.restore();
});



// Gestione degli errori di MediaPipe
hands.onError = (error) => {
    console.error('Errore MediaPipe Hands:', error);
    
    // Se l'errore è fatale, riavvia MediaPipe
    if (isPlaying) {
        console.log('Tentativo di riavvio di MediaPipe...');
        
        // Ferma temporaneamente la camera
        camera.stop();
        
        // Attendi un secondo e riavvia
        setTimeout(() => {
            if (isPlaying) {
                camera.start();
            }
        }, 1000);
    }
};

// Event listener per il selettore di scala
scaleSelect.addEventListener('change', function() {
    currentScale = this.value;
    console.log('Scala cambiata a:', currentScale);
});

// Event listener per il selettore di nota base
rootNoteSelect.addEventListener('change', function() {
    rootNote = parseInt(this.value);
    console.log('Nota base cambiata a:', rootNote);
});

// Gestione del pulsante di avvio
startButton.addEventListener('click', () => {
    if (!isPlaying) {
        // Avvia il theremin
        startButton.disabled = true;
        startButton.textContent = 'Avvio in corso...';
        
        Tone.start().then(() => {
            try {
                initToneJS();
                camera.start();
                isPlaying = true;
                startButton.textContent = 'Ferma Theremin';
            } catch (error) {
                console.error('Errore durante l\'avvio:', error);
                alert('Si è verificato un errore durante l\'avvio. Ricarica la pagina e riprova.');
            } finally {
                startButton.disabled = false;
            }
        }).catch(error => {
            console.error('Errore durante l\'inizializzazione di Tone.js:', error);
            alert('Si è verificato un errore con l\'audio. Assicurati di utilizzare un browser supportato.');
            startButton.disabled = false;
            startButton.textContent = 'Avvia Theremin';
        });
    } else {
        // Ferma il theremin
        if (synth) {
            synth.triggerRelease();
            synth.dispose();
            synth = null;
        }
        if (reverb) {
            reverb.dispose();
            reverb = null;
        }
        camera.stop();
        isPlaying = false;
        startButton.textContent = 'Avvia Theremin';
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
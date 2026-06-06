// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCEInTAPaT-XwjDzu-f72wh4RnoxSgT1tE",
  authDomain: "serial-box-1d9f3.firebaseapp.com",
  databaseURL: "https://serial-box-1d9f3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "serial-box-1d9f3",
  storageBucket: "serial-box-1d9f3.firebasestorage.app",
  messagingSenderId: "591497997191",
  appId: "1:591497997191:web:3efec55d232f2bc04e0122",
  measurementId: "G-M1DLWYDWHH"
};

// Initialize Firebase Realtime Database
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const dbRef = database.ref('boxes');

// App State
const state = {
    activeInputTab: 'bulk', // 'bulk' | 'scan'
    activeOutputTab: 'grouped', // 'grouped' | 'flat'
    liveMode: false,
    scannedSerials: [],
    boxes: [], // { boxIndex: 1, startSerial: '...', sequence: [...], isDuplicate: false }
    flatSerials: [], // all generated items flattened
    duplicatesCount: 0
};

// DOM Elements
const dom = {
    toggleTheme: document.getElementById('toggleTheme'),
    themeIcon: document.getElementById('themeIcon'),
    
    // Stats
    statBoxes: document.getElementById('statBoxes'),
    statTotalSerials: document.getElementById('statTotalSerials'),
    statDuplicates: document.getElementById('statDuplicates'),
    statCardDuplicates: document.getElementById('statCardDuplicates'),
    
    // Inputs & Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    outTabButtons: document.querySelectorAll('.out-tab-btn'),
    outTabContents: document.querySelectorAll('.out-tab-content'),
    
    seqLength: document.getElementById('seqLength'),
    liveModeToggle: document.getElementById('liveModeToggle'),
    bulkInput: document.getElementById('bulkInput'),
    scanInput: document.getElementById('scanInput'),
    scannedList: document.getElementById('scannedList'),
    scanCount: document.getElementById('scanCount'),
    
    // Camera Elements
    btnStartCamera: document.getElementById('btnStartCamera'),
    btnCloseCamera: document.getElementById('btnCloseCamera'),
    cameraModal: document.getElementById('cameraModal'),
    
    // Actions
    btnGenerate: document.getElementById('btnGenerate'),
    btnClear: document.getElementById('btnClear'),
    
    // Outputs
    groupedContainer: document.getElementById('groupedContainer'),
    flatOutput: document.getElementById('flatOutput'),
    btnCopyFlat: document.getElementById('btnCopyFlat'),
    btnDownloadCSV: document.getElementById('btnDownloadCSV'),
    toastContainer: document.getElementById('toastContainer')
};

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        dom.themeIcon.setAttribute('data-lucide', 'moon');
    } else {
        document.body.classList.remove('light-theme');
        dom.themeIcon.setAttribute('data-lucide', 'sun');
    }
    lucide.createIcons();
}

dom.toggleTheme.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'theme');
    dom.themeIcon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    lucide.createIcons();
});

// Toast System
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-triangle';
    if (type === 'warning') iconName = 'alert-circle';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span>${message}</span>
    `;
    dom.toastContainer.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Sound Effects System
function playBeep(frequency, duration, type = 'sine') {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = frequency;
        osc.type = type;
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn("Sound blocked or not supported", e);
    }
}

function playSuccessBeep() {
    playBeep(880, 0.08, 'sine'); // Clean high pitch
}

function playWarningBeep() {
    playBeep(220, 0.3, 'sawtooth'); // Deep warning buzzy sound
}

// Tab Switching
dom.tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        dom.tabButtons.forEach(btn => btn.classList.remove('active'));
        dom.tabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        state.activeInputTab = button.dataset.tab;
        document.getElementById(`tab${state.activeInputTab.charAt(0).toUpperCase() + state.activeInputTab.slice(1)}`).classList.add('active');
        
        if (state.activeInputTab === 'scan') {
            dom.scanInput.focus();
        }
    });
});

dom.outTabButtons.forEach(button => {
    button.addEventListener('click', () => {
        dom.outTabButtons.forEach(btn => btn.classList.remove('active'));
        dom.outTabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        state.activeOutputTab = button.dataset.outTab;
        document.getElementById(`outTab${state.activeOutputTab.charAt(0).toUpperCase() + state.activeOutputTab.slice(1)}`).classList.add('active');
    });
});

// Settings Events
dom.liveModeToggle.addEventListener('change', () => {
    state.liveMode = dom.liveModeToggle.checked;
    if (state.liveMode) {
        showToast("Live Scanner Mode Enabled (Auto-generate active)", "success");
        const scanTabBtn = document.querySelector('[data-tab="scan"]');
        if (scanTabBtn) scanTabBtn.click();
    } else {
        showToast("Live Scanner Mode Disabled", "info");
    }
});

// Input Helper to strip trailing commas and common scanner suffixes
function cleanSerial(serial) {
    if (!serial) return '';
    return serial.replace(/[,;\s]+$/, '').trim();
}

// Barcode Scanning Handlers
dom.scanInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const rawVal = dom.scanInput.value.trim();
        if (!rawVal) return;
        
        const cleanedVal = cleanSerial(rawVal);
        if (!cleanedVal) return;
        
        if (state.liveMode) {
            handleLiveScan(cleanedVal);
        } else {
            handleNormalScan(cleanedVal);
        }
        dom.scanInput.value = '';
        dom.scanInput.focus();
    }
});

function handleNormalScan(cleanedVal) {
    if (state.scannedSerials.includes(cleanedVal)) {
        playWarningBeep();
        showToast(`"${cleanedVal}" is already in the scan list.`, 'warning');
    } else {
        state.scannedSerials.push(cleanedVal);
        playSuccessBeep();
        showToast(`Added starting serial: ${cleanedVal}`, 'success');
        renderScannedList();
    }
}

function handleLiveScan(cleanedVal) {
    const count = parseInt(dom.seqLength.value, 10);
    if (isNaN(count) || count < 1) {
        playWarningBeep();
        showToast("Please enter a valid sequence length.", "warning");
        return;
    }
    
    // Evaluate if starting serial already exists in the system
    const activeSerials = new Set(state.flatSerials.map(s => s.serial));
    const isDuplicate = activeSerials.has(cleanedVal);
    
    // Suppress sequence generation if starting serial is duplicate
    const newSequence = isDuplicate ? [] : generateSequence(cleanedVal, count);
    const newBoxIndex = state.boxes.length + 1;
    
    // Push directly to Firebase. The real-time listener will sync back and update UI
    dbRef.push({
        boxIndex: newBoxIndex,
        startSerial: cleanedVal,
        sequence: newSequence,
        isDuplicate: isDuplicate
    }).then(() => {
        if (isDuplicate) {
            playWarningBeep();
            // Trace original box
            let originBoxNum = -1;
            for (let i = 0; i < state.boxes.length; i++) {
                const b = state.boxes[i];
                if (b.startSerial === cleanedVal || b.sequence.some(s => s.serial === cleanedVal)) {
                    originBoxNum = b.boxIndex;
                    break;
                }
            }
            const originMsg = originBoxNum !== -1 ? ` (exists in Box ${originBoxNum})` : '';
            showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate${originMsg}.`, 'error');
        } else {
            playSuccessBeep();
            showToast(`Box ${newBoxIndex} added. Generated next ${count} serials.`, 'success');
        }
        
        // Auto-scroll to newly generated card
        setTimeout(() => {
            const cards = dom.groupedContainer.querySelectorAll('.box-card');
            if (cards.length > 0) {
                const lastCard = cards[cards.length - 1];
                lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 80);
    }).catch(err => {
        showToast("Database write failed. Check internet connection.", "error");
        console.error(err);
    });
}

function removeScannedItem(index) {
    state.scannedSerials.splice(index, 1);
    renderScannedList();
    dom.scanInput.focus();
}

function renderScannedList() {
    dom.scanCount.textContent = state.scannedSerials.length;
    if (state.scannedSerials.length === 0) {
        dom.scannedList.innerHTML = '<div class="empty-list-text">No starting serials scanned yet.</div>';
        return;
    }
    
    dom.scannedList.innerHTML = state.scannedSerials.map((serial, idx) => `
        <div class="scan-item">
            <span class="serial-val">${serial}</span>
            <button class="btn-remove-scan" onclick="removeScannedItem(${idx})" title="Remove">
                <i data-lucide="x" style="width:14px;height:14px;"></i>
            </button>
        </div>
    `).join('');
    lucide.createIcons();
}

// Interactive Box Deletion (Synchronized on Firebase)
window.deleteBox = function(boxIndex) {
    const updatedBoxes = state.boxes.filter(b => b.boxIndex !== boxIndex);
    
    // Re-index remaining boxes consecutively
    updatedBoxes.forEach((box, i) => {
        box.boxIndex = i + 1;
    });
    
    // Overwrite database to sync all clients
    dbRef.set(updatedBoxes).then(() => {
        showToast(`Box ${boxIndex} deleted.`, 'info');
    }).catch(err => {
        showToast("Failed to delete box. Check database connection.", "error");
        console.error(err);
    });
};

// Collapsible Accordion Toggle Handler
window.toggleBox = function(headerElement) {
    const card = headerElement.closest('.box-card');
    card.classList.toggle('collapsed');
};

// Camera Scanning Module
let html5QrCode = null;

dom.btnStartCamera.addEventListener('click', () => {
    dom.cameraModal.classList.add('active');
    startCamera();
});

dom.btnCloseCamera.addEventListener('click', () => {
    stopCamera();
});

function startCamera() {
    if (html5QrCode) {
        stopCamera();
    }
    
    html5QrCode = new Html5Qrcode("cameraReader");
    const config = { 
        fps: 10, 
        qrbox: (width, height) => {
            const minSize = Math.min(width, height);
            const boxWidth = Math.floor(minSize * 0.75);
            const boxHeight = Math.floor(boxWidth * 0.45);
            return { width: boxWidth, height: boxHeight };
        }
    };
    
    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            const cleanedVal = cleanSerial(decodedText);
            if (cleanedVal) {
                if (state.liveMode) {
                    handleLiveScan(cleanedVal);
                } else {
                    handleNormalScan(cleanedVal);
                }
            }
            stopCamera();
        },
        (errorMessage) => {
            // Ignore frame check failure console noise
        }
    ).catch(err => {
        showToast("Camera access failed or permission denied.", "error");
        console.error(err);
        stopCamera();
    });
}

function stopCamera() {
    dom.cameraModal.classList.remove('active');
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode = null;
        }).catch(err => {
            console.error("Failed to stop html5QrCode", err);
            html5QrCode = null;
        });
    }
}

// Recalculate Duplicates Across State (Compiles active set and sets flags)
function recalculateDuplicates() {
    const activeSerials = new Set();
    let dupCount = 0;
    
    state.boxes.forEach(box => {
        const start = box.startSerial;
        
        if (activeSerials.has(start)) {
            box.isDuplicate = true;
            box.sequence = [];
            dupCount++;
        } else {
            box.isDuplicate = false;
            activeSerials.add(start);
            
            // Safeguard sequence structure
            if (!box.sequence) box.sequence = [];
            
            box.sequence.forEach(item => {
                if (activeSerials.has(item.serial)) {
                    item.isDuplicate = true;
                    dupCount++;
                } else {
                    item.isDuplicate = false;
                    activeSerials.add(item.serial);
                }
            });
        }
    });
    
    state.duplicatesCount = dupCount;
    
    // Compile flatSerials for display/export
    const flat = [];
    state.boxes.forEach(box => {
        flat.push({
            serial: box.startSerial,
            type: 'start',
            isDuplicate: box.isDuplicate,
            boxIndex: box.boxIndex
        });
        
        if (!box.isDuplicate && box.sequence) {
            box.sequence.forEach(item => {
                flat.push({
                    serial: item.serial,
                    type: 'generated',
                    isDuplicate: item.isDuplicate,
                    boxIndex: box.boxIndex
                });
            });
        }
    });
    
    state.flatSerials = flat;
    
    updateStats();
    renderOutput();
}

// Clear all inputs and state (Synchronized in Firebase)
dom.btnClear.addEventListener('click', () => {
    dbRef.set(null).then(() => {
        state.scannedSerials = [];
        dom.bulkInput.value = '';
        dom.scanInput.value = '';
        dom.flatOutput.value = '';
        renderScannedList();
        showToast("System cleared in database.", "info");
    }).catch(err => {
        showToast("Failed to clear database.", "error");
        console.error(err);
    });
});

// Parse Serial Sequences
function parseStartingSerials() {
    let list = [];
    if (state.activeInputTab === 'bulk') {
        const text = dom.bulkInput.value.trim();
        if (text) {
            list = text.split(/[,\n]+/).map(s => cleanSerial(s)).filter(s => s !== '');
        }
    } else {
        list = [...state.scannedSerials];
    }
    return list;
}

// Generates next subsequent serial numbers starting from the startSerial offset
function generateSequence(startSerial, count) {
    const sequence = [];
    const match = startSerial.match(/^(.*?)(\d+)$/);
    
    let prefix = '';
    let numericStr = '';
    let startNum = 0;
    let padLength = 0;
    
    if (match) {
        prefix = match[1];
        numericStr = match[2];
        startNum = parseInt(numericStr, 10);
        padLength = numericStr.length;
    } else {
        prefix = startSerial + '-';
        numericStr = '0000';
        startNum = 0;
        padLength = 4;
    }
    
    for (let i = 1; i <= count; i++) {
        const currentNum = startNum + i;
        let currentNumStr = String(currentNum);
        if (currentNumStr.length < padLength) {
            currentNumStr = currentNumStr.padStart(padLength, '0');
        }
        
        const serial = prefix + currentNumStr;
        sequence.push({
            serial: serial,
            type: 'generated',
            isDuplicate: false
        });
    }
    return sequence;
}

// Bulk Generation Click handler (Synchronized in Firebase)
dom.btnGenerate.addEventListener('click', () => {
    const startSerials = parseStartingSerials();
    const count = parseInt(dom.seqLength.value, 10);
    
    if (startSerials.length === 0) {
        playWarningBeep();
        showToast("Please input or scan at least one starting serial number.", "warning");
        return;
    }
    if (isNaN(count) || count < 1) {
        playWarningBeep();
        showToast("Please enter a valid sequence length (minimum 1).", "warning");
        return;
    }
    
    const tempBoxes = [];
    const activeSerials = new Set();
    
    startSerials.forEach((start, index) => {
        const isDuplicate = activeSerials.has(start);
        let sequence = [];
        if (isDuplicate) {
            // Suppress
        } else {
            activeSerials.add(start);
            sequence = generateSequence(start, count);
            sequence.forEach(item => activeSerials.add(item.serial));
        }
        
        tempBoxes.push({
            boxIndex: index + 1,
            startSerial: start,
            sequence: sequence,
            isDuplicate: isDuplicate
        });
    });
    
    // Overwrite database to sync all clients
    dbRef.set(tempBoxes).then(() => {
        playSuccessBeep();
        showToast("Bulk sequences generated & synced to cloud!", 'success');
    }).catch(err => {
        showToast("Failed to generate sequence. Check database connection.", "error");
        console.error(err);
    });
});

// Update Statistics Cards
function updateStats() {
    dom.statBoxes.textContent = state.boxes.length;
    dom.statTotalSerials.textContent = state.flatSerials.length;
    dom.statDuplicates.textContent = state.duplicatesCount;
    
    if (state.duplicatesCount > 0) {
        dom.statCardDuplicates.classList.add('has-duplicates');
    } else {
        dom.statCardDuplicates.classList.remove('has-duplicates');
    }
}

// Render Results
function renderOutput() {
    if (state.boxes.length === 0) {
        dom.groupedContainer.innerHTML = `
            <div class="empty-output-state">
                <i data-lucide="layers-2"></i>
                <p>No sequences generated yet. Input starting serials and click "Generate".</p>
            </div>
        `;
        dom.flatOutput.value = '';
        lucide.createIcons();
        return;
    }
    
    dom.groupedContainer.innerHTML = state.boxes.map(box => {
        if (box.isDuplicate) {
            return `
                <div class="box-card" style="border-color: var(--color-rose); background: rgba(244, 63, 94, 0.03);">
                    <div class="box-header" onclick="toggleBox(this)">
                        <div class="box-title text-rose">
                            <i data-lucide="chevron-down" class="collapse-icon" style="stroke:var(--color-rose);"></i>
                            <i data-lucide="package" style="width:18px;height:18px;stroke:var(--color-rose);"></i>
                            <span>Box ${box.boxIndex}</span>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <span class="box-badge text-rose" style="border-color: var(--color-rose); background: var(--color-rose-light);">REJECTED: Duplicate Start</span>
                            <button class="btn-delete-box" onclick="event.stopPropagation(); deleteBox(${box.boxIndex})" title="Delete Box">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </div>
                    <div class="box-serials-grid">
                        <span class="serial-tag duplicate" title="Duplicate scan starting serial!">${box.startSerial}</span>
                    </div>
                </div>
            `;
        }
        
        const total = box.sequence ? box.sequence.length : 0;
        const boxDups = box.sequence ? box.sequence.filter(s => s.isDuplicate).length : 0;
        const dupBadge = boxDups > 0 ? `<span class="box-badge text-rose" style="border-color: var(--color-rose); background: var(--color-rose-light);">${boxDups} Duplicates</span>` : '';
        
        return `
            <div class="box-card">
                <div class="box-header" onclick="toggleBox(this)">
                    <div class="box-title">
                        <i data-lucide="chevron-down" class="collapse-icon"></i>
                        <i data-lucide="package" style="width:18px;height:18px;"></i>
                        <span>Box ${box.boxIndex}</span>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        ${dupBadge}
                        <span class="box-badge">Start: ${box.startSerial}</span>
                        <span class="box-badge">${total} Serials</span>
                        <button class="btn-delete-box" onclick="event.stopPropagation(); deleteBox(${box.boxIndex})" title="Delete Box">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
                <div class="box-serials-grid">
                    ${box.sequence ? box.sequence.map(item => {
                        let classes = 'serial-tag';
                        if (item.isDuplicate) classes += ' duplicate';
                        const titleAttr = item.isDuplicate ? 'title="Duplicate Serial Number!"' : '';
                        return `<span class="${classes}" ${titleAttr}>${item.serial}</span>`;
                    }).join('') : ''}
                </div>
            </div>
        `;
    }).join('');
    
    dom.flatOutput.value = state.flatSerials.map(s => s.serial).join('\n');
    
    lucide.createIcons();
}

// Clipboard Action
dom.btnCopyFlat.addEventListener('click', () => {
    if (state.flatSerials.length === 0) {
        showToast("No generated serials to copy.", "warning");
        return;
    }
    dom.flatOutput.select();
    document.execCommand('copy');
    showToast("All serial numbers copied to clipboard!", "success");
});

// CSV Export Action
dom.btnDownloadCSV.addEventListener('click', () => {
    if (state.flatSerials.length === 0) {
        showToast("No generated serials to download.", "warning");
        return;
    }
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Box,Serial Number,Type,Status\r\n";
    
    state.flatSerials.forEach(item => {
        const status = item.isDuplicate ? "Duplicate" : "Unique";
        const row = `Box ${item.boxIndex},${item.serial},${item.type},${status}`;
        csvContent += row + "\r\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `serial_sequences_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("CSV file download started.", "success");
});

// Real-Time Firebase Database Value Listener
dbRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        // Handle object map or array structure seamlessly
        const rawList = Array.isArray(data) ? data : Object.values(data);
        state.boxes = rawList.filter(b => b !== null);
        state.boxes.sort((a, b) => a.boxIndex - b.boxIndex);
    } else {
        state.boxes = [];
    }
    
    // Automatically re-evaluate duplicates and render UI globally
    recalculateDuplicates();
});

// Initialize UI
initTheme();
renderScannedList();
updateStats();

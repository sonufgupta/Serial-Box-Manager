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

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    window.database = firebase.database();
    window.dbRef = database.ref('boxes');
} catch (e) {
    console.warn("Failed to initialize Firebase SDK:", e);
}

// Session Identity for Presence Tracking
const sessionId = Math.random().toString(36).substring(2, 9);
const deviceType = window.innerWidth <= 768 ? "Mobile Phone" : "Desktop PC";
let sessionRef = null;

// App State
const state = {
    activeInputTab: 'bulk', // 'bulk' | 'scan'
    activeOutputTab: 'grouped', // 'grouped' | 'flat'
    liveMode: false,
    singleProductMode: false,
    firebaseActive: true, // Defaults to true, toggles to false if Firebase permissions or connection fails
    scannedSerials: [],
    boxes: [], // { boxIndex: 1, startSerial: '...', sequence: [...], isDuplicate: false }
    flatSerials: [], // all generated items flattened
    duplicatesCount: 0,
    pendingScan: null // holds scanned item awaiting mismatch validation approval
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
    sequenceToggle: document.getElementById('sequenceToggle'),
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
    toastContainer: document.getElementById('toastContainer'),
    
    // Length Mismatch Modal Elements
    mismatchModal: document.getElementById('mismatchModal'),
    mismatchScannedSerial: document.getElementById('mismatchScannedSerial'),
    mismatchScannedLen: document.getElementById('mismatchScannedLen'),
    mismatchExpectedSerial: document.getElementById('mismatchExpectedSerial'),
    mismatchExpectedLen: document.getElementById('mismatchExpectedLen'),
    btnRejectScan: document.getElementById('btnRejectScan'),
    btnApproveScan: document.getElementById('btnApproveScan'),
    
    // History Panel Elements
    historyContainer: document.getElementById('historyContainer')
};

// Safe Icon Rendering (handles slow or blocked Lucide script loading)
function renderIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        try {
            lucide.createIcons();
        } catch (e) {
            console.warn("Lucide icons failed to render:", e);
        }
    }
}

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
    renderIcons();
}

dom.toggleTheme.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'theme');
    dom.themeIcon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    renderIcons();
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
    renderIcons();
    
    setTimeout(() => {
        toast.remove();
    }, 4500); 
}

// Sync Status Badge Indicator
function updateSyncBadge() {
    const badge = document.getElementById('syncStatus');
    if (!badge) return;
    if (state.firebaseActive) {
        badge.className = 'sync-badge cloud';
        badge.textContent = 'Cloud Live';
        badge.title = 'Connected to Firebase Realtime Database';
    } else {
        badge.className = 'sync-badge local';
        badge.textContent = 'Local Offline';
        badge.title = 'Firebase Rules locked or Offline. Storing data in browser.';
    }
}

// Fallback to LocalStorage Mode
function switchToLocalMode(errorMsg = '') {
    if (!state.firebaseActive) return; // Already in local mode
    
    state.firebaseActive = false;
    updateSyncBadge();
    
    // Detach Firebase listeners to prevent background overwrites
    try {
        if (window.dbRef && typeof dbRef.off === 'function') {
            dbRef.off();
        }
        sessionRef = null;
    } catch (e) {
        console.warn("Failed to detach Firebase listeners:", e);
    }
    
    showToast("Firebase Offline/Permission Denied. Operating in LocalStorage Mode.", "warning");
    console.warn("Firebase Database Fallback triggered:", errorMsg);
    
    // Load local storage data
    loadLocalData();
}

function loadLocalData() {
    try {
        const localData = localStorage.getItem('local_serial_boxes');
        if (localData) {
            state.boxes = JSON.parse(localData);
        } else {
            state.boxes = [];
        }
    } catch (e) {
        console.error("Failed to load local storage data:", e);
        state.boxes = [];
    }
    recalculateDuplicates();
}

function saveLocalData() {
    try {
        localStorage.setItem('local_serial_boxes', JSON.stringify(state.boxes));
    } catch (e) {
        console.error("Failed to save local storage data:", e);
    }
    recalculateDuplicates();
}

// Save scanned starting serials to localStorage
function saveScannedSerials() {
    try {
        localStorage.setItem('local_scanned_serials', JSON.stringify(state.scannedSerials));
    } catch (e) {
        console.error("Failed to save scanned serials:", e);
    }
}

// Save active configurations/tabs
function saveSettings() {
    try {
        localStorage.setItem('local_seq_length', dom.seqLength.value);
        localStorage.setItem('local_live_mode', state.liveMode);
        localStorage.setItem('local_single_product_mode', state.singleProductMode);
        localStorage.setItem('local_active_input_tab', state.activeInputTab);
        localStorage.setItem('local_active_output_tab', state.activeOutputTab);
    } catch (e) {
        console.error("Failed to save configurations:", e);
    }
}

// Restore state on page reload
function restoreState() {
    try {
        // 1. Scanned starting serials
        const savedScans = localStorage.getItem('local_scanned_serials');
        state.scannedSerials = savedScans ? JSON.parse(savedScans) : [];
        renderScannedList();
        
        // 2. Sequence Length
        const savedSeqLen = localStorage.getItem('local_seq_length');
        if (savedSeqLen) {
            dom.seqLength.value = savedSeqLen;
        }
        
        // 3. Live Scanner Mode
        const savedLiveMode = localStorage.getItem('local_live_mode');
        if (savedLiveMode === 'true') {
            state.liveMode = true;
            dom.liveModeToggle.checked = true;
        } else {
            state.liveMode = false;
            dom.liveModeToggle.checked = false;
        }

        // Restore Sequence Toggle Status
        const savedSingleProduct = localStorage.getItem('local_single_product_mode');
        if (savedSingleProduct === 'true') {
            state.singleProductMode = true;
            if (dom.sequenceToggle) dom.sequenceToggle.checked = false;
            dom.seqLength.disabled = true;
        } else {
            state.singleProductMode = false;
            if (dom.sequenceToggle) dom.sequenceToggle.checked = true;
            dom.seqLength.disabled = false;
        }
        
        // 4. Tabs Status
        const savedInputTab = localStorage.getItem('local_active_input_tab');
        if (savedInputTab) {
            state.activeInputTab = savedInputTab;
            const btn = document.querySelector(`[data-tab="${savedInputTab}"]`);
            if (btn) {
                dom.tabButtons.forEach(b => b.classList.remove('active'));
                dom.tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab${savedInputTab.charAt(0).toUpperCase() + savedInputTab.slice(1)}`).classList.add('active');
            }
        }
        
        const savedOutputTab = localStorage.getItem('local_active_output_tab');
        if (savedOutputTab) {
            state.activeOutputTab = savedOutputTab;
            const btn = document.querySelector(`[data-out-tab="${savedOutputTab}"]`);
            if (btn) {
                dom.outTabButtons.forEach(b => b.classList.remove('active'));
                dom.outTabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`outTab${savedOutputTab.charAt(0).toUpperCase() + savedOutputTab.slice(1)}`).classList.add('active');
            }
        }
    } catch (e) {
        console.error("Failed to restore states:", e);
    }
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
        
        saveSettings();
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
        
        saveSettings();
    });
});

// Settings Events
dom.liveModeToggle.addEventListener('change', () => {
    state.liveMode = dom.liveModeToggle.checked;
    saveSettings();
    if (state.liveMode) {
        showToast("Live Scanner Mode Enabled (Auto-generate active)", "success");
        const scanTabBtn = document.querySelector('[data-tab="scan"]');
        if (scanTabBtn) scanTabBtn.click();
    } else {
        showToast("Live Scanner Mode Disabled", "info");
    }
});

if (dom.sequenceToggle) {
    dom.sequenceToggle.addEventListener('change', () => {
        state.singleProductMode = !dom.sequenceToggle.checked;
        dom.seqLength.disabled = state.singleProductMode;
        saveSettings();
        if (state.singleProductMode) {
            showToast("Sequence Generation Disabled (Single Product Mode)", "info");
            if (!state.firebaseActive) {
                recalculateDuplicates();
                saveLocalData();
            }
        } else {
            showToast("Sequence Generation Enabled", "success");
            if (!state.firebaseActive) {
                recalculateDuplicates();
                saveLocalData();
            }
        }
    });
}

dom.seqLength.addEventListener('change', () => {
    saveSettings();
    if (!state.firebaseActive) {
        recalculateDuplicates();
        saveLocalData();
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
        
        validateAndProcessScan(cleanedVal);
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
        saveScannedSerials();
        playSuccessBeep();
        showToast(`Added starting serial: ${cleanedVal}`, 'success');
        renderScannedList();
    }
}

function handleLiveScan(cleanedVal) {
    const count = state.singleProductMode ? 0 : parseInt(dom.seqLength.value, 10);
    if (!state.singleProductMode && (isNaN(count) || count < 1)) {
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
    const newBox = {
        boxIndex: newBoxIndex,
        startSerial: cleanedVal,
        sequence: newSequence,
        isDuplicate: isDuplicate
    };
    
    // Write flow: Try Firebase first, fallback to localStorage on fail
    if (state.firebaseActive && window.dbRef) {
        dbRef.push(newBox).then(() => {
            if (isDuplicate) {
                playWarningBeep();
                showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate.`, 'error');
            } else {
                playSuccessBeep();
                const msg = state.singleProductMode ? `Box ${newBoxIndex} added.` : `Box ${newBoxIndex} added. Generated next ${count} serials.`;
                showToast(msg, 'success');
            }
        }).catch(err => {
            console.error("Firebase write error. Switching to Local Mode:", err);
            switchToLocalMode(err.message);
            // Local fallback write
            state.boxes.push(newBox);
            saveLocalData();
            if (isDuplicate) {
                playWarningBeep();
                showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate (Local).`, 'error');
            } else {
                playSuccessBeep();
                const msg = state.singleProductMode ? `Box ${newBoxIndex} added locally.` : `Box ${newBoxIndex} added locally.`;
                showToast(msg, 'success');
            }
        });
    } else {
        state.boxes.push(newBox);
        saveLocalData();
        if (isDuplicate) {
            playWarningBeep();
            showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate (Local).`, 'error');
        } else {
            playSuccessBeep();
            const msg = state.singleProductMode ? `Box ${newBoxIndex} added locally.` : `Box ${newBoxIndex} added locally.`;
            showToast(msg, 'success');
        }
    }
    
    // Auto-scroll to newly generated card
    setTimeout(() => {
        const cards = dom.groupedContainer.querySelectorAll('.box-card');
        if (cards.length > 0) {
            const lastCard = cards[cards.length - 1];
            lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 80);
}

function removeScannedItem(index) {
    state.scannedSerials.splice(index, 1);
    saveScannedSerials();
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
    renderIcons();
}

// Interactive Box Deletion (Synchronized or local)
window.deleteBox = function(boxIndex) {
    const updatedBoxes = state.boxes.filter(b => b.boxIndex !== boxIndex);
    
    // Re-index remaining boxes consecutively
    updatedBoxes.forEach((box, i) => {
        box.boxIndex = i + 1;
    });
    
    if (state.firebaseActive && window.dbRef) {
        dbRef.set(updatedBoxes).then(() => {
            showToast(`Box ${boxIndex} deleted.`, 'info');
        }).catch(err => {
            console.error("Firebase delete error. Switching to Local Mode:", err);
            switchToLocalMode(err.message);
            state.boxes = updatedBoxes;
            saveLocalData();
            showToast(`Box ${boxIndex} deleted locally.`, 'info');
        });
    } else {
        state.boxes = updatedBoxes;
        saveLocalData();
        showToast(`Box ${boxIndex} deleted locally.`, 'info');
    }
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
    if (typeof Html5Qrcode === 'undefined') {
        showToast("Camera library not loaded. Check internet connection.", "error");
        dom.cameraModal.classList.remove('active');
        return;
    }
    
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
                validateAndProcessScan(cleanedVal);
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

// Recalculate Duplicates Across State
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

function clearLocalState() {
    state.scannedSerials = [];
    state.boxes = [];
    state.flatSerials = [];
    state.duplicatesCount = 0;
    dom.bulkInput.value = '';
    dom.scanInput.value = '';
    dom.flatOutput.value = '';
    
    // Clear localStorage entries
    localStorage.removeItem('local_scanned_serials');
    localStorage.removeItem('local_serial_boxes');
    
    renderScannedList();
}

// Clear all inputs and state
dom.btnClear.addEventListener('click', () => {
    const password = prompt("Enter passcode to Clear All data:");
    if (password !== "2026") {
        playWarningBeep();
        showToast("Incorrect passcode. Action cancelled.", "error");
        return;
    }
    
    // Save current active state to history before clearing
    saveToHistory();
    
    if (state.firebaseActive && window.dbRef) {
        dbRef.set(null).then(() => {
            clearLocalState();
            showToast("System cleared in database.", "info");
        }).catch(err => {
            console.error("Failed to clear database, falling back to local:", err);
            switchToLocalMode(err.message);
            clearLocalState();
            showToast("System cleared locally.", "info");
        });
    } else {
        clearLocalState();
        showToast("System cleared locally.", "info");
    }
});

// --- LENGTH MISMATCH VALIDATION SYSTEM ---

// Get all allowed serial lengths based on currently active scans and boxes
function getAllowedSerialLengths() {
    const lengths = new Set();
    const examples = {};
    
    if (state.boxes && state.boxes.length > 0) {
        state.boxes.forEach(box => {
            if (box.startSerial) {
                lengths.add(box.startSerial.length);
                examples[box.startSerial.length] = box.startSerial;
            }
        });
    }
    
    if (state.scannedSerials && state.scannedSerials.length > 0) {
        state.scannedSerials.forEach(serial => {
            lengths.add(serial.length);
            examples[serial.length] = serial;
        });
    }
    
    return {
        lengths: Array.from(lengths),
        examples: examples
    };
}

// Validate scanned serial length and show warning modal if mismatched
function validateAndProcessScan(cleanedVal) {
    const allowed = getAllowedSerialLengths();
    
    if (allowed.lengths.length > 0 && !allowed.lengths.includes(cleanedVal.length)) {
        // Mismatch detected! Play beep, show warning dialog, halt inputs
        playWarningBeep();
        
        state.pendingScan = cleanedVal;
        
        // Use the first allowed length as reference in the dialog popup
        const refLength = allowed.lengths[0];
        const refExample = allowed.examples[refLength];
        
        if (dom.mismatchScannedSerial) dom.mismatchScannedSerial.textContent = cleanedVal;
        if (dom.mismatchScannedLen) dom.mismatchScannedLen.textContent = `Length: ${cleanedVal.length}`;
        if (dom.mismatchExpectedSerial) dom.mismatchExpectedSerial.textContent = refExample;
        if (dom.mismatchExpectedLen) dom.mismatchExpectedLen.textContent = `Length: ${refLength}`;
        
        if (dom.mismatchModal) dom.mismatchModal.classList.add('active');
        if (dom.scanInput) dom.scanInput.disabled = true;
    } else {
        // Safe length or first scan: process normally
        processScan(cleanedVal);
    }
}

// Process valid or approved scans
function processScan(cleanedVal) {
    if (state.liveMode) {
        handleLiveScan(cleanedVal);
    } else {
        handleNormalScan(cleanedVal);
    }
}

// Length mismatch modal button handlers
if (dom.btnRejectScan) {
    dom.btnRejectScan.addEventListener('click', () => {
        if (dom.mismatchModal) dom.mismatchModal.classList.remove('active');
        if (dom.scanInput) {
            dom.scanInput.disabled = false;
            dom.scanInput.focus();
        }
        state.pendingScan = null;
        showToast("Scan rejected.", "info");
    });
}

if (dom.btnApproveScan) {
    dom.btnApproveScan.addEventListener('click', () => {
        if (dom.mismatchModal) dom.mismatchModal.classList.remove('active');
        if (dom.scanInput) {
            dom.scanInput.disabled = false;
            dom.scanInput.focus();
        }
        if (state.pendingScan) {
            processScan(state.pendingScan);
            state.pendingScan = null;
        }
    });
}

// --- CLEARED HISTORY LOG SYSTEM ---

// Save cleared session data to history log
function saveToHistory() {
    const hasBoxes = state.boxes && state.boxes.length > 0;
    const hasScanned = state.scannedSerials && state.scannedSerials.length > 0;
    const hasBulkText = dom.bulkInput && dom.bulkInput.value.trim() !== '';
    
    if (!hasBoxes && !hasScanned && !hasBulkText) {
        return; // nothing to save
    }
    
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        let history = historyData ? JSON.parse(historyData) : [];
        
        const now = new Date();
        const options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: true 
        };
        const timestampStr = now.toLocaleString('en-US', options);
        
        // Build readable summary
        let summaryParts = [];
        if (hasBoxes) {
            const totalSerials = state.flatSerials ? state.flatSerials.length : 0;
            summaryParts.push(`${state.boxes.length} Box${state.boxes.length > 1 ? 'es' : ''} (${totalSerials} Serials)`);
        }
        if (hasScanned) {
            summaryParts.push(`${state.scannedSerials.length} Scanned`);
        }
        if (hasBulkText && !hasBoxes) {
            summaryParts.push("Bulk Text");
        }
        const summary = summaryParts.join(', ') || 'Saved Session';
        
        const newEntry = {
            id: 'hist_' + now.getTime(),
            timestamp: timestampStr,
            summary: summary,
            boxes: state.boxes || [],
            scannedSerials: state.scannedSerials || [],
            bulkInput: dom.bulkInput ? dom.bulkInput.value : ''
        };
        
        history.unshift(newEntry);
        
        // Keep last 20 entries
        if (history.length > 20) {
            history = history.slice(0, 20);
        }
        
        localStorage.setItem('serial_manager_history', JSON.stringify(history));
        renderHistory();
    } catch (e) {
        console.error("Failed to save session to history:", e);
    }
}

// Render history list inside panel container
function renderHistory() {
    if (!dom.historyContainer) return;
    
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        const history = historyData ? JSON.parse(historyData) : [];
        
        if (history.length === 0) {
            dom.historyContainer.innerHTML = `
                <div class="empty-list-text" style="padding: 12px 0;">No cleared history found.</div>
            `;
            return;
        }
        
        dom.historyContainer.innerHTML = history.map(item => `
            <div class="history-card">
                <div class="history-info">
                    <span class="history-time">${item.timestamp}</span>
                    <span class="history-summary">${item.summary}</span>
                </div>
                <div class="history-actions">
                    <button class="btn-restore-history" onclick="restoreHistory('${item.id}')" title="Restore this data">
                        Restore
                    </button>
                    <button class="btn-delete-history" onclick="deleteHistory('${item.id}')" title="Delete history entry">
                        <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                    </button>
                </div>
            </div>
        `).join('');
        
        renderIcons();
    } catch (e) {
        console.error("Failed to render history list:", e);
    }
}

// Restore a history entry
window.restoreHistory = function(id) {
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        if (!historyData) return;
        const history = JSON.parse(historyData);
        const entry = history.find(h => h.id === id);
        if (!entry) return;
        
        if (confirm(`Are you sure you want to restore the history from ${entry.timestamp}? This will replace your current active list.`)) {
            // Restore active state
            state.boxes = entry.boxes || [];
            state.scannedSerials = entry.scannedSerials || [];
            if (dom.bulkInput) {
                dom.bulkInput.value = entry.bulkInput || '';
            }
            
            // Save state locally
            saveLocalData();
            saveScannedSerials();
            renderScannedList();
            
            // Sync to Firebase if online
            if (state.firebaseActive && window.dbRef) {
                dbRef.set(state.boxes).then(() => {
                    showToast("History data restored and synced to cloud.", "success");
                }).catch(err => {
                    console.error("Firebase sync failed on restore:", err);
                    showToast("History data restored locally (cloud sync failed).", "warning");
                });
            } else {
                showToast("History data restored locally.", "success");
            }
        }
    } catch (e) {
        console.error("Failed to restore history:", e);
        showToast("Error restoring history data.", "error");
    }
};

// Delete a history entry
window.deleteHistory = function(id) {
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        if (!historyData) return;
        const history = JSON.parse(historyData);
        const updatedHistory = history.filter(h => h.id !== id);
        localStorage.setItem('serial_manager_history', JSON.stringify(updatedHistory));
        renderHistory();
        showToast("History entry deleted.", "info");
    } catch (e) {
        console.error("Failed to delete history:", e);
    }
};

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

// Bulk Generation Click handler (Synchronized or local fallback)
dom.btnGenerate.addEventListener('click', () => {
    const startSerials = parseStartingSerials();
    const count = state.singleProductMode ? 0 : parseInt(dom.seqLength.value, 10);
    
    if (startSerials.length === 0) {
        playWarningBeep();
        showToast("Please input or scan at least one starting serial number.", "warning");
        return;
    }
    if (!state.singleProductMode && (isNaN(count) || count < 1)) {
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
    
    if (state.firebaseActive && window.dbRef) {
        dbRef.set(tempBoxes).then(() => {
            playSuccessBeep();
            showToast("Bulk sequences generated & synced to cloud!", 'success');
        }).catch(err => {
            console.error("Firebase bulk write error. Switching to Local Mode:", err);
            switchToLocalMode(err.message);
            state.boxes = tempBoxes;
            saveLocalData();
            playSuccessBeep();
            showToast("Bulk sequences generated locally (Cloud sync failed).", 'success');
        });
    } else {
        state.boxes = tempBoxes;
        saveLocalData();
        playSuccessBeep();
        showToast("Bulk sequences generated locally.", 'success');
    }
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
        renderIcons();
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
    
    renderIcons();
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

// Firebase Connection Timeout (Switches to Local mode if connection hangs > 3.5 seconds)
let firebaseTimeout = setTimeout(() => {
    if (state.firebaseActive && state.boxes.length === 0) {
        console.warn("Firebase Connection timed out. Falling back to LocalMode.");
        switchToLocalMode("Connection Timeout");
    }
}, 3500);

// Firebase Initialization and Listener Binding
if (window.dbRef) {
    dbRef.on('value', (snapshot) => {
        clearTimeout(firebaseTimeout);
        state.firebaseActive = true;
        updateSyncBadge();
        
        // Write dynamic active session to database
        if (!sessionRef && window.database) {
            sessionRef = database.ref('active_sessions/session_' + sessionId);
            sessionRef.set(deviceType + " (Online) - Last Active: " + new Date().toLocaleTimeString());
            sessionRef.onDisconnect().remove();
        }
        
        const data = snapshot.val();
        if (data) {
            const rawList = Array.isArray(data) ? data : Object.values(data);
            state.boxes = rawList.filter(b => b !== null);
            state.boxes.sort((a, b) => a.boxIndex - b.boxIndex);
        } else {
            state.boxes = [];
        }
        recalculateDuplicates();
    }, (error) => {
        clearTimeout(firebaseTimeout);
        console.warn("Firebase Listener failed (permission rules locked). Switching to local fallback:", error);
        switchToLocalMode(error.message);
    });
} else {
    clearTimeout(firebaseTimeout);
    switchToLocalMode("Firebase SDK not initialized correctly");
}

// Initialize UI & Restore State
initTheme();
restoreState();
handleQueryParams();
registerFileLaunchHandler();
updateStats();
updateSyncBadge();
renderHistory();

// Parse query parameters from PWA shortcuts / share targets / protocols
function handleQueryParams() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // 1. Handle tab switching
        const tab = urlParams.get('tab');
        if (tab === 'scan' || tab === 'bulk') {
            state.activeInputTab = tab;
            const btn = document.querySelector(`[data-tab="${tab}"]`);
            if (btn) {
                dom.tabButtons.forEach(b => b.classList.remove('active'));
                dom.tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
                saveSettings();
                if (tab === 'scan') {
                    dom.scanInput.focus();
                }
            }
        }
        
        // 2. Handle Share Target & Protocol Handler & Note-taking
        const sharedText = urlParams.get('text') || urlParams.get('url');
        const sharedTitle = urlParams.get('title');
        const customSerial = urlParams.get('serial');
        const isNewNote = urlParams.get('new-note');
        
        let importedContent = '';
        
        if (sharedText) {
            importedContent = sharedText;
            showToast(`Shared content imported: ${sharedTitle || 'Text'}`, 'success');
        } else if (customSerial) {
            let serialVal = decodeURIComponent(customSerial);
            if (serialVal.startsWith('web+serial://')) {
                serialVal = serialVal.substring('web+serial://'.length);
            }
            importedContent = serialVal;
            showToast(`Serial link loaded: ${serialVal}`, 'success');
        } else if (isNewNote === 'true') {
            showToast("New note-taking workspace initiated.", "info");
        }
        
        if (importedContent) {
            if (dom.bulkInput.value) {
                dom.bulkInput.value += '\n' + importedContent;
            } else {
                dom.bulkInput.value = importedContent;
            }
            const bulkTabBtn = document.querySelector('[data-tab="bulk"]');
            if (bulkTabBtn) bulkTabBtn.click();
        }
    } catch (e) {
        console.error("Failed to parse query parameters:", e);
    }
}

// Register launchQueue file handler for associated files (.txt, .csv)
function registerFileLaunchHandler() {
    if ('launchQueue' in window && 'files' in LaunchParams.prototype) {
        window.launchQueue.setConsumer(async (launchParams) => {
            if (launchParams.files && launchParams.files.length > 0) {
                for (const fileHandle of launchParams.files) {
                    try {
                        const file = await fileHandle.getFile();
                        const text = await file.text();
                        if (text) {
                            dom.bulkInput.value = text;
                            const bulkTabBtn = document.querySelector('[data-tab="bulk"]');
                            if (bulkTabBtn) bulkTabBtn.click();
                            showToast(`Imported serials from: ${file.name}`, 'success');
                        }
                    } catch (err) {
                        console.error("Failed to read file from launchParams:", err);
                        showToast("Failed to open file.", "error");
                    }
                }
            }
        });
    }
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=3')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.warn('Service Worker registration failed:', err));
    });
}

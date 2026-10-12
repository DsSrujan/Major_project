const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const app = express();
const PORT = process.env.WHATSAPP_PORT || process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Client status: 'initializing' | 'qr_ready' | 'authenticated' | 'ready' | 'auth_failure' | 'disconnected' | 'error'
let clientStatus = 'initializing';
let lastQrCode = null;
let lastError = null;

console.log('--------------------------------------------------');
console.log('🚀 Initializing WhatsApp Service with LocalAuth...');
console.log(`📂 Session cache path: ${path.join(__dirname, '.wwebjs_auth')}`);
console.log('--------------------------------------------------');

// 1. WhatsApp Client Initialization with LocalAuth
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    webVersionCache: {
        type: 'local',
        path: path.join(__dirname, '.wwebjs_cache')
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials'
        ]
    }
});

// Configure Event Listeners
client.on('qr', (qr) => {
    clientStatus = 'qr_ready';
    lastQrCode = qr;
    console.log('\n======================================================');
    console.log('📲 WHATSAPP PAIRING CODE (SCAN WITH WHATSAPP):');
    console.log('======================================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n👉 Open WhatsApp on your phone -> Linked Devices -> Link a Device\n');
});

client.on('authenticated', () => {
    clientStatus = 'authenticated';
    lastQrCode = null;
    console.log('🔑 WhatsApp authentication successful! Resuming session...');
});

client.on('auth_failure', (msg) => {
    clientStatus = 'auth_failure';
    lastError = msg;
    console.error('❌ WhatsApp Authentication Failure:', msg);
});

client.on('ready', () => {
    clientStatus = 'ready';
    lastQrCode = null;
    lastError = null;
    console.log('======================================================');
    console.log('✅ WHATSAPP CLIENT IS CONNECTED & READY TO SEND MESSAGES!');
    console.log('======================================================');
});

client.on('disconnected', (reason) => {
    clientStatus = 'disconnected';
    lastError = reason;
    console.warn('⚠️ WhatsApp client was disconnected:', reason);
    console.log('Attempting to re-initialize client in 5 seconds...');
    setTimeout(() => {
        client.initialize().catch(err => {
            console.error('Re-initialization failed:', err);
        });
    }, 5000);
});

// Initialize Client
client.initialize().catch(err => {
    clientStatus = 'error';
    lastError = err?.message || String(err);
    console.error('❌ Failed to initialize WhatsApp client:', err);
});

// Self-healing recovery mechanism for detached Puppeteer frames / broken browser contexts
let isRecovering = false;

async function recoverClient(reason = 'Unknown') {
    if (isRecovering) {
        console.log('⏳ Client recovery already in progress, skipping duplicate trigger.');
        return;
    }
    isRecovering = true;
    clientStatus = 'initializing';
    lastError = reason;
    console.log('\n======================================================');
    console.log(`🔄 [SELF-HEALING] Re-initializing WhatsApp client (Reason: ${reason})...`);
    console.log('======================================================\n');

    try {
        await client.destroy();
    } catch (e) {
        console.warn('⚠️ Note: Error during client.destroy():', e.message);
    }

    // Wait a brief delay to allow Chrome process cleanup
    await new Promise(r => setTimeout(r, 1500));

    try {
        await client.initialize();
        console.log('🚀 Client initialize() launched after recovery.');
    } catch (err) {
        clientStatus = 'error';
        lastError = err?.message || String(err);
        console.error('❌ Failed to re-initialize WhatsApp client during recovery:', err);
    } finally {
        isRecovering = false;
    }
}

/**
 * Format phone number into WhatsApp format: digits + '@c.us'
 */
function formatWhatsAppJid(rawPhone) {
    if (!rawPhone) return null;
    // Strip all non-digit characters
    let clean = String(rawPhone).replace(/\D/g, '');
    
    // If standard 10 digit Indian number without country code, prepend 91
    if (clean.length === 10) {
        clean = '91' + clean;
    }
    
    if (clean.length < 10) {
        return null;
    }
    
    return `${clean}@c.us`;
}

/**
 * Format concise, professional, farmer-friendly summary note
 */
function formatRecommendationNote(data) {
    const farmer = data.farmerName || 'Farmer';
    const plot = data.plotName || 'Plot';
    const crop = data.crop || 'Oil Palm';
    const severity = data.severity || 'normal';
    
    let severityEmoji = '🟢';
    let statusText = 'HEALTHY & BALANCED';
    if (severity === 'critical') {
        severityEmoji = '🔴';
        statusText = 'ACTION REQUIRED (DEFICIENT)';
    } else if (severity === 'warning') {
        severityEmoji = '🟡';
        statusText = 'MODERATE ATTENTION';
    }

    let note = `🌴 *NutriPalm AI - Precision Agronomy Advisory*\n\n`;
    note += `Namaste *${farmer}*,\n`;
    note += `Here is your customized soil & crop digital twin recommendation for *${plot}* (${crop}):\n\n`;
    note += `📊 *Health Status*: ${severityEmoji} ${statusText}\n\n`;

    // Soil parameters
    if (data.soilData) {
        note += `🧪 *Soil Diagnostic Parameters*:\n`;
        if (data.soilData.nitrogen !== undefined && data.soilData.nitrogen !== null) {
            note += `• Nitrogen (N): ${data.soilData.nitrogen} kg/ha\n`;
        }
        if (data.soilData.phosphorus !== undefined && data.soilData.phosphorus !== null) {
            note += `• Phosphorus (P): ${data.soilData.phosphorus} kg/ha\n`;
        }
        if (data.soilData.potassium !== undefined && data.soilData.potassium !== null) {
            note += `• Potassium (K): ${data.soilData.potassium} kg/ha\n`;
        }
        if (data.soilData.ph !== undefined && data.soilData.ph !== null) {
            note += `• Soil Acidity (pH): ${data.soilData.ph}\n`;
        }
        if (data.soilData.organicCarbon !== undefined && data.soilData.organicCarbon !== null) {
            note += `• Organic Carbon: ${data.soilData.organicCarbon}%\n`;
        }
        note += `\n`;
    }

    // Fertilizer plan
    if (Array.isArray(data.fertilizerPlan) && data.fertilizerPlan.length > 0) {
        note += `🌾 *Urgent Nutrient & Fertilizer Advice*:\n`;
        data.fertilizerPlan.slice(0, 3).forEach((item, idx) => {
            const name = item.product || item.product_display_name || 'Fertilizer';
            const qty = item.qty || item.quantity_kg_per_ha || item.quantity_kg_total || '';
            const unit = item.unit || 'kg/ha';
            note += `${idx + 1}. *${name}*: ${qty} ${unit}\n`;
        });
        note += `\n`;
    }

    // Irrigation & Agronomist Advice
    if (data.advice) {
        note += `💧 *Irrigation & Field Guidance*:\n${data.advice}\n\n`;
    } else {
        note += `💧 *Irrigation Guidance*:\nMaintain regular ring basin irrigation (approx 200–250 L/palm/day). Irrigate before noon to reduce evaporative stress.\n\n`;
    }

    if (data.expectedYield) {
        note += `📈 *Projected Harvest Impact*: ${data.expectedYield} tons/ha expected with timely application.\n\n`;
    }

    note += `_Generated by NutriPalm AI - Smart Oil Palm Agronomy Advisory_`;
    return note;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Health and Status Endpoint
app.get('/status', (req, res) => {
    res.json({
        service: 'NutriPalm WhatsApp Notification Service',
        status: clientStatus,
        isReady: clientStatus === 'ready',
        hasQrCode: Boolean(lastQrCode),
        qrCode: lastQrCode,
        lastError: lastError,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', clientStatus, isReady: clientStatus === 'ready' });
});

// Restart & Re-initialize endpoint
app.post('/restart', async (req, res) => {
    console.log('🔄 Manual WhatsApp client restart requested via /restart endpoint...');
    res.json({ success: true, message: 'WhatsApp client re-initialization triggered.' });
    recoverClient('Manual restart API invoked');
});

// 2. Direct message send endpoint
app.post('/send', async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({
            success: false,
            error: 'Both phone and message fields are required.'
        });
    }

    if (clientStatus !== 'ready') {
        return res.status(503).json({
            success: false,
            status: clientStatus,
            error: `WhatsApp client is not ready. Current status: '${clientStatus}'. Please check backend terminal for QR code pairing.`
        });
    }

    const jid = formatWhatsAppJid(phone);
    if (!jid) {
        return res.status(400).json({
            success: false,
            error: `Invalid phone number format: '${phone}'. Please include country code or valid 10-digit number.`
        });
    }

    // Resolve registered number ID via WhatsApp Web
    let targetJid = jid;
    try {
        const numberId = await client.getNumberId(jid);
        if (numberId) {
            if (numberId._serialized && numberId._serialized.endsWith('@c.us')) {
                targetJid = numberId._serialized;
            } else {
                targetJid = jid; // Keep phone @c.us, do not send to @lid
            }
            console.log(`📱 Verified WhatsApp user: ${phone} (Sending to: ${targetJid})`);
        } else {
            console.warn(`⚠️ Warning: Phone '${phone}' (${jid}) could not be resolved via getNumberId. Attempting direct send to ${jid}...`);
            targetJid = jid;
        }
    } catch (numErr) {
        console.warn(`⚠️ getNumberId warning: ${numErr.message}`);
        if (numErr.message && (numErr.message.includes('detached Frame') || numErr.message.includes('Execution context was destroyed'))) {
            recoverClient('Detached Frame in getNumberId');
            return res.status(503).json({
                success: false,
                status: 'recovering',
                error: 'WhatsApp Web browser session detached. Automatic self-healing re-initialization initiated. Please retry in 10-15 seconds.'
            });
        }
    }

    try {
        console.log(`📤 Sending WhatsApp message to: ${targetJid}...`);
        const result = await client.sendMessage(targetJid, message);
        const messageId = result?.id?._serialized || result?.id?.id || `msg_${Date.now()}`;
        console.log(`✅ Message sent successfully to ${targetJid} (ID: ${messageId})`);

        res.json({
            success: true,
            status: 'sent',
            recipient: targetJid,
            messageId: messageId,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Failed to send WhatsApp message:', err);
        const errMsg = err?.message || '';

        if (errMsg.includes('detached Frame') || errMsg.includes('Execution context was destroyed') || errMsg.includes('Session closed')) {
            recoverClient('Detached Frame in /send');
            return res.status(503).json({
                success: false,
                status: 'recovering',
                error: 'WhatsApp Web browser session detached. Automatic self-healing re-initialization initiated. Please retry in 10-15 seconds.'
            });
        }

        res.status(500).json({
            success: false,
            status: 'failed',
            error: errMsg || 'Failed to dispatch WhatsApp message.'
        });
    }
});

// 3. Recommendation Trigger & Dispatch Endpoint
app.post('/send-recommendation', async (req, res) => {
    const { 
        phone, 
        farmerName, 
        plotName, 
        crop, 
        severity, 
        soilData, 
        fertilizerPlan, 
        advice,
        expectedYield,
        customMessage 
    } = req.body;

    if (!phone) {
        return res.status(400).json({
            success: false,
            error: 'Recipient phone number is required.'
        });
    }

    if (clientStatus !== 'ready') {
        return res.status(503).json({
            success: false,
            status: clientStatus,
            error: `WhatsApp client is not ready. Current status: '${clientStatus}'. Please scan QR code in terminal.`
        });
    }

    const jid = formatWhatsAppJid(phone);
    if (!jid) {
        return res.status(400).json({
            success: false,
            error: `Invalid phone number: '${phone}'. Must contain at least 10 digits.`
        });
    }

    // Resolve registered number ID via WhatsApp Web
    let targetJid = jid;
    try {
        const numberId = await client.getNumberId(jid);
        if (numberId) {
            if (numberId._serialized && numberId._serialized.endsWith('@c.us')) {
                targetJid = numberId._serialized;
            } else {
                targetJid = jid; // Keep phone @c.us, do not send to @lid
            }
            console.log(`📱 Verified WhatsApp user: ${phone} (Sending to: ${targetJid})`);
        } else {
            console.warn(`⚠️ Warning: Phone '${phone}' (${jid}) could not be resolved via getNumberId. Attempting direct send to ${jid}...`);
            targetJid = jid;
        }
    } catch (numErr) {
        console.warn(`⚠️ getNumberId warning: ${numErr.message}`);
        if (numErr.message && (numErr.message.includes('detached Frame') || numErr.message.includes('Execution context was destroyed'))) {
            recoverClient('Detached Frame in getNumberId');
            return res.status(503).json({
                success: false,
                status: 'recovering',
                error: 'WhatsApp Web browser session detached. Automatic self-healing re-initialization initiated. Please retry in 10-15 seconds.'
            });
        }
    }

    const formattedMessage = customMessage || formatRecommendationNote({
        farmerName,
        plotName,
        crop,
        severity,
        soilData,
        fertilizerPlan,
        advice,
        expectedYield
    });

    try {
        console.log(`🌾 Dispatching AI Recommendation note to WhatsApp user: ${targetJid}...`);
        const result = await client.sendMessage(targetJid, formattedMessage);
        const messageId = result?.id?._serialized || result?.id?.id || `msg_${Date.now()}`;
        console.log(`✅ Recommendation dispatched successfully to ${targetJid} (ID: ${messageId})`);

        res.json({
            success: true,
            status: 'sent',
            recipient: targetJid,
            messageId: messageId,
            preview: formattedMessage.slice(0, 100) + '...',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error sending recommendation note:', err);
        const errMsg = err?.message || '';

        if (errMsg.includes('detached Frame') || errMsg.includes('Execution context was destroyed') || errMsg.includes('Session closed')) {
            recoverClient('Detached Frame in /send-recommendation');
            return res.status(503).json({
                success: false,
                status: 'recovering',
                error: 'WhatsApp Web browser session detached. Automatic self-healing re-initialization initiated. Please retry in 10-15 seconds.'
            });
        }

        res.status(500).json({
            success: false,
            status: 'failed',
            error: errMsg || 'Failed to send WhatsApp recommendation note.'
        });
    }
});

// Start Express server
const server = app.listen(PORT, () => {
    console.log(`📡 WhatsApp Notification API listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
    server.close();
    client.destroy();
});
